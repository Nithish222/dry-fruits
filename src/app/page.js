"use client";
import { useEffect, useState } from "react";
import { collection, getDocs, doc, onSnapshot, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import ReceiptModal from "@/components/ReceiptModal";
import PaymentModal from "@/components/PaymentModal";
import CustomerLookupModal from "@/components/CustomerLookupModal";
import { formatINR, roundKg, roundRs, LOW_STOCK_THRESHOLD_KG, CREDIT_LIMIT_WARNING_THRESHOLD } from "@/lib/format";
import { getPendingTransactions, isOfflineError, queueTransaction, removePendingTransaction } from "@/lib/offlineQueue";
import { readVoucherPostContext, writeVoucherPost } from "@/lib/accounting";
import { buildSalesVoucherLines } from "@/lib/khataVouchers";
import { getSystemAccounts } from "@/lib/systemAccounts";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Modal from "@/components/ui/Modal";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Skeleton from "@/components/ui/Skeleton";
import CategoryChipFilter from "@/components/ui/CategoryChipFilter";
import SortMenu from "@/components/ui/SortMenu";
import { ShoppingCart, X, RotateCcw, TrendingUp, TrendingDown, Loader2, Trash2 } from "@/components/ui/icons";

const CATALOG_SKELETON_TILES = 8;
const SORT_OPTIONS = [
  { value: "popularity", label: "Most Popular" },
  { value: "az", label: "Name (A-Z)" },
  { value: "price", label: "Price (Low to High)" },
];
// Hides the native number-input spin buttons (Chrome/Safari/Edge via the
// webkit pseudo-elements, Firefox via -moz-appearance) - Up/Down arrow keys
// still work, wired explicitly in handlePriceInputArrowKey below.
const NO_SPINNER_INPUT_CLASS = "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

// Runs the stock-checked, atomic Firestore write for one sale. Shared by the
// live checkout flow and the background sync of queued offline sales, so a
// queued sale is validated against current stock exactly like a live one.
async function commitTransactionToFirestore(payload) {
  const transactionRef = doc(collection(db, "transactions"));
  // Only created/written when this sale has a credit component - see below.
  const creditEntryRef = doc(collection(db, "customers", payload.customer.phoneNumber, "entries"));
  // Plain reference-data read, outside the transaction - same pattern
  // VoucherForm.js already uses for its account picker.
  const systemAccounts = await getSystemAccounts();

  await runTransaction(db, async (transaction) => {
    const productUpdates = [];
    // Cost at the moment of sale, read fresh from the same product doc
    // already fetched below for stock validation - NOT from payload.items'
    // client-cached cost_price_per_kg, which can be stale (captured
    // whenever the item was added to the cart, not at checkout time). Used
    // both for the costPriceAtSale snapshot and the COGS voucher line below,
    // so both derive from one transactionally-consistent source.
    const costPriceByItemId = new Map();

    for (const item of payload.items) {
      if (item.weight_kg <= 0) {
        throw new Error(`Weight for ${item.name} must be positive.`);
      }
      const productRef = doc(db, "products", item.id);
      const productDoc = await transaction.get(productRef);

      if (!productDoc.exists()) {
        throw new Error(`Product ${item.name} not found.`);
      }

      const currentStock = productDoc.data().stock_kg;
      if (currentStock < item.weight_kg) {
        throw new Error(`Not enough stock for ${item.name}. Available: ${currentStock}kg, Requested: ${item.weight_kg}kg`);
      }
      costPriceByItemId.set(item.id, productDoc.data().cost_price_per_kg ?? null);

      // Round on every write so repeated decimal subtractions across many
      // sales don't drift into floating-point noise like 98.35000000000001.
      productUpdates.push({ ref: productRef, newStock: roundKg(currentStock - item.weight_kg) });
    }

    // Missing cost price contributes ₹0 to COGS rather than being excluded
    // - same convention computeProfit() (src/lib/format.js) already uses
    // for the dashboard's profit figure, not a new/different policy.
    let cogsAmount = 0;
    for (const item of payload.items) {
      const costPrice = costPriceByItemId.get(item.id);
      if (costPrice != null && Number.isFinite(costPrice)) {
        cogsAmount = roundRs(cogsAmount + costPrice * item.weight_kg);
      }
    }

    const customerRef = doc(db, "customers", payload.customer.phoneNumber);
    const customerDoc = await transaction.get(customerRef);
    // Positive = customer owes the shop. Computed from this same read
    // rather than FieldValue.increment(), matching how stock is already
    // derived above - one write per doc per transaction, no ambiguity.
    const creditAmount = roundRs(payload.payment?.creditAmount || 0);

    // Reads only, still - same rule the rest of this transaction already
    // follows (every read before any write).
    const voucherDate = payload.createdAt.slice(0, 10);
    const voucherLines = buildSalesVoucherLines({ payment: payload.payment, grandTotal: payload.grandTotal, cogsAmount, systemAccounts });
    const voucherContext = await readVoucherPostContext(transaction, { lines: voucherLines, voucherType: "sales", date: voucherDate });

    if (!customerDoc.exists()) {
      transaction.set(customerRef, {
        name: payload.customer.name,
        phoneNumber: payload.customer.phoneNumber,
        createdAt: serverTimestamp(),
        balance: creditAmount,
      });
    } else if (creditAmount > 0) {
      const currentBalance = customerDoc.data().balance || 0;
      transaction.update(customerRef, { balance: roundRs(currentBalance + creditAmount) });
    }

    if (creditAmount > 0) {
      // A credit sale's debit entry - linked back to the sale via
      // sourceTxnId, never editing the transaction doc itself (same
      // never-mutate-the-original principle as the returns feature).
      transaction.set(creditEntryRef, {
        type: "debit",
        amount: creditAmount,
        note: "Credit sale",
        sourceTxnId: transactionRef.id,
        createdAt: serverTimestamp(),
      });
    }

    transaction.set(transactionRef, {
      items: payload.items.map((item) => ({
        id: item.id, name: item.name, weight_kg: item.weight_kg, billedPrice: item.billedPrice,
        subtotal: item.billedPrice * (item.weight_kg || 0),
        // Snapshotted at sale time, mirroring billedPrice, so a later cost
        // price change (or the product being deleted) never rewrites the
        // margin on a past sale. Sourced from costPriceByItemId (the fresh
        // in-transaction read above), not payload.items - see comment there.
        costPriceAtSale: costPriceByItemId.get(item.id) ?? null,
      })),
      priceType: payload.priceType,
      grandTotal: payload.grandTotal,
      // Preserve the moment the sale actually happened rather than when it synced.
      createdAt: payload.createdAt ? new Date(payload.createdAt) : serverTimestamp(),
      payment: payload.payment,
      customer: {
        id: payload.customer.phoneNumber,
        name: payload.customer.name,
        phoneNumber: payload.customer.phoneNumber,
      },
    });

    for (const update of productUpdates) {
      transaction.update(update.ref, { stock_kg: update.newStock });
    }

    writeVoucherPost(transaction, {
      lines: voucherLines,
      voucherType: "sales",
      date: voucherDate,
      narration: `Sale to ${payload.customer.name} (${payload.customer.phoneNumber})`,
      createdBy: payload.createdBy,
      context: voucherContext,
    });
  });

  return transactionRef;
}

export default function Home() {
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortBy, setSortBy] = useState("popularity"); // "popularity" | "az" | "price"
  const [productSalesCounts, setProductSalesCounts] = useState({}); // { [productId]: timesOrdered }
  const [cart, setCart] = useState([]);
  const [priceType, setPriceType] = useState("retail");
  const [showReceipt, setShowReceipt] = useState(false);
  const [receiptData, setReceiptData] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showCustomerLookup, setShowCustomerLookup] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState("cart"); // "cart" | "review" | "loading" | "customer"
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showClearCartConfirm, setShowClearCartConfirm] = useState(false);
  const [priceOverrides, setPriceOverrides] = useState({}); // { [productId]: overriddenLineTotal }
  // Raw text buffers for the review-step price inputs, used only while a
  // field is actively being edited. A controlled input whose value is
  // always re-derived from a rounded number can never legitimately show ""
  // mid-edit - the instant you clear it, it snaps back to "0" instead of
  // staying empty, which reads as "backspace doesn't work." These hold
  // exactly what was typed (including "", "-", "12."), cleared on blur so
  // the field then reflects the clean committed/derived value.
  const [itemPriceDrafts, setItemPriceDrafts] = useState({});
  const [totalDraft, setTotalDraft] = useState(null);

  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [pendingCount, setPendingCount] = useState(() => getPendingTransactions().length);
  const [syncing, setSyncing] = useState(false);

  // New states for customer details
  const [customerName, setCustomerName] = useState("");
  const [customerPhoneNumber, setCustomerPhoneNumber] = useState("");
  const [customerSuggestions, setCustomerSuggestions] = useState([]);
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null); // To store the selected customer object
  const [allCustomers, setAllCustomers] = useState(null); // Lazily-loaded, filtered client-side (see fetchCustomerSuggestions below)

  // Real-time listener instead of a one-shot fetch: Firestore serves the
  // cached snapshot instantly on (re)subscribe, so switching tabs and back
  // doesn't cause a visible reload, and it only pushes updates when the
  // catalog actually changes in the DB.
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "products"),
      (querySnapshot) => {
        const productsList = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setProducts(productsList);
        setLoading(false);
      },
      (error) => {
        console.error("Error fetching products: ", error);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // One-shot, not a live listener - "most popular" doesn't need to update
  // mid-shift, just be roughly right for sorting the catalog. Counts how
  // many past sales included each product (line-item occurrences, not
  // total weight - "ordered often" reads as more useful for "popular" than
  // "ordered in bulk a couple times").
  useEffect(() => {
    async function fetchPopularity() {
      try {
        const snapshot = await getDocs(collection(db, "transactions"));
        const counts = {};
        snapshot.docs.forEach((doc) => {
          for (const item of doc.data().items || []) {
            counts[item.id] = (counts[item.id] || 0) + 1;
          }
        });
        setProductSalesCounts(counts);
      } catch (error) {
        console.error("Error computing product popularity: ", error);
      }
    }
    fetchPopularity();
  }, []);

  // Non-blocking - warms systemAccounts.js's cache so the first checkout of
  // the day doesn't pay the extra round-trip, and so a missing/renamed
  // system ledger surfaces here (console) before a cashier is mid-sale. A
  // real checkout attempt still surfaces the error via handleCheckout's own
  // catch if this never resolves.
  useEffect(() => {
    getSystemAccounts().catch((error) => console.error("System accounts not ready: ", error));
  }, []);


  // Flush any offline-queued sales to Firestore, one at a time, stopping the
  // moment we hit connectivity trouble again so we don't spam retries.
  useEffect(() => {
    let cancelled = false;

    async function flushQueue() {
      const queue = getPendingTransactions();
      if (queue.length === 0) return;
      setSyncing(true);
      for (const entry of queue) {
        try {
          await commitTransactionToFirestore(entry.payload);
          removePendingTransaction(entry.localId);
        } catch (error) {
          if (isOfflineError(error)) break;
          // A real failure (e.g. stock no longer available) - leave it queued
          // for manual follow-up rather than silently dropping the sale.
          console.error(`Failed to sync queued transaction ${entry.localId}: `, error);
        }
      }
      if (!cancelled) {
        setPendingCount(getPendingTransactions().length);
        setSyncing(false);
      }
    }

    function handleOnline() {
      setIsOnline(true);
      flushQueue();
    }
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    if (navigator.onLine) flushQueue();

    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Customer suggestions are filtered client-side (like CustomerLookupModal)
  // rather than via Firestore range queries. Firestore range (">="/"<=")
  // filters are case-sensitive, so "raj" would never match "Raj" - and
  // Firestore doesn't allow inequality filters on two different fields
  // (name and phoneNumber) in the same query anyway. The customer list for
  // a shop like this is small, so fetching it once and filtering in memory
  // is simpler and actually correct.
  useEffect(() => {
    if (!showCustomerSuggestions && !customerName && !customerPhoneNumber) return;
    if (allCustomers !== null) return; // already loaded
    let cancelled = false;
    (async () => {
      try {
        const snapshot = await getDocs(collection(db, "customers"));
        if (!cancelled) {
          setAllCustomers(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        }
      } catch (error) {
        console.error("Error loading customers: ", error);
        if (!cancelled) setAllCustomers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerName, customerPhoneNumber, showCustomerSuggestions, allCustomers]);

  useEffect(() => {
    const nameQuery = customerName.trim().toLowerCase();
    const phoneQuery = customerPhoneNumber.trim().toLowerCase();

    const handler = setTimeout(() => {
      if (!nameQuery && !phoneQuery) {
        setCustomerSuggestions([]);
        setShowCustomerSuggestions(false);
        return;
      }
      if (allCustomers === null) return; // still loading

      const suggestions = allCustomers.filter((customer) => {
        const matchesName = !nameQuery || (customer.name || "").toLowerCase().includes(nameQuery);
        const matchesPhone = !phoneQuery || (customer.phoneNumber || "").toLowerCase().includes(phoneQuery);
        return matchesName && matchesPhone;
      });
      setCustomerSuggestions(suggestions);
      setShowCustomerSuggestions(suggestions.length > 0);
    }, 300); // Debounce search

    return () => clearTimeout(handler);
  }, [customerName, customerPhoneNumber, allCustomers]);

  const categoryCounts = products.reduce((acc, p) => {
    const category = (p.category || "").trim();
    if (category) acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});
  const categories = Object.keys(categoryCounts).sort();
  const filteredProducts = products
    .filter((product) => {
      const query = searchQuery.toLowerCase();
      const matchesSearch =
        product.name.toLowerCase().includes(query) || (product.tamil_name || "").toLowerCase().includes(query);
      const matchesCategory = !categoryFilter || (product.category || "").trim() === categoryFilter;
      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => {
      // Out of stock always sinks to the bottom, regardless of sort mode -
      // nothing a cashier can actually sell belongs ahead of what's in
      // stock, no matter how popular/cheap/alphabetically-early it is.
      const aOut = (a.stock_kg ?? 0) <= 0;
      const bOut = (b.stock_kg ?? 0) <= 0;
      if (aOut !== bOut) return aOut ? 1 : -1;

      if (sortBy === "az") return a.name.localeCompare(b.name);
      if (sortBy === "price") {
        const aPrice = (priceType === "retail" ? a.retail_price_per_kg : a.wholesale_price_per_kg) ?? 0;
        const bPrice = (priceType === "retail" ? b.retail_price_per_kg : b.wholesale_price_per_kg) ?? 0;
        return aPrice - bPrice;
      }
      // "popularity" (default) - most-ordered first, ties broken alphabetically
      const countDiff = (productSalesCounts[b.id] || 0) - (productSalesCounts[a.id] || 0);
      return countDiff !== 0 ? countDiff : a.name.localeCompare(b.name);
    });

  const addToCart = (product) => {
    if ((product.stock_kg ?? 0) <= 0) return; // out of stock - nothing to sell
    const activePrice = priceType === "retail" ? product.retail_price_per_kg : product.wholesale_price_per_kg;
    setCart((prevCart) => {
      if (prevCart.find((item) => item.id === product.id)) return prevCart;
      return [...prevCart, { ...product, weight_kg: 0, unit: "kg", billedPrice: activePrice }];
    });
  };

  // Drops a stale price override rather than leaving it silently wrong -
  // an absolute-rupee override is only meaningful against the catalog
  // baseline it was set against, and weight/price-type changes move that
  // baseline out from under it.
  const clearOverride = (id) =>
    setPriceOverrides((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const handlePriceTypeChange = (newType) => {
    setPriceType(newType);
    setCart((prevCart) =>
      prevCart.map((item) => ({
        ...item,
        billedPrice: newType === "retail" ? item.retail_price_per_kg : item.wholesale_price_per_kg,
      }))
    );
    setPriceOverrides({}); // every item's catalog baseline just changed at once
  };

  // Rejects a quantity that exceeds the item's stock snapshot (taken at
  // add-to-cart time) rather than letting it sit in the cart only to fail
  // at final checkout, inside commitTransactionToFirestore's own stock
  // check - by then the cashier has already walked the customer through
  // pricing/customer details. Removes the item entirely rather than
  // clamping to the max available, since "how much do you actually want
  // instead" is a question for the cashier to re-decide, not silently
  // answer for them.
  const rejectIfExceedsStock = (item, requestedKg) => {
    if (requestedKg <= (item.stock_kg ?? 0)) return false;
    alert(`Not enough stock for ${item.name}. Restock to continue.`);
    removeItem(item.id);
    return true;
  };

  const updateWeight = (id, newWeightVal) => {
    const item = cart.find((i) => i.id === id);
    if (!item) return;
    const kgValue = item.unit === "gm" ? Number(newWeightVal) / 1000 : Number(newWeightVal);
    const rounded = roundKg(kgValue);
    if (rejectIfExceedsStock(item, rounded)) return;
    setCart((prevCart) => prevCart.map((i) => (i.id === id ? { ...i, weight_kg: rounded } : i)));
    clearOverride(id);
  };

  const addQuickWeight = (id, kgToAdd) => {
    const item = cart.find((i) => i.id === id);
    if (!item) return;
    const rounded = roundKg(item.weight_kg + kgToAdd);
    if (rejectIfExceedsStock(item, rounded)) return;
    setCart((prevCart) => prevCart.map((i) => (i.id === id ? { ...i, weight_kg: rounded } : i)));
    clearOverride(id);
  };

  const toggleUnit = (id) => {
    setCart((prevCart) =>
      prevCart.map((item) =>
        item.id === id ? { ...item, unit: item.unit === "kg" ? "gm" : "kg" } : item
      )
    );
  };

  const removeItem = (id) => {
    setCart((prevCart) => prevCart.filter((item) => item.id !== id));
    clearOverride(id);
    // The item list stays interactive on every checkout step - if this was
    // the last item, bounce back to "cart" rather than leaving an
    // adjustment/customer screen showing for an empty sale.
    if (cart.length === 1 && cart[0].id === id) setCheckoutStep("cart");
  };

  const handleBillCustomer = (customer) => {
    setCustomerName(customer.name || "");
    setCustomerPhoneNumber(customer.phoneNumber || "");
    setSelectedCustomer(customer);
    setShowCustomerSuggestions(false);
  };

  const cartTotal = cart.reduce((total, item) => total + item.billedPrice * (item.weight_kg || 0), 0);

  const getCatalogLineTotal = (item) => roundRs(item.billedPrice * (item.weight_kg || 0));
  const getEffectiveLineTotal = (item) => roundRs(priceOverrides[item.id] ?? getCatalogLineTotal(item));
  const reviewTotal = roundRs(cart.reduce((sum, item) => sum + getEffectiveLineTotal(item), 0));
  // Reverse-derives the per-kg rate that reproduces the negotiated line
  // total when fed through commitTransactionToFirestore's own
  // billedPrice * weight_kg subtotal calc, so that function needs zero
  // changes to honor a review-step override.
  const getEffectiveBilledPrice = (item) =>
    item.weight_kg ? getEffectiveLineTotal(item) / item.weight_kg : item.billedPrice;

  const handleItemSoldPriceChange = (itemId, rawValue) => {
    setItemPriceDrafts((prev) => ({ ...prev, [itemId]: rawValue })); // always mirrors exactly what was typed
    if (rawValue === "" || rawValue === "-") return; // mid-edit, nothing valid to commit yet
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    setPriceOverrides((prev) => ({ ...prev, [itemId]: roundRs(Math.max(0, parsed)) }));
  };
  const handleItemSoldPriceBlur = (itemId) =>
    setItemPriceDrafts((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });

  // Total is always a mirror of the live sum of every item's current
  // effective value - editing it directly means "split this difference
  // equally across every item, from wherever each currently sits" (not
  // reset to catalog first), confirmed against a worked example: items at
  // 40/40/60 (two already individually adjusted) typing a new Total of 150
  // nudges all three by the same +10/3, not just the untouched one.
  const handleTotalChange = (rawValue) => {
    setTotalDraft(rawValue);
    if (cart.length === 0 || rawValue === "" || rawValue === "-") return;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    const newTotal = Math.max(0, parsed);
    const delta = newTotal - reviewTotal;
    const perItemDelta = delta / cart.length;
    setPriceOverrides((prev) => {
      const next = { ...prev };
      cart.forEach((item) => {
        const current = prev[item.id] ?? getCatalogLineTotal(item);
        next[item.id] = roundRs(Math.max(0, current + perItemDelta));
      });
      return next;
    });
  };
  const handleTotalBlur = () => setTotalDraft(null);

  // Revert one item back to its catalog price - same underlying action as
  // clearOverride (used elsewhere to invalidate a stale override), just
  // exposed as an explicit cashier-facing button here.
  const resetItemPrice = (itemId) => {
    clearOverride(itemId);
    setItemPriceDrafts((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };
  const resetAllPrices = () => {
    setPriceOverrides({});
    setItemPriceDrafts({});
    setTotalDraft(null);
  };

  // Native number-input spin buttons are hidden (see NO_SPINNER_INPUT_CLASS
  // below) in favor of this - Up/Down still adjusts the value by a whole
  // rupee per press, just without the small click targets.
  const handlePriceInputArrowKey = (e, currentValue, onChangeHandler) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const delta = e.key === "ArrowUp" ? 1 : -1;
    const next = Math.max(0, roundRs((Number(currentValue) || 0) + delta));
    onChangeHandler(String(next));
  };

  const goToReview = () => {
    if (cart.length === 0 || cartTotal <= 0) {
      alert("Cart is empty.");
      return;
    }
    setItemPriceDrafts({});
    setTotalDraft(null);
    setCheckoutStep("review");
  };
  const goToCustomerStep = () => {
    setCheckoutStep("loading");
    setTimeout(() => {
      setCheckoutStep((prev) => (prev === "loading" ? "customer" : prev));
    }, 350);
  };
  const backToCart = () => setCheckoutStep("cart");
  const backToReview = () => setCheckoutStep("review");
  const requestDiscardCustomerStep = () => setShowDiscardConfirm(true);
  const confirmDiscardCustomerStep = () => {
    setShowDiscardConfirm(false);
    setCustomerName("");
    setCustomerPhoneNumber("");
    setCustomerSuggestions([]);
    setSelectedCustomer(null);
    setCheckoutStep("cart");
  };

  // Full reset back to a blank sale - shared by the "Clear order" button and
  // by ReceiptModal's onClose once a sale has gone through.
  const resetOrderState = () => {
    setCart([]);
    setCustomerName("");
    setCustomerPhoneNumber("");
    setCustomerSuggestions([]);
    setSelectedCustomer(null);
    setCheckoutStep("cart");
    setPriceOverrides({});
    setItemPriceDrafts({});
    setTotalDraft(null);
  };
  const requestClearCart = () => setShowClearCartConfirm(true);
  const confirmClearCart = () => {
    setShowClearCartConfirm(false);
    resetOrderState();
  };

  // Best-effort - drawn from the same client-side customer list the
  // suggestion dropdown already loads, so it can be a snapshot behind a
  // just-recorded payment elsewhere. Fine for a warning, not a hard limit.
  const currentCustomerBalance =
    allCustomers?.find((c) => c.phoneNumber === customerPhoneNumber)?.balance || 0;

  const openPaymentModal = () => {
    if (cart.length === 0 || reviewTotal <= 0) return; // unreachable via normal flow - goToReview already guarded this
    // Validate customer details
    if (!customerName || !customerPhoneNumber) {
      alert("Please enter customer name and phone number.");
      return;
    }
    setShowPaymentModal(true);
  };

  const handleCheckout = async (payment) => {
    if (payment.creditAmount > 0) {
      const projectedBalance = roundRs(currentCustomerBalance + payment.creditAmount);
      if (projectedBalance > CREDIT_LIMIT_WARNING_THRESHOLD) {
        // A warning, not a hard block - declining leaves the payment modal
        // open (checkout hasn't been touched yet) so the cashier can adjust
        // the amount instead of losing the whole cart.
        const proceed = window.confirm(
          `This will put ${customerName || "this customer"} at ₹${formatINR(projectedBalance)} owed, above the usual ₹${formatINR(CREDIT_LIMIT_WARNING_THRESHOLD)} limit. Continue?`
        );
        if (!proceed) return;
      }
    }

    setShowPaymentModal(false);

    const now = new Date();
    const payload = {
      items: cart.map((item) => ({
        id: item.id, name: item.name, weight_kg: item.weight_kg, billedPrice: getEffectiveBilledPrice(item),
        cost_price_per_kg: item.cost_price_per_kg ?? null,
      })),
      customer: { name: customerName, phoneNumber: customerPhoneNumber },
      priceType,
      grandTotal: reviewTotal,
      payment,
      createdAt: now.toISOString(),
      createdBy: { uid: user?.uid || null, email: user?.email || null },
    };

    const buildReceipt = (id) => ({
      id,
      items: cart.map((item) => ({
        id: item.id,
        name: item.name,
        qty: Number((item.weight_kg || 0).toFixed(3)),
        unit: "kg",
        price: getEffectiveBilledPrice(item),
        total: Number(getEffectiveLineTotal(item).toFixed(2)),
      })),
      grandTotal: reviewTotal,
      priceType,
      createdAt: now,
      customer: { name: customerName, phoneNumber: customerPhoneNumber },
      payment,
    });

    try {
      const transactionRef = await commitTransactionToFirestore(payload);
      setReceiptData(buildReceipt(transactionRef.id));
      setShowReceipt(true);
    } catch (error) {
      if (isOfflineError(error)) {
        // No connection right now - queue it locally and let the sync
        // effect flush it to Firestore once we're back online. The
        // cashier still gets a printable receipt for the customer.
        const entry = queueTransaction(payload);
        setPendingCount(getPendingTransactions().length);
        setReceiptData(buildReceipt(`Pending-${entry.localId.slice(-6)}`));
        setShowReceipt(true);
      } else {
        console.error("Transaction failed: ", error);
        alert(`Checkout failed: ${error.message}`);
      }
    }
  };

  return (
    <main className="p-6 md:p-8 h-full flex flex-col w-full bg-cream-50 dark:bg-cream-950 min-h-screen transition-colors duration-300">
      <PageHeader
        title="Checkout Register"
        subtitle="Select items from catalog and calculate customer bills"
        actions={
          <>
            {pendingCount > 0 && (
              <Badge variant="warning" dot pulse={!syncing}>
                {syncing ? "Syncing..." : `${pendingCount} pending sync`}
              </Badge>
            )}
            <Badge variant={isOnline ? "success" : "neutral"} dot pulse={isOnline}>
              {isOnline ? "System Online" : "Offline"}
            </Badge>
          </>
        }
      />

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0">
        <Card padding="p-6" className="lg:col-span-7 xl:col-span-8 flex flex-col min-h-0">
          <div className="mb-6 flex gap-3 items-center">
            <Input
              type="text"
              size="lg"
              className="w-56 flex-shrink-0 font-semibold"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <CategoryChipFilter
              categories={categories}
              counts={categoryCounts}
              totalCount={products.length}
              value={categoryFilter}
              onChange={setCategoryFilter}
              className="flex-1"
              stripClassName="max-w-[20rem]"
            />
            <SortMenu options={SORT_OPTIONS} value={sortBy} onChange={setSortBy} aria-label="Sort by" className="flex-shrink-0" />
          </div>

          <div className="flex-1 overflow-y-auto pr-2 pt-1">
            {loading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                {Array.from({ length: CATALOG_SKELETON_TILES }).map((_, i) => (
                  <Skeleton key={i} className="h-40 rounded-2xl" />
                ))}
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="text-center py-20 text-warmgray-400 font-medium">No matching products found.</div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredProducts.map((product) => {
                  const displayPrice = priceType === "retail" ? product.retail_price_per_kg : product.wholesale_price_per_kg;
                  const stock = product.stock_kg ?? 0;
                  const isOutOfStock = stock <= 0;
                  const isLow = stock < LOW_STOCK_THRESHOLD_KG;
                  return (
                    <div
                      key={product.id}
                      onClick={() => addToCart(product)}
                      aria-disabled={isOutOfStock}
                      className={
                        isOutOfStock
                          ? "bg-warmgray-50 dark:bg-warmgray-900/40 rounded-2xl transition-all duration-200 cursor-not-allowed p-4 border border-warmgray-200 dark:border-warmgray-800 flex flex-col min-h-40 opacity-50 grayscale"
                          : "bg-white dark:bg-warmgray-800/50 rounded-2xl hover:border-clay-400 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer p-4 border border-warmgray-200 dark:border-warmgray-700 shadow-sm flex flex-col min-h-40 active:scale-95 active:translate-y-0"
                      }
                    >
                      <div className="flex items-start justify-between gap-2">
                        {product.tamil_name ? (
                          <span className="text-[10px] font-bold uppercase tracking-wide text-warmgray-400 truncate min-w-0">{product.tamil_name}</span>
                        ) : (
                          <span />
                        )}
                        <span
                          className={`flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap border ${
                            isOutOfStock
                              ? "bg-warmgray-100 dark:bg-warmgray-800 border-warmgray-200 dark:border-warmgray-700 text-warmgray-500 dark:text-warmgray-400"
                              : isLow
                              ? "bg-rust-100 dark:bg-rust-950 border-rust-200 dark:border-rust-700 text-rust-700 dark:text-rust-300"
                              : "bg-sage-100 dark:bg-sage-950 border-sage-200 dark:border-sage-700 text-sage-700 dark:text-sage-300"
                          }`}
                        >
                          {isOutOfStock ? "Out of stock" : `${product.stock_kg}kg`}
                        </span>
                      </div>

                      <h3 className="font-medium text-ink-900 dark:text-ink-50 text-sm leading-snug line-clamp-2 min-h-[2.5rem] mt-1">
                        {product.name}
                      </h3>
                      {product.category && (
                        <p className="text-xs font-normal text-warmgray-400 truncate">{product.category}</p>
                      )}

                      <div className="mt-auto pt-3 border-t border-warmgray-100 dark:border-warmgray-700 flex items-baseline gap-1">
                        <span className="text-xl font-black text-clay-800 dark:text-clay-400 tabular-nums">₹{formatINR(displayPrice)}</span>
                        <span className="text-xs font-bold text-warmgray-400">/kg</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        <Card padding="p-0" className="lg:col-span-5 xl:col-span-4 flex flex-col min-h-0 overflow-hidden">
          <div className="p-4 bg-white dark:bg-warmgray-900 border-b border-warmgray-200 dark:border-warmgray-700 flex justify-between items-center">
            <h2 className="text-lg font-bold text-ink-900 dark:text-ink-50">Current Bill</h2>

            <div className="flex items-center gap-2">
              {cart.length > 0 && (
                <button
                  onClick={requestClearCart}
                  aria-label="Clear order"
                  title="Clear order"
                  className="p-2 rounded-lg text-warmgray-400 hover:text-rust-600 dark:hover:text-rust-400 hover:bg-rust-50 dark:hover:bg-rust-950/40 flex-shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <div className="bg-warmgray-100 dark:bg-warmgray-800 p-1 rounded-lg flex text-xs font-bold border border-warmgray-200 dark:border-warmgray-700">
                <button
                  onClick={() => handlePriceTypeChange("retail")}
                  className={`px-3 py-1.5 rounded-md transition-all ${priceType === "retail" ? "bg-clay-400 text-white shadow-sm" : "text-warmgray-600 dark:text-warmgray-400 hover:text-ink-900 dark:hover:text-ink-50"}`}
                >
                  Retail
                </button>
                <button
                  onClick={() => handlePriceTypeChange("wholesale")}
                  className={`px-3 py-1.5 rounded-md transition-all ${priceType === "wholesale" ? "bg-clay-400 text-white shadow-sm" : "text-warmgray-600 dark:text-warmgray-400 hover:text-ink-900 dark:hover:text-ink-50"}`}
                >
                  Wholesale
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-cream-50 dark:bg-cream-950">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-warmgray-300 dark:text-warmgray-700">
                <ShoppingCart className="w-12 h-12 mb-2" strokeWidth={1.5} />
                <p className="font-medium text-sm text-warmgray-400">Tap products to start billing</p>
              </div>
            ) : (
              cart.map((item) => {
                const displayValue = item.weight_kg === 0 ? "" : item.unit === "gm" ? (item.weight_kg * 1000) : item.weight_kg;
                return (
                  <div key={item.id} className="bg-white dark:bg-warmgray-900 p-4 rounded-xl border border-warmgray-200 dark:border-warmgray-700 shadow-sm relative">
                    <button
                      onClick={() => removeItem(item.id)}
                      aria-label={`Remove ${item.name} from cart`}
                      className="absolute top-3 right-3 text-warmgray-300 dark:text-warmgray-600 hover:text-rust-500"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <p className="font-bold text-ink-900 dark:text-ink-50 pr-6">{item.name}</p>
                    <p className="text-xs text-warmgray-500 dark:text-warmgray-400 mb-3">₹{formatINR(item.billedPrice)} / kg ({priceType})</p>

                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center bg-warmgray-50 dark:bg-warmgray-800 rounded-lg border border-warmgray-200 dark:border-warmgray-700 p-1">
                        <input
                          type="number"
                          min="0" step={item.unit === "kg" ? "0.01" : "1"}
                          value={displayValue}
                          onChange={(e) => updateWeight(item.id, e.target.value)}
                          className="w-16 bg-transparent px-2 font-bold text-ink-900 dark:text-ink-50 text-center focus:outline-none"
                          placeholder="0"
                        />
                        <button
                          onClick={() => toggleUnit(item.id)}
                          className="bg-white dark:bg-warmgray-700 shadow-sm text-warmgray-700 dark:text-warmgray-200 text-xs font-bold px-2.5 py-1.5 rounded-md hover:bg-warmgray-100 dark:hover:bg-warmgray-600 border border-warmgray-200 dark:border-warmgray-600"
                        >
                          {item.unit === "kg" ? "kg" : "gm"}
                        </button>
                      </div>
                      <span className="font-black text-ink-900 dark:text-ink-50 text-lg">
                        ₹{formatINR(item.billedPrice * (item.weight_kg || 0))}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-3 border-t border-warmgray-100 dark:border-warmgray-800">
                      {[0.05, 0.10, 0.25, 0.50, 1.00].map(w => (
                        <button
                          key={w}
                          onClick={() => addQuickWeight(item.id, w)}
                          className="text-[11px] bg-warmgray-50 dark:bg-warmgray-800 border border-warmgray-200 dark:border-warmgray-700 rounded px-2.5 py-1 font-semibold text-warmgray-600 dark:text-warmgray-300 hover:bg-clay-50 dark:hover:bg-clay-950 hover:text-clay-700 dark:hover:text-clay-400 hover:border-clay-300"
                        >
                          +{w >= 1 ? `${w}kg` : `${w*1000}g`}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="p-5 bg-white dark:bg-warmgray-900 border-t border-warmgray-200 dark:border-warmgray-700 transition-colors">
            <div className="flex justify-between items-center mb-4">
              <span className="text-warmgray-500 dark:text-warmgray-400 font-semibold">Grand Total</span>
              <span className="text-3xl font-black text-clay-600 dark:text-clay-400">
                ₹{formatINR(cartTotal)}
              </span>
            </div>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={goToReview}
              disabled={cart.length === 0 || cartTotal === 0}
            >
              Continue
            </Button>
          </div>

        </Card>
      </div>

      <Modal
        isOpen={checkoutStep === "review" || checkoutStep === "loading" || checkoutStep === "customer"}
        onClose={checkoutStep === "review" ? backToCart : checkoutStep === "customer" ? requestDiscardCustomerStep : backToReview}
        title={checkoutStep === "review" ? "Review & Adjust Prices" : "Customer Details"}
        panelClassName="max-w-xl h-[min(80vh,34rem)]"
        headerActions={
          checkoutStep === "customer" ? (
            <button
              onClick={() => setShowCustomerLookup(true)}
              className="text-xs font-bold text-clay-600 dark:text-clay-400 hover:underline mr-2"
            >
              Lookup Customer
            </button>
          ) : undefined
        }
        footer={
          checkoutStep === "review" ? (
            <div className="flex gap-3">
              <Button variant="secondary" size="lg" className="flex-1" onClick={backToCart}>
                Back
              </Button>
              <Button variant="primary" size="lg" className="flex-1" onClick={goToCustomerStep}>
                Continue
              </Button>
            </div>
          ) : checkoutStep === "customer" ? (
            <div className="flex gap-3">
              <Button variant="secondary" size="lg" className="flex-1" onClick={backToReview}>
                Back
              </Button>
              <Button
                variant="primary"
                size="lg"
                className="flex-1"
                onClick={openPaymentModal}
                disabled={cart.length === 0 || reviewTotal === 0}
              >
                Checkout &amp; Pay
              </Button>
            </div>
          ) : (
            <div className="flex gap-3">
              <Button variant="secondary" size="lg" className="flex-1" disabled>
                Back
              </Button>
              <Button variant="primary" size="lg" className="flex-1" disabled>
                Continue
              </Button>
            </div>
          )
        }
      >
        {checkoutStep === "review" ? (
          <>
            <div className="p-3 space-y-2 overflow-y-auto">
              {cart.map((item) => {
                const catalogTotal = getCatalogLineTotal(item);
                const effectiveTotal = getEffectiveLineTotal(item);
                const priceState = effectiveTotal > catalogTotal ? "positive" : effectiveTotal < catalogTotal ? "negative" : "neutral";
                const badgeVariant = priceState === "positive" ? "success" : "danger";
                const inputColorClass =
                  priceState === "positive"
                    ? "border-sage-300 dark:border-sage-700 text-sage-700 dark:text-sage-400"
                    : priceState === "negative"
                    ? "border-rust-300 dark:border-rust-700 text-rust-700 dark:text-rust-400"
                    : "border-warmgray-200 dark:border-warmgray-700 text-ink-900 dark:text-ink-50";
                return (
                  <div key={item.id} className="bg-white dark:bg-warmgray-900 p-2.5 rounded-lg border border-warmgray-200 dark:border-warmgray-700 shadow-sm flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-sm text-ink-900 dark:text-ink-50 truncate">{item.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-warmgray-500 dark:text-warmgray-400">Catalog: ₹{formatINR(catalogTotal)}</span>
                        {priceState !== "neutral" && (
                          <Badge variant={badgeVariant} size="sm">
                            {priceState === "positive" ? "+" : "-"}₹{formatINR(Math.abs(effectiveTotal - catalogTotal))}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {priceState !== "neutral" && (
                      <span
                        className={`flex-shrink-0 flex items-center gap-0.5 text-xs font-bold ${
                          priceState === "positive" ? "text-sage-600 dark:text-sage-400" : "text-rust-600 dark:text-rust-400"
                        }`}
                      >
                        {priceState === "positive" ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                        {catalogTotal > 0 ? Math.abs(((effectiveTotal - catalogTotal) / catalogTotal) * 100).toFixed(1) : "0.0"}%
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => resetItemPrice(item.id)}
                      disabled={priceState === "neutral"}
                      aria-label={`Reset ${item.name} to catalog price`}
                      title="Reset to catalog price"
                      className="flex-shrink-0 p-1.5 rounded-lg text-warmgray-400 hover:text-clay-600 dark:hover:text-clay-400 hover:bg-clay-50 dark:hover:bg-clay-950/40 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                    <div className="relative flex-shrink-0">
                      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs font-bold text-warmgray-400">₹</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={itemPriceDrafts[item.id] ?? effectiveTotal}
                        onChange={(e) => handleItemSoldPriceChange(item.id, e.target.value)}
                        onBlur={() => handleItemSoldPriceBlur(item.id)}
                        onKeyDown={(e) => handlePriceInputArrowKey(e, itemPriceDrafts[item.id] ?? effectiveTotal, (v) => handleItemSoldPriceChange(item.id, v))}
                        aria-label={`Sold price for ${item.name}`}
                        className={`w-20 bg-warmgray-50 dark:bg-warmgray-800 border rounded-lg pl-4 pr-2 py-1.5 font-bold text-sm text-right focus:outline-none focus:ring-2 focus:ring-clay-400 ${NO_SPINNER_INPUT_CLASS} ${inputColorClass}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="p-3 border-t border-warmgray-100 dark:border-warmgray-700">
              <div className="flex justify-between items-center">
                <span className="text-warmgray-500 dark:text-warmgray-400 font-semibold text-sm">Total</span>
                <div className="flex items-center gap-2">
                  {reviewTotal !== cartTotal && (
                    <span
                      className={`flex-shrink-0 flex items-center gap-0.5 text-xs font-bold ${
                        reviewTotal > cartTotal ? "text-sage-600 dark:text-sage-400" : "text-rust-600 dark:text-rust-400"
                      }`}
                    >
                      {reviewTotal > cartTotal ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                      {cartTotal > 0 ? Math.abs(((reviewTotal - cartTotal) / cartTotal) * 100).toFixed(1) : "0.0"}%
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={resetAllPrices}
                    disabled={Object.keys(priceOverrides).length === 0}
                    aria-label="Reset all prices to catalog"
                    title="Reset all to catalog price"
                    className="flex-shrink-0 p-1.5 rounded-lg text-warmgray-400 hover:text-clay-600 dark:hover:text-clay-400 hover:bg-clay-50 dark:hover:bg-clay-950/40 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                  <div className="relative flex-shrink-0">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-black text-clay-600 dark:text-clay-400">₹</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={totalDraft ?? reviewTotal}
                      onChange={(e) => handleTotalChange(e.target.value)}
                      onBlur={handleTotalBlur}
                      onKeyDown={(e) => handlePriceInputArrowKey(e, totalDraft ?? reviewTotal, handleTotalChange)}
                      aria-label="Adjusted total"
                      className={`w-24 bg-warmgray-50 dark:bg-warmgray-800 border border-warmgray-200 dark:border-warmgray-700 rounded-lg pl-5 pr-2 py-1.5 font-black text-right text-clay-600 dark:text-clay-400 focus:outline-none focus:ring-2 focus:ring-clay-400 ${NO_SPINNER_INPUT_CLASS}`}
                    />
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : checkoutStep === "loading" ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-warmgray-400">
            <Loader2 className="w-8 h-8 animate-spin text-clay-500" />
            <p className="text-sm font-semibold">Loading customer details…</p>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div>
              <Input
                type="text"
                className="w-full font-medium"
                placeholder="Customer Name"
                aria-label="Customer Name"
                value={customerName}
                onChange={(e) => {
                  setCustomerName(e.target.value);
                  setSelectedCustomer(null); // Clear selected customer if name changes
                }}
              />
            </div>
            <div className="relative">
              <Input
                type="tel" // Use type="tel" for phone numbers
                className="w-full font-medium"
                placeholder="Phone Number"
                aria-label="Phone Number"
                value={customerPhoneNumber}
                onChange={(e) => {
                  setCustomerPhoneNumber(e.target.value);
                  setSelectedCustomer(null); // Clear selected customer if phone changes
                }}
              />
              {showCustomerSuggestions && customerSuggestions.length > 0 && (
                <ul className="absolute z-10 w-full bg-white dark:bg-warmgray-800 border border-warmgray-200 dark:border-warmgray-700 rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                  {customerSuggestions.map((customer) => (
                    <li
                      key={customer.id}
                      onClick={() => {
                        setCustomerName(customer.name);
                        setCustomerPhoneNumber(customer.phoneNumber);
                        setSelectedCustomer(customer);
                        setShowCustomerSuggestions(false); // Hide suggestions after selection
                      }}
                      className="px-4 py-2 cursor-pointer hover:bg-warmgray-100 dark:hover:bg-warmgray-700 flex justify-between items-center gap-2"
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-ink-900 dark:text-ink-50 block truncate">{customer.name}</span>
                        <span className="text-warmgray-500 dark:text-warmgray-400 text-sm">{customer.phoneNumber}</span>
                      </div>
                      {customer.balance > 0 && (
                        <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap border bg-rust-100 dark:bg-rust-950 border-rust-200 dark:border-rust-700 text-rust-700 dark:text-rust-300">
                          ₹{formatINR(customer.balance)} owed
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-warmgray-50 dark:bg-warmgray-800/50 border border-warmgray-200 dark:border-warmgray-700">
              <span className="text-warmgray-500 dark:text-warmgray-400 font-semibold text-sm">Grand Total</span>
              <span className="text-2xl font-black text-clay-600 dark:text-clay-400">₹{formatINR(reviewTotal)}</span>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={showDiscardConfirm}
        onClose={() => setShowDiscardConfirm(false)}
        title="Discard Order?"
        panelClassName="max-w-sm"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" size="md" className="flex-1" onClick={() => setShowDiscardConfirm(false)}>
              Keep Editing
            </Button>
            <Button variant="danger" size="md" className="flex-1" onClick={confirmDiscardCustomerStep}>
              Discard
            </Button>
          </div>
        }
      >
        <div className="p-5">
          <p className="text-sm text-warmgray-600 dark:text-warmgray-300">
            The customer name and phone number you entered will be lost. The items in the cart will stay.
          </p>
        </div>
      </Modal>

      <Modal
        isOpen={showClearCartConfirm}
        onClose={() => setShowClearCartConfirm(false)}
        title="Clear Order?"
        panelClassName="max-w-sm"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" size="md" className="flex-1" onClick={() => setShowClearCartConfirm(false)}>
              Keep Order
            </Button>
            <Button variant="danger" size="md" className="flex-1" onClick={confirmClearCart}>
              Clear Order
            </Button>
          </div>
        }
      >
        <div className="p-5">
          <p className="text-sm text-warmgray-600 dark:text-warmgray-300">
            This empties the cart and clears any customer details entered so far. This can&apos;t be undone.
          </p>
        </div>
      </Modal>

      <CustomerLookupModal
        isOpen={showCustomerLookup}
        onClose={() => setShowCustomerLookup(false)}
        onBillCustomer={handleBillCustomer}
      />

      <PaymentModal
        isOpen={showPaymentModal}
        total={reviewTotal}
        customerBalance={currentCustomerBalance}
        onClose={() => setShowPaymentModal(false)}
        onConfirm={handleCheckout}
      />

      <ReceiptModal
        isOpen={showReceipt}
        transaction={receiptData}
        onClose={() => {
          setShowReceipt(false);
          setReceiptData(null);
          resetOrderState();
        }}
      />
    </main>
  );
}