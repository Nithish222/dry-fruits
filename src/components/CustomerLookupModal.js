"use client";

import { useEffect, useState } from "react";
import { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatINR, roundRs } from "@/lib/format";
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

// Shared by "Record Payment" and "Set Opening Balance" - one atomic
// transaction that reads the customer's current balance, applies the
// signed delta (debit = balance up, credit = balance down), and appends the
// entries-subcollection doc that explains it. Returns the new balance so
// the caller can update local state without a second read.
async function addLedgerEntry(phoneNumber, { type, amount, note }) {
  const customerRef = doc(db, "customers", phoneNumber);
  const entryRef = doc(collection(db, "customers", phoneNumber, "entries"));
  const roundedAmount = roundRs(amount);
  let newBalance = 0;

  await runTransaction(db, async (transaction) => {
    const customerDoc = await transaction.get(customerRef);
    const currentBalance = customerDoc.exists() ? customerDoc.data().balance || 0 : 0;
    const delta = type === "debit" ? roundedAmount : -roundedAmount;
    newBalance = roundRs(currentBalance + delta);

    transaction.set(customerRef, { balance: newBalance }, { merge: true });
    transaction.set(entryRef, { type, amount: roundedAmount, note, createdAt: serverTimestamp() });
  });

  return newBalance;
}

