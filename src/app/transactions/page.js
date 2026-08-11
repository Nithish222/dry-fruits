"use client";
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatINR } from "@/lib/format";
import CustomerLookupModal from "@/components/CustomerLookupModal";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Badge from "@/components/ui/Badge";
import Skeleton from "@/components/ui/Skeleton";
import { Table, THead, Th, Tr, Td } from "@/components/ui/Table";

const SKELETON_ROWS = 6;

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [lookupCustomer, setLookupCustomer] = useState(null);
  const [showCustomerLookup, setShowCustomerLookup] = useState(false);

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

    // Items without a costPriceAtSale snapshot (sold before this feature
    // existed, or the product never had a cost price set) are treated as
    // ₹0 cost rather than dropped, so the profit figure still includes
    // their revenue - missingCostCount surfaces that the total is an
    // overestimate rather than silently presenting it as exact.
    let profit = 0;
    let missingCostCount = 0;
    for (const tx of todays) {
      for (const item of tx.items || []) {
        const weight = item.weight_kg || 0;
        const revenue = item.subtotal ?? (item.billedPrice || 0) * weight;
        if (item.costPriceAtSale != null && Number.isFinite(item.costPriceAtSale)) {
          profit += revenue - item.costPriceAtSale * weight;
        } else {
          profit += revenue;
          missingCostCount += 1;
        }
      }
    }

    return {
      count: todays.length,
      revenue: todays.reduce((sum, tx) => sum + (tx.grandTotal || 0), 0),
      profit,
      missingCostCount,
    };
  }, [transactions]);

  const openCustomerLookup = (customer) => {
    if (!customer?.phoneNumber) return;
    setLookupCustomer({
      id: customer.phoneNumber,
      name: customer.name,
      phoneNumber: customer.phoneNumber,
    });
    setShowCustomerLookup(true);
  };

  return (
    <main className="p-6 md:p-8 h-full flex flex-col w-full bg-cream-50 dark:bg-cream-950 min-h-screen transition-colors duration-300">
      <PageHeader title="Sales History" subtitle="Review all completed transactions" className="flex-shrink-0" />

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
                </Tr>
              ))
            ) : filteredTransactions.length === 0 ? (
              <tr>
                <td colSpan="5" className="text-center py-10 text-warmgray-500 dark:text-warmgray-400">
                  {searchQuery ? "No matching transactions found." : "No transactions found."}
                </td>
              </tr>
            ) : (
              filteredTransactions.map((tx) => (
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
                </Tr>
              ))
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
    </main>
  );
}
