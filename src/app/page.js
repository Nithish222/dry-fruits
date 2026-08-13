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
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import Skeleton from "@/components/ui/Skeleton";
import { ShoppingCart, X } from "@/components/ui/icons";

const CATALOG_SKELETON_TILES = 8;

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
  const [cart, setCart] = useState([]);
  const [priceType, setPriceType] = useState("retail");
  const [showReceipt, setShowReceipt] = useState(false);
  const [receiptData, setReceiptData] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showCustomerLookup, setShowCustomerLookup] = useState(false);

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

  const categories = Array.from(
    new Set(products.map((p) => (p.category || "").trim()).filter(Boolean))
  ).sort();
  const filteredProducts = products.filter((product) => {
    const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = !categoryFilter || (product.category || "").trim() === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const addToCart = (product) => {
    const activePrice = priceType === "retail" ? product.retail_price_per_kg : product.wholesale_price_per_kg;
    setCart((prevCart) => {
      if (prevCart.find((item) => item.id === product.id)) return prevCart;
      return [...prevCart, { ...product, weight_kg: 0, unit: "kg", billedPrice: activePrice }];
    });
  };

  const handlePriceTypeChange = (newType) => {
    setPriceType(newType);
    setCart((prevCart) =>
      prevCart.map((item) => ({
        ...item,
        billedPrice: newType === "retail" ? item.retail_price_per_kg : item.wholesale_price_per_kg,
      }))
    );
  };

  const updateWeight = (id, newWeightVal) => {
    setCart((prevCart) =>
      prevCart.map((item) => {
        if (item.id === id) {
          const kgValue = item.unit === "gm" ? Number(newWeightVal) / 1000 : Number(newWeightVal);
          return { ...item, weight_kg: roundKg(kgValue) };
        }
        return item;
      })
    );
  };

  const addQuickWeight = (id, kgToAdd) => {
    setCart((prevCart) =>
      prevCart.map((item) =>
        item.id === id ? { ...item, weight_kg: roundKg(item.weight_kg + kgToAdd) } : item
      )
    );
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
  };

  const handleBillCustomer = (customer) => {
    setCustomerName(customer.name || "");
    setCustomerPhoneNumber(customer.phoneNumber || "");
    setSelectedCustomer(customer);
    setShowCustomerSuggestions(false);
  };

  const cartTotal = cart.reduce((total, item) => total + item.billedPrice * (item.weight_kg || 0), 0);

  // Best-effort - drawn from the same client-side customer list the
  // suggestion dropdown already loads, so it can be a snapshot behind a
  // just-recorded payment elsewhere. Fine for a warning, not a hard limit.
  const currentCustomerBalance =
    allCustomers?.find((c) => c.phoneNumber === customerPhoneNumber)?.balance || 0;

  const openPaymentModal = () => {
    if (cart.length === 0 || cartTotal <= 0) {
      alert("Cart is empty.");
      return;
    }
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
        id: item.id, name: item.name, weight_kg: item.weight_kg, billedPrice: item.billedPrice,
        cost_price_per_kg: item.cost_price_per_kg ?? null,
      })),
      customer: { name: customerName, phoneNumber: customerPhoneNumber },
      priceType,
      grandTotal: cartTotal,
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
        price: item.billedPrice,
        total: Number((item.billedPrice * (item.weight_kg || 0)).toFixed(2)),
      })),
      grandTotal: cartTotal,
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
          <div className="mb-6 flex gap-3">
            <Input
              type="text"
              size="lg"
              className="w-full font-semibold"
              placeholder="Search products by name... (e.g., Cashew, Raisin)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {categories.length > 0 && (
              <Select
                size="lg"
                className="flex-shrink-0 font-semibold"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                aria-label="Filter by category"
              >
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </Select>
            )}
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
                  const isLow = (product.stock_kg ?? 0) < LOW_STOCK_THRESHOLD_KG;
                  return (
                    <div
                      key={product.id}
                      onClick={() => addToCart(product)}
                      className="bg-white dark:bg-warmgray-800/50 rounded-2xl hover:border-clay-400 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer p-4 border border-warmgray-200 dark:border-warmgray-700 shadow-sm flex flex-col min-h-40 active:scale-95 active:translate-y-0"
                    >
                      <div className="flex items-start justify-between gap-2">
                        {product.category ? (
                          <span className="text-[10px] font-bold uppercase tracking-wide text-warmgray-400 truncate min-w-0">{product.category}</span>
                        ) : (
                          <span />
                        )}
                        <span
                          className={`flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap border ${
                            isLow
                              ? "bg-rust-100 dark:bg-rust-950 border-rust-200 dark:border-rust-700 text-rust-700 dark:text-rust-300"
                              : "bg-sage-100 dark:bg-sage-950 border-sage-200 dark:border-sage-700 text-sage-700 dark:text-sage-300"
                          }`}
                        >
                          {product.stock_kg}kg
                        </span>
                      </div>

                      <h3 className="font-medium text-ink-900 dark:text-ink-50 text-sm leading-snug line-clamp-2 min-h-[2.5rem] mt-1">
                        {product.name}
                      </h3>

                      <div className="mt-auto pt-3 border-t border-warmgray-100 dark:border-warmgray-700 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                        <div className="flex items-baseline gap-1">
                          <span className="text-xl font-black text-clay-800 dark:text-clay-400 tabular-nums">₹{formatINR(displayPrice)}</span>
                          <span className="text-xs font-bold text-warmgray-400">/kg</span>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wide text-warmgray-400 ml-auto">{priceType}</span>
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

          {/* Customer Input Section */}
          <div className="p-5 border-t border-warmgray-200 dark:border-warmgray-700 bg-cream-50 dark:bg-cream-950">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-md font-bold text-ink-900 dark:text-ink-50">Customer Details</h3>
              <button
                onClick={() => setShowCustomerLookup(true)}
                className="text-xs font-bold text-clay-600 dark:text-clay-400 hover:underline"
              >
                Lookup Customer
              </button>
            </div>
            <div className="space-y-3">
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
            </div>
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
              onClick={openPaymentModal}
              disabled={cart.length === 0 || cartTotal === 0}
            >
              Checkout & Pay
            </Button>
          </div>
        </Card>
      </div>

      <CustomerLookupModal
        isOpen={showCustomerLookup}
        onClose={() => setShowCustomerLookup(false)}
        onBillCustomer={handleBillCustomer}
      />

      <PaymentModal
        isOpen={showPaymentModal}
        total={cartTotal}
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
          setCart([]);
          // Clear customer details for next order
          setCustomerName("");
          setCustomerPhoneNumber("");
          setCustomerSuggestions([]);
          setSelectedCustomer(null);
        }}
      />
    </main>
  );
}