export default function CustomerLookupModal({ isOpen, onClose, onBillCustomer, initialCustomer }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [allCustomers, setAllCustomers] = useState([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  const [selectedCustomer, setSelectedCustomer] = useState(initialCustomer || null);
  const [transactions, setTransactions] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [entries, setEntries] = useState([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [entriesRefreshKey, setEntriesRefreshKey] = useState(0);

  const [activeForm, setActiveForm] = useState(null); // "payment" | "opening" | null
  const [formAmount, setFormAmount] = useState("");
  const [formNote, setFormNote] = useState("");
  const [savingEntry, setSavingEntry] = useState(false);
  const [entryError, setEntryError] = useState("");

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

  // Same one-shot pattern as the purchase-history fetch above. Re-runs
  // after Record Payment / Set Opening Balance via entriesRefreshKey, since
  // this is a plain getDocs, not a live listener.
  useEffect(() => {
    if (!isOpen || !selectedCustomer) return;
    async function fetchEntries() {
      setLoadingEntries(true);
      try {
        const snapshot = await getDocs(collection(db, "customers", selectedCustomer.phoneNumber, "entries"));
        const list = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)); // oldest first - a statement reads top to bottom
        setEntries(list);
      } catch (error) {
        console.error("Failed to load ledger entries: ", error);
        setEntries([]);
      } finally {
        setLoadingEntries(false);
      }
    }
    fetchEntries();
  }, [isOpen, selectedCustomer, entriesRefreshKey]);

  const resetAndClose = () => {
    setSearchQuery("");
    setSelectedCustomer(null);
    setTransactions([]);
    setEntries([]);
    setActiveForm(null);
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

  const balance = selectedCustomer?.balance || 0;

  // Pure prefix sum (via reduce, building a fresh array) rather than a
  // running total mutated across map iterations - see the dashboard pie
  // chart's identical fix earlier for why that pattern trips this
  // project's react-hooks/immutability lint rule.
  const entriesWithRunningBalance = entries.reduce((acc, entry) => {
    const prevBalance = acc.length > 0 ? acc[acc.length - 1].runningBalance : 0;
    const runningBalance = roundRs(prevBalance + (entry.type === "debit" ? entry.amount : -entry.amount));
    acc.push({ ...entry, runningBalance });
    return acc;
  }, []);
  const closingBalance =
    entriesWithRunningBalance.length > 0 ? entriesWithRunningBalance[entriesWithRunningBalance.length - 1].runningBalance : 0;

  const openForm = (formType) => {
    setActiveForm(formType);
    setFormAmount("");
    setFormNote("");
    setEntryError("");
  };

  const closeForm = () => {
    if (savingEntry) return;
    setActiveForm(null);
    setFormAmount("");
    setFormNote("");
    setEntryError("");
  };

  const handleSubmitEntry = async () => {
    const amountNum = Number(formAmount);
    if (!amountNum || amountNum <= 0) {
      setEntryError("Enter an amount greater than 0.");
      return;
    }
    setSavingEntry(true);
    setEntryError("");
    try {
      const type = activeForm === "opening" ? "debit" : "credit";
      const note = formNote.trim() || (activeForm === "opening" ? "Opening balance" : "Payment received");
      const newBalance = await addLedgerEntry(selectedCustomer.phoneNumber, { type, amount: amountNum, note });
      setSelectedCustomer((prev) => (prev ? { ...prev, balance: newBalance } : prev));
      setEntriesRefreshKey((key) => key + 1);
      setActiveForm(null);
      setFormAmount("");
      setFormNote("");
    } catch (error) {
      console.error("Failed to record ledger entry: ", error);
      setEntryError(error.message || "Failed to save - try again.");
    } finally {
      setSavingEntry(false);
    }
  };

  return (
    <>
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
      <div className="px-5 py-4 border-b border-warmgray-100 dark:border-warmgray-700 flex-shrink-0 print:hidden">
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
                      className="w-full text-left px-4 py-3 rounded-xl border border-warmgray-200 dark:border-warmgray-700 hover:bg-warmgray-50 dark:hover:bg-warmgray-800 transition-colors flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-ink-900 dark:text-ink-50 text-sm truncate">{customer.name}</p>
                        <p className="text-xs text-warmgray-500 dark:text-warmgray-400">{customer.phoneNumber}</p>
                      </div>
                      {customer.balance > 0 && (
                        <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap border bg-rust-100 dark:bg-rust-950 border-rust-200 dark:border-rust-700 text-rust-700 dark:text-rust-300">
                          ₹{formatINR(customer.balance)} owed
                        </span>
                      )}
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
                setEntries([]);
                setActiveForm(null);
              }}
              className="text-xs font-bold text-warmgray-500 dark:text-warmgray-400 hover:text-ink-900 dark:hover:text-ink-50 mb-4 print:hidden"
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

            <div
              className={`flex justify-between items-center px-4 py-3 rounded-xl border mb-3 ${
                balance > 0
                  ? "bg-rust-50 dark:bg-rust-950/40 border-rust-200 dark:border-rust-800"
                  : balance < 0
                  ? "bg-sage-50 dark:bg-sage-950/40 border-sage-200 dark:border-sage-800"
                  : "bg-warmgray-50 dark:bg-warmgray-800/50 border-warmgray-200 dark:border-warmgray-700"
              }`}
            >
              <span
                className={`text-xs font-bold uppercase ${
                  balance > 0
                    ? "text-rust-800 dark:text-rust-300"
                    : balance < 0
                    ? "text-sage-800 dark:text-sage-300"
                    : "text-warmgray-500 dark:text-warmgray-400"
                }`}
              >
                {balance > 0 ? "Owes Shop" : balance < 0 ? "Shop Owes Customer" : "Balance Settled"}
              </span>
              <span
                className={`text-lg font-black ${
                  balance > 0
                    ? "text-rust-700 dark:text-rust-400"
                    : balance < 0
                    ? "text-sage-700 dark:text-sage-400"
                    : "text-warmgray-600 dark:text-warmgray-300"
                }`}
              >
                ₹{formatINR(Math.abs(balance))}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4 print:hidden">
              <button
                onClick={() => openForm("payment")}
                className="py-2.5 rounded-xl text-xs font-bold border border-sage-300 dark:border-sage-700 text-sage-700 dark:text-sage-400 hover:bg-sage-50 dark:hover:bg-sage-950/40 transition-colors"
              >
                Record Payment
              </button>
              <button
                onClick={() => openForm("opening")}
                className="py-2.5 rounded-xl text-xs font-bold border border-warmgray-200 dark:border-warmgray-700 text-warmgray-600 dark:text-warmgray-400 hover:bg-warmgray-50 dark:hover:bg-warmgray-800 transition-colors"
              >
                Opening Balance
              </button>
            </div>

            {activeForm && (
              <div className="mb-4 p-4 rounded-xl border border-warmgray-200 dark:border-warmgray-700 bg-warmgray-50 dark:bg-warmgray-800/50 space-y-3 print:hidden">
                <p className="text-xs font-bold uppercase text-ink-900 dark:text-ink-50">
                  {activeForm === "payment" ? "Record Payment Received" : "Set Opening Balance"}
                </p>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  size="sm"
                  autoFocus
                  className="w-full font-bold"
                  placeholder="Amount"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                />
                <Input
                  type="text"
                  size="sm"
                  className="w-full"
                  placeholder={activeForm === "payment" ? "Note (optional)" : "Note (optional, e.g. pre-app due)"}
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                />
                {entryError && <p className="text-xs font-semibold text-rust-600 dark:text-rust-400">{entryError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={closeForm}
                    disabled={savingEntry}
                    className="flex-1 py-2 rounded-lg text-xs font-bold text-warmgray-600 dark:text-warmgray-400 border border-warmgray-200 dark:border-warmgray-700 hover:bg-warmgray-100 dark:hover:bg-warmgray-700 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmitEntry}
                    disabled={savingEntry}
                    className="flex-1 py-2 rounded-lg text-xs font-bold text-white bg-clay-400 hover:bg-clay-600 disabled:opacity-50"
                  >
                    {savingEntry ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            )}

            <div className="flex justify-between items-center px-4 py-3 rounded-xl bg-clay-50 dark:bg-clay-950/40 border border-clay-200 dark:border-clay-800 mb-4 print:hidden">
              <span className="text-xs font-bold uppercase text-clay-800 dark:text-clay-300">
                Lifetime Purchases
              </span>
              <span className="text-lg font-black text-clay-700 dark:text-clay-400">
                {loadingHistory ? "..." : `₹${formatINR(lifetimeTotal)}`}
              </span>
            </div>

            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase text-warmgray-500 dark:text-warmgray-400">
                Account Statement {entries.length > 0 ? `(${entries.length})` : ""}
              </p>
              {entries.length > 0 && (
                <button
                  onClick={() => window.print()}
                  className="text-xs font-bold text-clay-600 dark:text-clay-400 hover:underline print:hidden"
                >
                  Print Statement
                </button>
              )}
            </div>

            {loadingEntries ? (
              <p className="text-sm text-warmgray-400 text-center py-6">Loading statement...</p>
            ) : entries.length === 0 ? (
              <p className="text-sm text-warmgray-400 text-center py-6 print:hidden">No ledger activity yet.</p>
            ) : (
              <div id="customer-statement" className="space-y-1.5 mb-6">
                <div className="hidden print:block mb-3">
                  <p className="font-bold text-black">{selectedCustomer.name} — Account Statement</p>
                  <p className="text-xs text-gray-600">{selectedCustomer.phoneNumber}</p>
                </div>
                {entriesWithRunningBalance.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex justify-between items-center px-3 py-2 rounded-lg border border-warmgray-100 dark:border-warmgray-800 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-900 dark:text-ink-50 truncate">
                        {entry.note || (entry.type === "debit" ? "Debit" : "Payment")}
                      </p>
                      <p className="text-warmgray-400">{formatDate(entry.createdAt)}</p>
                    </div>
                    <div className="text-right flex-shrink-0 pl-2">
                      <p
                        className={`font-bold ${
                          entry.type === "debit" ? "text-rust-600 dark:text-rust-400" : "text-sage-600 dark:text-sage-400"
                        }`}
                      >
                        {entry.type === "debit" ? "+" : "−"}₹{formatINR(entry.amount)}
                      </p>
                      <p className="text-warmgray-400">Bal ₹{formatINR(entry.runningBalance)}</p>
                    </div>
                  </div>
                ))}
                <div className="flex justify-between items-center px-3 py-2.5 mt-2 border-t border-warmgray-200 dark:border-warmgray-700 font-bold text-sm">
                  <span className="text-ink-900 dark:text-ink-50">Closing Balance</span>
                  <span className={closingBalance >= 0 ? "text-rust-700 dark:text-rust-400" : "text-sage-700 dark:text-sage-400"}>
                    ₹{formatINR(Math.abs(closingBalance))}
                  </span>
                </div>
              </div>
            )}

            <p className="text-xs font-bold uppercase text-warmgray-500 dark:text-warmgray-400 mb-2 print:hidden">
              Purchase History {transactions.length > 0 ? `(${transactions.length})` : ""}
            </p>

            {loadingHistory ? (
              <p className="text-sm text-warmgray-400 text-center py-6 print:hidden">Loading history...</p>
            ) : transactions.length === 0 ? (
              <p className="text-sm text-warmgray-400 text-center py-6 print:hidden">No past purchases.</p>
            ) : (
              <div className="space-y-2 print:hidden">
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

    <style>{`
      @media print {
        body * {
          visibility: hidden;
        }
        #customer-statement,
        #customer-statement * {
          visibility: visible;
        }
        #customer-statement {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
        }
      }
    `}</style>
    </>
  );
}
