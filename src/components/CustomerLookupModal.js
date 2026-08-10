"use client";

import { useState } from "react";
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

export default function CustomerLookupModal({ isOpen, onClose, onBillCustomer }) {
  const [phoneQuery, setPhoneQuery] = useState("");
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const resetAndClose = () => {
    setPhoneQuery("");
    setMatches([]);
    setSearched(false);
    setSelectedCustomer(null);
    setTransactions([]);
    onClose?.();
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!phoneQuery.trim()) return;
    setSearching(true);
    setSelectedCustomer(null);
    setTransactions([]);
    try {
      const q = query(
        collection(db, "customers"),
        where("phoneNumber", ">=", phoneQuery),
        where("phoneNumber", "<=", phoneQuery + "")
      );
      const snapshot = await getDocs(q);
      setMatches(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (error) {
      console.error("Customer search failed: ", error);
      setMatches([]);
    } finally {
      setSearching(false);
      setSearched(true);
    }
  };

  const handleSelectCustomer = async (customer) => {
    setSelectedCustomer(customer);
    setLoadingHistory(true);
    try {
      // Filtered by phone only (no orderBy) so this doesn't require a
      // composite Firestore index; sorted client-side instead.
      const q = query(
        collection(db, "transactions"),
        where("customer.phoneNumber", "==", customer.phoneNumber)
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
  };

  if (!isOpen) return null;

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
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="tel"
              value={phoneQuery}
              onChange={(e) => setPhoneQuery(e.target.value)}
              placeholder="Search by phone number"
              className="flex-1 px-4 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-1 focus:ring-emerald-500 text-gray-900 dark:text-white font-medium text-sm"
            />
            <button
              type="submit"
              disabled={!phoneQuery.trim() || searching}
              className="px-4 py-2.5 rounded-lg font-bold text-sm text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-200 dark:disabled:bg-gray-800 disabled:text-gray-400 transition-colors"
            >
              {searching ? "Searching..." : "Search"}
            </button>
          </form>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!selectedCustomer ? (
            <div className="px-5 py-4">
              {searching ? (
                <p className="text-sm text-gray-400 text-center py-6">Searching...</p>
              ) : searched && matches.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No customer found.</p>
              ) : (
                matches.length > 0 && (
                  <ul className="space-y-2">
                    {matches.map((customer) => (
                      <li key={customer.id}>
                        <button
                          onClick={() => handleSelectCustomer(customer)}
                          className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                        >
                          <p className="font-bold text-gray-900 dark:text-white text-sm">{customer.name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{customer.phoneNumber}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              )}
              {!searched && !searching && (
                <p className="text-sm text-gray-400 text-center py-6">
                  Enter a phone number to find a customer.
                </p>
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

        {selectedCustomer && (
          <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800">
            <button
              onClick={() => {
                onBillCustomer?.(selectedCustomer);
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
