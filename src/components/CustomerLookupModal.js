"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatINR } from "@/lib/format";

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

  if (!isOpen) return null;

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={resetAndClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white tracking-wide uppercase">
            Customer Lookup
          </h2>
          <button
            onClick={resetAndClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or phone number"
            className="w-full px-4 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-1 focus:ring-emerald-500 text-gray-900 dark:text-white font-medium text-sm"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {!selectedCustomer ? (
            <div className="px-5 py-4">
              {loadingCustomers ? (
                <p className="text-sm text-gray-400 text-center py-6">Loading customers...</p>
              ) : !normalizedQuery ? (
                <p className="text-sm text-gray-400 text-center py-6">
                  Type a name or phone number to find a customer.
                </p>
              ) : matches.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No customer found.</p>
              ) : (
                <ul className="space-y-2">
                  {matches.map((customer) => (
                    <li key={customer.id}>
                      <button
                        onClick={() => setSelectedCustomer(customer)}
                        className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      >
                        <p className="font-bold text-gray-900 dark:text-white text-sm">{customer.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{customer.phoneNumber}</p>
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
                className="text-xs font-bold text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 mb-4"
              >
                &larr; Back to results
              </button>

              <div className="mb-4">
                <p className="font-bold text-gray-900 dark:text-white text-base">
                  {selectedCustomer.name}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {selectedCustomer.phoneNumber}
                </p>
              </div>

              <div className="flex justify-between items-center px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 mb-4">
                <span className="text-xs font-bold uppercase text-emerald-800 dark:text-emerald-400">
                  Lifetime Purchases
                </span>
                <span className="text-lg font-black text-emerald-700 dark:text-emerald-400">
                  {loadingHistory ? "..." : `₹${formatINR(lifetimeTotal)}`}
                </span>
              </div>

              <p className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-2">
                Purchase History {transactions.length > 0 ? `(${transactions.length})` : ""}
              </p>

              {loadingHistory ? (
                <p className="text-sm text-gray-400 text-center py-6">Loading history...</p>
              ) : transactions.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No past purchases.</p>
              ) : (
                <div className="space-y-2">
                  {visibleTransactions.map((tx) => (
                    <div
                      key={tx.id}
                      className="flex justify-between items-center px-4 py-2.5 rounded-lg border border-gray-100 dark:border-gray-800"
                    >
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">
                          {formatDate(tx.createdAt)}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {(tx.items || []).length} item{(tx.items || []).length === 1 ? "" : "s"} &middot;{" "}
                          {tx.priceType || "retail"}
                        </p>
                      </div>
                      <span className="font-bold text-gray-900 dark:text-white text-sm">
                        ₹{formatINR(tx.grandTotal)}
                      </span>
                    </div>
                  ))}
                  {hiddenCount > 0 && (
                    <p className="text-xs text-gray-400 text-center pt-2">
                      +{hiddenCount} earlier order{hiddenCount === 1 ? "" : "s"} not shown
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {selectedCustomer && onBillCustomer && (
          <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800">
            <button
              onClick={() => {
                onBillCustomer(selectedCustomer);
                resetAndClose();
              }}
              className="w-full py-3 rounded-xl font-bold text-sm text-white bg-gray-900 dark:bg-emerald-600 hover:bg-black dark:hover:bg-emerald-700 transition-colors"
            >
              Bill This Customer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
