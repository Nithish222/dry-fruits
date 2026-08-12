"use client";
import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatINR } from "@/lib/format";
import CustomerLookupModal from "@/components/CustomerLookupModal";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Skeleton from "@/components/ui/Skeleton";
import { Table, THead, Th, Tr, Td } from "@/components/ui/Table";
import { Wallet } from "@/components/ui/icons";

const SKELETON_ROWS = 6;

// Phase 1 of the Tally/Khata feature family - receivables only (customers
// who owe the shop). Phase 2 (supplier payables) and Phase 3 (a unified
// net-position dashboard covering both sides) extend this same page later;
// named "Tally" now rather than "Receivables" so it doesn't need renaming
// when that happens.
export default function TallyPage() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lookupCustomer, setLookupCustomer] = useState(null);
  const [showLookup, setShowLookup] = useState(false);

  // Real-time listener instead of a one-shot fetch, matching every other
  // page - Firestore serves the cached snapshot instantly on (re)subscribe.
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "customers"),
      (snapshot) => {
        setCustomers(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        setLoading(false);
      },
      (error) => {
        console.error("Error fetching customers: ", error);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const receivables = customers
    .filter((customer) => (customer.balance || 0) > 0)
    .sort((a, b) => (b.balance || 0) - (a.balance || 0));

  const totalReceivable = receivables.reduce((sum, customer) => sum + (customer.balance || 0), 0);

  const openLookup = (customer) => {
    setLookupCustomer({
      id: customer.phoneNumber,
      name: customer.name,
      phoneNumber: customer.phoneNumber,
      balance: customer.balance,
    });
    setShowLookup(true);
  };

  return (
    <main className="p-6 md:p-8 h-full flex flex-col w-full bg-cream-50 dark:bg-cream-950 min-h-screen transition-colors duration-300">
      <PageHeader title="Tally" subtitle="Customers who owe the shop" className="flex-shrink-0" />

      <div className="mb-6 flex-shrink-0 grid grid-cols-2 gap-px rounded-xl bg-warmgray-200 dark:bg-warmgray-700 overflow-hidden max-w-md">
        <div className="bg-warmgray-50 dark:bg-warmgray-800/50 px-5 py-5">
          <p className="text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400">Total Receivable</p>
          {loading ? (
            <Skeleton className="h-8 w-24 mt-1.5" />
          ) : (
            <p className="text-2xl font-black text-rust-600 dark:text-rust-400 mt-1.5">₹{formatINR(totalReceivable)}</p>
          )}
        </div>
        <div className="bg-warmgray-50 dark:bg-warmgray-800/50 px-5 py-5">
          <p className="text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400">Customers Owing</p>
          {loading ? (
            <Skeleton className="h-8 w-12 mt-1.5" />
          ) : (
            <p className="text-2xl font-black text-ink-900 dark:text-ink-50 mt-1.5">{receivables.length}</p>
          )}
        </div>
      </div>

      <Card padding="p-0" className="overflow-hidden flex-shrink-0">
        <div className="px-6 py-4 border-b border-warmgray-100 dark:border-warmgray-700 flex items-center gap-2">
          <Wallet className="w-4 h-4 text-warmgray-400" />
          <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50 tracking-wide uppercase">Receivables</h2>
        </div>
        <Table variant="comfortable">
          <THead>
            <Th>Customer</Th>
            <Th align="right">Balance Owed</Th>
          </THead>
          <tbody>
            {loading ? (
              Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <Tr key={i}>
                  <Td><Skeleton className="h-4 w-32" /></Td>
                  <Td align="right"><Skeleton className="h-4 w-16 ml-auto" /></Td>
                </Tr>
              ))
            ) : receivables.length === 0 ? (
              <tr>
                <td colSpan="2" className="text-center py-10 text-warmgray-500 dark:text-warmgray-400">
                  No outstanding balances - everyone&apos;s settled up.
                </td>
              </tr>
            ) : (
              receivables.map((customer) => (
                <Tr key={customer.id} onClick={() => openLookup(customer)} className="cursor-pointer">
                  <Td>
                    <p className="font-medium text-ink-900 dark:text-ink-50">{customer.name}</p>
                    <p className="text-xs text-warmgray-400">{customer.phoneNumber}</p>
                  </Td>
                  <Td align="right" className="font-bold text-rust-600 dark:text-rust-400">
                    ₹{formatINR(customer.balance)}
                  </Td>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>

      <CustomerLookupModal
        key={lookupCustomer?.id || "none"}
        isOpen={showLookup}
        initialCustomer={lookupCustomer}
        onClose={() => setShowLookup(false)}
      />
    </main>
  );
}
