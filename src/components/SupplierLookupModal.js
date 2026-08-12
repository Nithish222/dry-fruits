"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, getDocs, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatINR } from "@/lib/format";
import { addLedgerEntry } from "@/lib/ledger";
import Modal from "@/components/ui/Modal";
import Input from "@/components/ui/Input";
import LedgerStatement from "@/components/LedgerStatement";

// Tally Phase 2 (supplier payables) - deliberately standalone from
// inventory/purchases. No line items, no stock updates, no link to
// products: this is pure running-balance tracking, same as OkCredit/
// Khatabook keep a supplier khata decoupled from any Stock/Billing module.
// If purchases should ever also update stock automatically, that's a
// separate, larger feature - not in scope here.
//
// Mirrors CustomerLookupModal's shape closely (same entries subcollection
// via lib/ledger's addLedgerEntry, same LedgerStatement), but:
// - suppliers/{id} uses an auto-generated doc id (no phone-number-as-key,
//   since unlike checkout customers, a supplier is never looked up by
//   phone at a point of sale).
// - positive balance means the *shop* owes the *supplier* - the mirror
//   image of the customer ledger, where positive means the customer owes
//   the shop. Debit still means "balance up", credit still means "balance
//   down" - only the human-facing meaning of the sign flips.
// - no purchase-history section - suppliers aren't linked to `transactions`.
export default function SupplierLookupModal({ isOpen, onClose, initialSupplier }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [allSuppliers, setAllSuppliers] = useState([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);

  const [selectedSupplier, setSelectedSupplier] = useState(initialSupplier || null);

  const [entries, setEntries] = useState([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [entriesRefreshKey, setEntriesRefreshKey] = useState(0);

  const [activeForm, setActiveForm] = useState(null); // "purchase" | "payment" | "opening" | null
  const [formAmount, setFormAmount] = useState("");
  const [formNote, setFormNote] = useState("");
  const [savingEntry, setSavingEntry] = useState(false);
  const [entryError, setEntryError] = useState("");

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierPhone, setNewSupplierPhone] = useState("");
  const [newSupplierNotes, setNewSupplierNotes] = useState("");
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [createError, setCreateError] = useState("");

  // Only needed for the browse-and-search flow; skipped when a supplier
  // was handed to us directly.
  useEffect(() => {
    if (!isOpen || selectedSupplier) return;
    async function fetchSuppliers() {
      setLoadingSuppliers(true);
      try {
        const snapshot = await getDocs(collection(db, "suppliers"));
        setAllSuppliers(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      } catch (error) {
        console.error("Failed to load suppliers: ", error);
        setAllSuppliers([]);
      } finally {
        setLoadingSuppliers(false);
      }
    }
    fetchSuppliers();
  }, [isOpen, selectedSupplier]);

  // Same one-shot pattern as CustomerLookupModal's entries fetch - re-runs
  // after Record Purchase / Record Payment / Opening Balance via
  // entriesRefreshKey, since this is a plain getDocs, not a live listener.
  useEffect(() => {
    if (!isOpen || !selectedSupplier) return;
    async function fetchEntries() {
      setLoadingEntries(true);
      try {
        const snapshot = await getDocs(collection(db, "suppliers", selectedSupplier.id, "entries"));
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
  }, [isOpen, selectedSupplier, entriesRefreshKey]);

  const resetAndClose = () => {
    setSearchQuery("");
    setSelectedSupplier(null);
    setEntries([]);
    setActiveForm(null);
    setShowCreateForm(false);
    onClose?.();
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const matches = normalizedQuery
    ? allSuppliers.filter(
        (supplier) =>
          (supplier.name || "").toLowerCase().includes(normalizedQuery) ||
          (supplier.phone || "").toLowerCase().includes(normalizedQuery)
      )
    : allSuppliers;

  const balance = selectedSupplier?.balance || 0;

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
      // Purchase on credit and opening balance both raise what the shop
      // owes (debit); a payment made lowers it (credit) - mirrors the
      // customer ledger's debit-up/credit-down mechanics exactly.
      const type = activeForm === "payment" ? "credit" : "debit";
      const note =
        formNote.trim() ||
        (activeForm === "opening" ? "Opening balance" : activeForm === "payment" ? "Payment made" : "Credit purchase");
      const newBalance = await addLedgerEntry("suppliers", selectedSupplier.id, { type, amount: amountNum, note });
      setSelectedSupplier((prev) => (prev ? { ...prev, balance: newBalance } : prev));
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

  const handleCreateSupplier = async () => {
    const name = newSupplierName.trim();
    if (!name) {
      setCreateError("Enter a supplier name.");
      return;
    }
    setCreatingSupplier(true);
    setCreateError("");
    try {
      const docRef = await addDoc(collection(db, "suppliers"), {
        name,
        phone: newSupplierPhone.trim(),
        notes: newSupplierNotes.trim(),
        balance: 0,
        createdAt: serverTimestamp(),
      });
      const created = { id: docRef.id, name, phone: newSupplierPhone.trim(), notes: newSupplierNotes.trim(), balance: 0 };
      setAllSuppliers((prev) => [...prev, created]);
      setSelectedSupplier(created);
      setShowCreateForm(false);
      setNewSupplierName("");
      setNewSupplierPhone("");
      setNewSupplierNotes("");
    } catch (error) {
      console.error("Failed to create supplier: ", error);
      setCreateError(error.message || "Failed to save - try again.");
    } finally {
      setCreatingSupplier(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={resetAndClose} title="Supplier Lookup" panelClassName="max-w-md max-h-[85vh]">
      <div className="px-5 py-4 border-b border-warmgray-100 dark:border-warmgray-700 flex-shrink-0 print:hidden flex items-center gap-2">
        <Input
          type="text"
          size="md"
          className="w-full font-medium text-sm"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name or phone number"
          aria-label="Search by name or phone number"
        />
        {!selectedSupplier && (
          <button
            onClick={() => {
              setShowCreateForm((v) => !v);
              setCreateError("");
            }}
            className="flex-shrink-0 text-xs font-bold px-3 py-2.5 rounded-lg text-clay-700 dark:text-clay-400 bg-clay-50 dark:bg-clay-950/40 border border-clay-200 dark:border-clay-800 hover:bg-clay-100 dark:hover:bg-clay-900 transition-colors whitespace-nowrap"
          >
            + New
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {!selectedSupplier ? (
          <div className="px-5 py-4">
            {showCreateForm && (
              <div className="mb-4 p-4 rounded-xl border border-warmgray-200 dark:border-warmgray-700 bg-warmgray-50 dark:bg-warmgray-800/50 space-y-3">
                <p className="text-xs font-bold uppercase text-ink-900 dark:text-ink-50">New Supplier</p>
                <Input
                  type="text"
                  size="sm"
                  autoFocus
                  className="w-full"
                  placeholder="Name"
                  value={newSupplierName}
                  onChange={(e) => setNewSupplierName(e.target.value)}
                />
                <Input
                  type="text"
                  size="sm"
                  className="w-full"
                  placeholder="Phone (optional)"
                  value={newSupplierPhone}
                  onChange={(e) => setNewSupplierPhone(e.target.value)}
                />
                <Input
                  type="text"
                  size="sm"
                  className="w-full"
                  placeholder="Notes (optional)"
                  value={newSupplierNotes}
                  onChange={(e) => setNewSupplierNotes(e.target.value)}
                />
                {createError && <p className="text-xs font-semibold text-rust-600 dark:text-rust-400">{createError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowCreateForm(false)}
                    disabled={creatingSupplier}
                    className="flex-1 py-2 rounded-lg text-xs font-bold text-warmgray-600 dark:text-warmgray-400 border border-warmgray-200 dark:border-warmgray-700 hover:bg-warmgray-100 dark:hover:bg-warmgray-700 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateSupplier}
                    disabled={creatingSupplier}
                    className="flex-1 py-2 rounded-lg text-xs font-bold text-white bg-clay-400 hover:bg-clay-600 disabled:opacity-50"
                  >
                    {creatingSupplier ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            )}

            {loadingSuppliers ? (
              <p className="text-sm text-warmgray-400 text-center py-6">Loading suppliers...</p>
            ) : matches.length === 0 ? (
              <p className="text-sm text-warmgray-400 text-center py-6">
                {normalizedQuery ? "No supplier found." : "No suppliers yet - add one to get started."}
              </p>
            ) : (
              <ul className="space-y-2">
                {matches.map((supplier) => (
                  <li key={supplier.id}>
                    <button
                      onClick={() => setSelectedSupplier(supplier)}
                      className="w-full text-left px-4 py-3 rounded-xl border border-warmgray-200 dark:border-warmgray-700 hover:bg-warmgray-50 dark:hover:bg-warmgray-800 transition-colors flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-ink-900 dark:text-ink-50 text-sm truncate">{supplier.name}</p>
                        {supplier.phone && <p className="text-xs text-warmgray-500 dark:text-warmgray-400">{supplier.phone}</p>}
                      </div>
                      {(supplier.balance || 0) > 0 && (
                        <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap border bg-rust-100 dark:bg-rust-950 border-rust-200 dark:border-rust-700 text-rust-700 dark:text-rust-300">
                          ₹{formatINR(supplier.balance)} owed
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
                setSelectedSupplier(null);
                setEntries([]);
                setActiveForm(null);
              }}
              className="text-xs font-bold text-warmgray-500 dark:text-warmgray-400 hover:text-ink-900 dark:hover:text-ink-50 mb-4 print:hidden"
            >
              &larr; Back to results
            </button>

            <div className="mb-4">
              <p className="font-bold text-ink-900 dark:text-ink-50 text-base">{selectedSupplier.name}</p>
              {selectedSupplier.phone && (
                <p className="text-xs text-warmgray-500 dark:text-warmgray-400">{selectedSupplier.phone}</p>
              )}
              {selectedSupplier.notes && (
                <p className="text-xs text-warmgray-400 dark:text-warmgray-500 mt-0.5">{selectedSupplier.notes}</p>
              )}
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
                {balance > 0 ? "You Owe Supplier" : balance < 0 ? "Supplier Owes You" : "Balance Settled"}
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

            <div className="grid grid-cols-2 gap-2 mb-2 print:hidden">
              <button
                onClick={() => openForm("purchase")}
                className="py-2.5 rounded-xl text-xs font-bold border border-rust-300 dark:border-rust-700 text-rust-700 dark:text-rust-400 hover:bg-rust-50 dark:hover:bg-rust-950/40 transition-colors"
              >
                Record Purchase
              </button>
              <button
                onClick={() => openForm("payment")}
                className="py-2.5 rounded-xl text-xs font-bold border border-sage-300 dark:border-sage-700 text-sage-700 dark:text-sage-400 hover:bg-sage-50 dark:hover:bg-sage-950/40 transition-colors"
              >
                Record Payment
              </button>
            </div>
            <div className="mb-4 print:hidden">
              <button
                onClick={() => openForm("opening")}
                className="w-full py-2.5 rounded-xl text-xs font-bold border border-warmgray-200 dark:border-warmgray-700 text-warmgray-600 dark:text-warmgray-400 hover:bg-warmgray-50 dark:hover:bg-warmgray-800 transition-colors"
              >
                Opening Balance
              </button>
            </div>

            {activeForm && (
              <div className="mb-4 p-4 rounded-xl border border-warmgray-200 dark:border-warmgray-700 bg-warmgray-50 dark:bg-warmgray-800/50 space-y-3 print:hidden">
                <p className="text-xs font-bold uppercase text-ink-900 dark:text-ink-50">
                  {activeForm === "purchase"
                    ? "Record Purchase on Credit"
                    : activeForm === "payment"
                    ? "Record Payment Made"
                    : "Set Opening Balance"}
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
                  placeholder={activeForm === "opening" ? "Note (optional, e.g. pre-app due)" : "Note (optional)"}
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

            <LedgerStatement
              entries={entries}
              loading={loadingEntries}
              printElementId="supplier-statement"
              accountName={selectedSupplier.name}
              accountSubtitle={selectedSupplier.phone}
              debitLabel="Purchase"
              creditLabel="Payment"
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
