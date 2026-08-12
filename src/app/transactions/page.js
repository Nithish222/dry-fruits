"use client";
import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, orderBy, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { formatINR, roundKg, roundRs, computeProfit } from "@/lib/format";
import { readVoucherPostContext, writeVoucherPost } from "@/lib/accounting";
import { buildReturnVoucherLines } from "@/lib/khataVouchers";
import { getSystemAccounts } from "@/lib/systemAccounts";
import CustomerLookupModal from "@/components/CustomerLookupModal";
import ReturnModal from "@/components/ReturnModal";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Skeleton from "@/components/ui/Skeleton";
import { Table, THead, Th, Tr, Td } from "@/components/ui/Table";
import { RotateCcw } from "@/components/ui/icons";

const SKELETON_ROWS = 6;

// Runs the stock-restoring, atomic Firestore write for a return. Mirrors
// commitTransactionToFirestore's stock-check pattern (src/app/page.js): item
// weights/prices are read fresh from the original transaction and product
// docs inside the transaction rather than trusted from the client. A
// returnSummaries doc - separate from the original transaction, which is
// never edited - tracks cumulative returned quantity per item so two
// concurrent returns (e.g. two tabs) can't refund more than was sold; a
// Firestore transaction can only re-read documents by reference, not run a
// query, so per-item running totals can't be derived from the `returns`
// collection atomically without it.
async function commitReturnToFirestore({ originalTransactionId, itemsToReturn, reason, processedBy }) {
  const returnRef = doc(collection(db, "returns"));
  const originalTransactionRef = doc(db, "transactions", originalTransactionId);
  const summaryRef = doc(db, "returnSummaries", originalTransactionId);
  const systemAccounts = await getSystemAccounts();
  // Assigned inside the transaction (same pattern as postVoucher/
  // cancelVoucher capturing voucherNumber outside their own transactions)
  // so the caller - and ultimately the cashier, via ReturnModal - knows
  // exactly how much of the refund reduced Udhaar vs. needs to physically
  // leave the till.
  let creditReduction = 0;
  let cashOrGpayRefund = 0;

  await runTransaction(db, async (transaction) => {
    const originalDoc = await transaction.get(originalTransactionRef);
    if (!originalDoc.exists()) {
      throw new Error("Original transaction not found.");
    }
    const summaryDoc = await transaction.get(summaryRef);
    const alreadyReturned = summaryDoc.exists() ? summaryDoc.data().returnedByItem || {} : {};
    const creditAlreadyReversed = summaryDoc.exists() ? summaryDoc.data().creditReversed || 0 : 0;
    const originalItems = originalDoc.data().items || [];
    const originalPayment = originalDoc.data().payment || {};
    const originalCustomer = originalDoc.data().customer || {};

    const productUpdates = [];
    const returnItems = [];
    const newReturnedByItem = { ...alreadyReturned };
    let refundAmount = 0;

    for (const request of itemsToReturn) {
      const originalItem = originalItems.find((item) => item.id === request.id);
      if (!originalItem) {
        throw new Error(`Item ${request.id} was not part of the original sale.`);
      }
      if (request.weight_kg <= 0) {
        throw new Error(`Return weight for ${originalItem.name} must be positive.`);
      }
      const remaining = roundKg(originalItem.weight_kg - (alreadyReturned[request.id] || 0));
      if (request.weight_kg > remaining) {
        throw new Error(`Cannot return ${request.weight_kg}kg of ${originalItem.name}. Only ${remaining}kg remaining.`);
      }

      // Product may have been deleted since the sale - still record the
      // refund, just skip restoring stock for that item.
      const productRef = doc(db, "products", request.id);
      const productDoc = await transaction.get(productRef);
      if (productDoc.exists()) {
        productUpdates.push({ ref: productRef, newStock: roundKg(productDoc.data().stock_kg + request.weight_kg) });
      }

      const subtotal = Math.round(originalItem.billedPrice * request.weight_kg * 100) / 100;
      refundAmount += subtotal;
      newReturnedByItem[request.id] = roundKg((alreadyReturned[request.id] || 0) + request.weight_kg);

      returnItems.push({
        id: originalItem.id,
        name: originalItem.name,
        weight_kg: request.weight_kg,
        billedPrice: originalItem.billedPrice,
        subtotal,
        costPriceAtSale: originalItem.costPriceAtSale ?? null,
      });
    }

    if (returnItems.length === 0) {
      throw new Error("Select at least one item to return.");
    }

    // Credit-first refund split (Phase 6): a return against a transaction
    // that had a credit component reduces the customer's Udhaar before any
    // cash/GPay leaves the till, bounded by however much of THAT sale's
    // credit hasn't already been reversed by an earlier partial return
    // (creditReversed, tracked cumulatively on returnSummaries alongside
    // the existing returnedByItem map). Still read-phase only below - no
    // writes yet.
    const roundedRefund = roundRs(refundAmount);
    const originalCreditAmount = roundRs(originalPayment.creditAmount || 0);
    const creditRemaining = roundRs(Math.max(originalCreditAmount - creditAlreadyReversed, 0));
    creditReduction = roundRs(Math.min(roundedRefund, creditRemaining));
    cashOrGpayRefund = roundRs(roundedRefund - creditReduction);
    const newCreditReversed = roundRs(creditAlreadyReversed + creditReduction);

    let customerRef = null;
    let customerDoc = null;
    if (creditReduction > 0) {
      customerRef = doc(db, "customers", originalCustomer.phoneNumber);
      customerDoc = await transaction.get(customerRef);
      if (!customerDoc.exists()) {
        throw new Error("Customer record not found - cannot reverse credit.");
      }
    }

    const voucherLines = buildReturnVoucherLines({
      refundAmount: roundedRefund,
      creditReduction,
      cashOrGpayRefund,
      originalPaymentMode: originalPayment.mode,
      systemAccounts,
    });
    const voucherDate = new Date().toISOString().slice(0, 10);
    const voucherContext = await readVoucherPostContext(transaction, { lines: voucherLines, voucherType: "journal", date: voucherDate });

    // ---- writes from here - every read above (existing + new) is done ----
    transaction.set(returnRef, {
      originalTransactionId,
      items: returnItems,
      refundAmount: roundedRefund,
      reason,
      createdAt: serverTimestamp(),
      processedBy,
    });
    transaction.set(summaryRef, { returnedByItem: newReturnedByItem, creditReversed: newCreditReversed }, { merge: true });

    for (const update of productUpdates) {
      transaction.update(update.ref, { stock_kg: update.newStock });
    }

    if (creditReduction > 0) {
      const currentBalance = customerDoc.data().balance || 0;
      transaction.set(customerRef, { balance: roundRs(currentBalance - creditReduction) }, { merge: true });
      const creditEntryRef = doc(collection(db, "customers", customerRef.id, "entries"));
      transaction.set(creditEntryRef, {
        type: "credit",
        amount: creditReduction,
        note: `Return refund against ${originalTransactionId}`,
        sourceReturnId: returnRef.id,
        createdAt: serverTimestamp(),
      });
    }

    writeVoucherPost(transaction, {
      lines: voucherLines,
      voucherType: "journal",
      date: voucherDate,
      narration: `Return against ${originalTransactionId}`,
      createdBy: processedBy,
      context: voucherContext,
    });
  });

  return { returnRef, creditReduction, cashOrGpayRefund };
}

