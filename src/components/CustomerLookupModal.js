"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatINR } from "@/lib/format";
import Modal from "@/components/ui/Modal";
import Input from "@/components/ui/Input";

const HISTORY_DISPLAY_LIMIT = 20;

function formatDate(createdAt) {
  if (!createdAt) return "N/A";
  const date = createdAt.seconds ? new Date(createdAt.seconds * 1000) : new Date(createdAt);
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CustomerLookupModal({ isOpen, onClose, onBillCustomer, initialCustomer }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [allCustomers, setAllCustomers] = useState([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  const [selectedCustomer, setSelectedCustomer] = useState(initialCustomer || null);
  const [transactions, setTransactions] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Only needed for the browse-and-search flow; skipped when a customer
  // was handed to us directly (e.g. from a Sales History row).
  useEffect(() => {
    if (!isOpen || selectedCustomer) return;
    async function fetchCustomers() {
      setLoadingCustomers(true);
      try {
        const snapshot = await getDocs(collection(db, "customers"));
        setAllCustomers(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      } catch (error) {
        console.error("Failed to load customers: ", error);
        setAllCustomers([]);
      } finally {
        setLoadingCustomers(false);
      }
    }
    fetchCustomers();
  }, [isOpen, selectedCustomer]);

  // Runs whenever a customer becomes selected, whether via search or
  // handed to us directly.
  useEffect(() => {
    if (!isOpen || !selectedCustomer) return;
    async function fetchHistory() {
      setLoadingHistory(true);
      try {
        // Filtered by phone only (no orderBy) so this doesn't require a
        // composite Firestore index; sorted client-side instead.
        const q = query(
          collection(db, "transactions"),
          where("customer.phoneNumber", "==", selectedCustomer.phoneNumber)
        );
        const snapshot = await getDocs(q);
        const list = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        setTransactions(list);
      } catch (error) {
        console.error("Failed to load transaction history: ", error);
        setTransactions([]);
      } finally {
        setLoadingHistory(false);
      }
    }
    fetchHistory();
  }, [isOpen, selectedCustomer]);

  const resetAndClose = () => {
    setSearchQuery("");
    setSelectedCustomer(null);
    setTransactions([]);
    onClose?.();
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const matches = normalizedQuery
    ? allCustomers.filter(
        (customer) =>
          (customer.name || "").toLowerCase().includes(normalizedQuery) ||
          (customer.phoneNumber || "").toLowerCase().includes(normalizedQuery)
      )
    : [];

  const lifetimeTotal = transactions.reduce((sum, tx) => sum + (tx.grandTotal || 0), 0);
  const visibleTransactions = transactions.slice(0, HISTORY_DISPLAY_LIMIT);
  const hiddenCount = transactions.length - visibleTransactions.length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={resetAndClose}
      title="Customer Lookup"
      panelClassName="max-w-md max-h-[85vh]"
      footer={
        selectedCustomer && onBillCustomer ? (
          <button
            onClick={() => {
              onBillCustomer(selectedCustomer);
              resetAndClose();
            }}
            className="w-full py-3 rounded-xl font-bold text-sm text-white bg-clay-400 hover:bg-clay-600 transition-colors"
          >
            Bill This Customer
          </button>
        ) : null
      }
    >
      <div className="px-5 py-4 border-b border-warmgray-100 dark:border-warmgray-700 flex-shrink-0">
        <Input
          type="text"
          size="md"
          className="w-full font-medium text-sm"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name or phone number"
          aria-label="Search by name or phone number"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {!selectedCustomer ? (
          <div className="px-5 py-4">
            {loadingCustomers ? (
              <p className="text-sm text-warmgray-400 text-center py-6">Loading customers...</p>
            ) : !normalizedQuery ? (
              <p className="text-sm text-warmgray-400 text-center py-6">
                Type a name or phone number to find a customer.
              </p>
            ) : matches.length === 0 ? (
              <p className="text-sm text-warmgray-400 text-center py-6">No customer found.</p>
            ) : (
              <ul className="space-y-2">
                {matches.map((customer) => (
                  <li key={customer.id}>
                    <button
                      onClick={() => setSelectedCustomer(customer)}
                      className="w-full text-left px-4 py-3 rounded-xl border border-warmgray-200 dark:border-warmgray-700 hover:bg-warmgray-50 dark:hover:bg-warmgray-800 transition-colors"
                    >
                      <p className="font-bold text-ink-900 dark:text-ink-50 text-sm">{customer.name}</p>
                      <p className="text-xs text-warmgray-500 dark:text-warmgray-400">{customer.phoneNumber}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="px-5 py-4">
            <button
              onClick={() => {
                setSelectedCustomer(null);
                setTransactions([]);
              }}
              className="text-xs font-bold text-warmgray-500 dark:text-warmgray-400 hover:text-ink-900 dark:hover:text-ink-50 mb-4"
            >
              &larr; Back to results
            </button>

            <div className="mb-4">
              <p className="font-bold text-ink-900 dark:text-ink-50 text-base">
                {selectedCustomer.name}
              </p>
              <p className="text-xs text-warmgray-500 dark:text-warmgray-400">
                {selectedCustomer.phoneNumber}
              </p>
            </div>

            <div className="flex justify-between items-center px-4 py-3 rounded-xl bg-clay-50 dark:bg-clay-950/40 border border-clay-200 dark:border-clay-800 mb-4">
              <span className="text-xs font-bold uppercase text-clay-800 dark:text-clay-300">
                Lifetime Purchases
              </span>
              <span className="text-lg font-black text-clay-700 dark:text-clay-400">
                {loadingHistory ? "..." : `₹${formatINR(lifetimeTotal)}`}
              </span>
            </div>

            <p className="text-xs font-bold uppercase text-warmgray-500 dark:text-warmgray-400 mb-2">
              Purchase History {transactions.length > 0 ? `(${transactions.length})` : ""}
            </p>

            {loadingHistory ? (
              <p className="text-sm text-warmgray-400 text-center py-6">Loading history...</p>
            ) : transactions.length === 0 ? (
              <p className="text-sm text-warmgray-400 text-center py-6">No past purchases.</p>
            ) : (
              <div className="space-y-2">
                {visibleTransactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex justify-between items-center px-4 py-2.5 rounded-lg border border-warmgray-100 dark:border-warmgray-800"
                  >
                    <div>
                      <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">
                        {formatDate(tx.createdAt)}
                      </p>
                      <p className="text-xs text-warmgray-500 dark:text-warmgray-400">
                        {(tx.items || []).length} item{(tx.items || []).length === 1 ? "" : "s"} &middot;{" "}
                        {tx.priceType || "retail"}
                      </p>
                    </div>
                    <span className="font-bold text-ink-900 dark:text-ink-50 text-sm">
                      ₹{formatINR(tx.grandTotal)}
                    </span>
                  </div>
                ))}
                {hiddenCount > 0 && (
                  <p className="text-xs text-warmgray-400 text-center pt-2">
                    +{hiddenCount} earlier order{hiddenCount === 1 ? "" : "s"} not shown
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
