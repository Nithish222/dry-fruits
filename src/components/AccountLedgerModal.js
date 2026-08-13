"use client";

import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatINR } from "@/lib/format";
import Modal from "@/components/ui/Modal";
import LedgerStatement from "@/components/LedgerStatement";

// Read-only per-account statement, structurally the "selected account ->
// fetch entries -> LedgerStatement" slice of SupplierLookupModal, but with
// no create/record-entry forms: under the double-entry engine, corrections
// happen through vouchers (New Voucher / Cancel), never by editing an
// account's ledger directly.
export default function AccountLedgerModal({ isOpen, onClose, account }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !account) return;
    async function fetchEntries() {
      setLoading(true);
      try {
        const snapshot = await getDocs(collection(db, "accounts", account.id, "entries"));
        const list = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
        setEntries(list);
      } catch (error) {
        console.error("Failed to load account entries: ", error);
        setEntries([]);
      } finally {
        setLoading(false);
      }
    }
    fetchEntries();
  }, [isOpen, account]);

  if (!account) return null;

  // currentBalance is always (debits - credits) - positive is always a net
  // debit position, negative always net credit, regardless of the
  // account's normalBalance (that only says which side is "healthy" for
  // this account, not what a given number's sign means). Same rule as the
  // Trial Balance table.
  const balance = account.currentBalance || 0;
  const sideLabel = balance >= 0 ? "dr" : "cr";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Account Ledger" panelClassName="max-w-md max-h-[85vh]">
      <div className="px-5 py-4 border-b border-warmgray-100 dark:border-warmgray-700 flex-shrink-0">
        <p className="font-bold text-ink-900 dark:text-ink-50 text-base">{account.name}</p>
        <div className="flex items-center justify-between mt-1">
          <p className="text-xs text-warmgray-500 dark:text-warmgray-400 capitalize">{account.category}</p>
          <p className="text-xs font-bold text-warmgray-600 dark:text-warmgray-300">
            Stored balance: ₹{formatINR(Math.abs(balance))} {sideLabel.toUpperCase()}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <LedgerStatement
          entries={entries}
          loading={loading}
          printElementId="account-statement"
          accountName={account.name}
          accountSubtitle={account.category}
          debitLabel="Debit"
          creditLabel="Credit"
        />
      </div>
    </Modal>
  );
}