// A sale is "fully" returned once every item's returned weight reaches its
// sold weight; "partially" once anything has come back but not everything.
function getReturnStatus(tx, returnInfo) {
  if (!returnInfo) return null;
  const items = tx.items || [];
  const totalSold = items.reduce((sum, item) => sum + (item.weight_kg || 0), 0);
  const totalReturned = items.reduce(
    (sum, item) => sum + Math.min(returnInfo.itemsReturned[item.id] || 0, item.weight_kg || 0),
    0
  );
  if (totalReturned <= 0) return null;
  return totalReturned >= totalSold - 0.0005 ? "full" : "partial";
}

export default function TransactionsPage() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState([]);
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [lookupCustomer, setLookupCustomer] = useState(null);
  const [showCustomerLookup, setShowCustomerLookup] = useState(false);
  const [returnTransaction, setReturnTransaction] = useState(null);
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  // Real-time listener instead of a one-shot fetch: Firestore serves the
  // cached snapshot instantly on (re)subscribe, so switching tabs and back
  // doesn't cause a visible reload, and it only pushes updates when sales
  // history actually changes in the DB.
  useEffect(() => {
    const q = query(collection(db, "transactions"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        const transactionsList = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setTransactions(transactionsList);
        setLoading(false);
      },
      (error) => {
        console.error("Error fetching transactions: ", error);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "returns"),
      (querySnapshot) => {
        setReturns(querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      },
      (error) => {
        console.error("Error fetching returns: ", error);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }
    function handleOffline() {
      setIsOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const returnsByTransaction = useMemo(() => {
    const map = {};
    for (const ret of returns) {
      const key = ret.originalTransactionId;
      if (!map[key]) map[key] = { refundAmount: 0, itemsReturned: {} };
      map[key].refundAmount += ret.refundAmount || 0;
      for (const item of ret.items || []) {
        map[key].itemsReturned[item.id] = roundKg((map[key].itemsReturned[item.id] || 0) + (item.weight_kg || 0));
      }
    }
    return map;
  }, [returns]);

  const filteredTransactions = transactions.filter((tx) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const name = tx.customer?.name?.toLowerCase() || "";
    const phone = tx.customer?.phoneNumber?.toLowerCase() || "";
    return name.includes(q) || phone.includes(q);
  });

  // "Today" is the cashier's local day, matching how dates are already
  // displayed in the table below (toLocaleString, no timezone conversion).
  const todayStats = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startSeconds = startOfToday.getTime() / 1000;
    const todays = transactions.filter((tx) => (tx.createdAt?.seconds || 0) >= startSeconds);
    const todaysReturns = returns.filter((ret) => (ret.createdAt?.seconds || 0) >= startSeconds);

    // Items without a costPriceAtSale snapshot (sold before this feature
    // existed, or the product never had a cost price set) are treated as
    // ₹0 cost rather than dropped, so the profit figure still includes
    // their revenue - missingCostCount surfaces that the total is an
    // overestimate rather than silently presenting it as exact.
    const sales = computeProfit(todays);

    // Returns are netted out by the day they were *processed*, not the day
    // of the original sale - the refund actually leaves the till today.
    const returnedRevenue = todaysReturns.reduce((sum, ret) => sum + (ret.refundAmount || 0), 0);
    const returned = computeProfit(todaysReturns);

    return {
      count: todays.length,
      revenue: todays.reduce((sum, tx) => sum + (tx.grandTotal || 0), 0) - returnedRevenue,
      profit: sales.profit - returned.profit,
      missingCostCount: sales.missingCostCount,
    };
  }, [transactions, returns]);

  const openCustomerLookup = (customer) => {
    if (!customer?.phoneNumber) return;
    setLookupCustomer({
      id: customer.phoneNumber,
      name: customer.name,
      phoneNumber: customer.phoneNumber,
    });
    setShowCustomerLookup(true);
  };

  const handleProcessReturn = async ({ originalTransactionId, itemsToReturn, reason }) => {
    return commitReturnToFirestore({
      originalTransactionId,
      itemsToReturn,
      reason,
      processedBy: { uid: user?.uid || null, email: user?.email || null },
    });
  };

  return (
    <main className="p-6 md:p-8 h-full flex flex-col w-full bg-cream-50 dark:bg-cream-950 min-h-screen transition-colors duration-300">
      <PageHeader
        title="Sales History"
        subtitle="Review all completed transactions"
        className="flex-shrink-0"
        actions={
          !isOnline && (
            <Badge variant="neutral" dot>
              Offline - returns unavailable
            </Badge>
          )
        }
      />

      <div className="mb-4 flex-shrink-0 grid grid-cols-3 gap-px rounded-xl bg-warmgray-200 dark:bg-warmgray-700 overflow-hidden">
        <div className="bg-warmgray-50 dark:bg-warmgray-800/50 px-5 py-5">
          <p className="text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400">Today&apos;s Revenue</p>
          <p className="text-2xl font-black text-clay-600 dark:text-clay-400 mt-1.5">₹{formatINR(todayStats.revenue)}</p>
        </div>
        <div className="bg-warmgray-50 dark:bg-warmgray-800/50 px-5 py-5">
          <p className="text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400">Today&apos;s Transactions</p>
          <p className="text-2xl font-black text-ink-900 dark:text-ink-50 mt-1.5">{todayStats.count}</p>
        </div>
        <div className="bg-warmgray-50 dark:bg-warmgray-800/50 px-5 py-5">
          <p className="text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400">Today&apos;s Profit</p>
          <p className="text-2xl font-black text-sage-600 dark:text-sage-400 mt-1.5">₹{formatINR(todayStats.profit)}</p>
          {todayStats.missingCostCount > 0 && (
            <p className="text-[10px] font-semibold text-rust-600 dark:text-rust-400 mt-1">
              {todayStats.missingCostCount} item{todayStats.missingCostCount === 1 ? "" : "s"} missing cost price - profit may be overstated
            </p>
          )}
        </div>
      </div>

      <div className="mb-4 flex-shrink-0">
        <Input
          type="text"
          size="lg"
          className="w-full max-w-md font-medium"
          placeholder="Search by customer name or phone number..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <Card padding="p-0" className="overflow-hidden flex-shrink-0">
        <Table variant="comfortable">
          <THead>
            <Th>Date</Th>
            <Th>Customer</Th>
            <Th>Total Items</Th>
            <Th>Price Mode</Th>
            <Th align="right">Total Amount</Th>
            <Th>Status</Th>
            <Th align="right">Actions</Th>
          </THead>
          <tbody>
            {loading ? (
              Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <Tr key={i}>
                  <Td><Skeleton className="h-4 w-28" /></Td>
                  <Td><Skeleton className="h-4 w-32" /></Td>
                  <Td><Skeleton className="h-4 w-10" /></Td>
                  <Td><Skeleton className="h-5 w-16 rounded-full" /></Td>
                  <Td align="right"><Skeleton className="h-4 w-16 ml-auto" /></Td>
                  <Td><Skeleton className="h-5 w-20 rounded-full" /></Td>
                  <Td align="right"><Skeleton className="h-8 w-20 ml-auto rounded-lg" /></Td>
                </Tr>
              ))
            ) : filteredTransactions.length === 0 ? (
              <tr>
                <td colSpan="7" className="text-center py-10 text-warmgray-500 dark:text-warmgray-400">
                  {searchQuery ? "No matching transactions found." : "No transactions found."}
                </td>
              </tr>
            ) : (
              filteredTransactions.map((tx) => {
                const returnInfo = returnsByTransaction[tx.id];
                const returnStatus = getReturnStatus(tx, returnInfo);
                return (
                  <Tr key={tx.id}>
                    <Td className="font-medium text-ink-900 dark:text-ink-50">
                      {tx.createdAt ? new Date(tx.createdAt.seconds * 1000).toLocaleString() : "N/A"}
                    </Td>
                    <Td>
                      {tx.customer?.phoneNumber ? (
                        <button
                          onClick={() => openCustomerLookup(tx.customer)}
                          className="text-left hover:underline"
                        >
                          <p className="font-medium text-ink-900 dark:text-ink-50">{tx.customer?.name || "N/A"}</p>
                          <p className="text-xs text-warmgray-400">{tx.customer?.phoneNumber}</p>
                        </button>
                      ) : (
                        <p className="font-medium text-ink-900 dark:text-ink-50">N/A</p>
                      )}
                    </Td>
                    <Td>{tx.items.length}</Td>
                    <Td>
                      <Badge variant={tx.priceType === "retail" ? "success" : "info"} size="sm">
                        {tx.priceType}
                      </Badge>
                    </Td>
                    <Td align="right" className="font-bold text-ink-900 dark:text-ink-50">
                      ₹{formatINR(tx.grandTotal)}
                    </Td>
                    <Td>
                      {returnStatus === "full" && (
                        <Badge variant="danger" size="sm">Fully Returned</Badge>
                      )}
                      {returnStatus === "partial" && (
                        <Badge variant="warning" size="sm">Partially Returned</Badge>
                      )}
                    </Td>
                    <Td align="right">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setReturnTransaction(tx)}
                        disabled={returnStatus === "full"}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Return
                      </Button>
                    </Td>
                  </Tr>
                );
              })
            )}
          </tbody>
        </Table>
      </Card>

      <CustomerLookupModal
        key={lookupCustomer?.id || "none"}
        isOpen={showCustomerLookup}
        initialCustomer={lookupCustomer}
        onClose={() => setShowCustomerLookup(false)}
      />

      <ReturnModal
        key={returnTransaction?.id || "none"}
        isOpen={!!returnTransaction}
        transaction={returnTransaction}
        returnedByItem={returnTransaction ? returnsByTransaction[returnTransaction.id]?.itemsReturned || {} : {}}
        isOnline={isOnline}
        onClose={() => setReturnTransaction(null)}
        onProcessReturn={handleProcessReturn}
      />
    </main>
  );
}
