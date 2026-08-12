"use client";

import { useState } from "react";
import { addAccount, ACCOUNT_CATEGORIES } from "@/lib/accounting";
import { invalidateSystemAccountsCache } from "@/lib/systemAccounts";
import Modal from "@/components/ui/Modal";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";

const CATEGORY_LABELS = { asset: "Asset", liability: "Liability", equity: "Equity", income: "Income", expense: "Expense" };

// Tally Phase 6 - the only way to add a single ledger to an already-seeded
// Chart of Accounts (seedChartOfAccounts is a one-time, guarded bulk
// bootstrap and can't be reused for this). Also how the four system
// ledgers checkout/Khata wiring depends on (src/lib/systemAccounts.js) get
// created in production.
export default function AddAccountModal({ isOpen, onClose, accounts, createdBy }) {
  const groupOptions = accounts
    .filter((a) => a.isGroup && a.isActive !== false)
    .sort((a, b) => a.name.localeCompare(b.name));

  const [name, setName] = useState("");
  const [parentGroupId, setParentGroupId] = useState("");
  const [category, setCategory] = useState("asset");
  const [normalBalance, setNormalBalance] = useState("dr");
  const [isSystemAccount, setIsSystemAccount] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const resetAndClose = () => {
    if (saving) return;
    setName("");
    setParentGroupId("");
    setCategory("asset");
    setNormalBalance("dr");
    setIsSystemAccount(false);
    setError("");
    onClose?.();
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError("");
    try {
      await addAccount({ name, parentGroupId, category, normalBalance, isSystemAccount, createdBy });
      invalidateSystemAccountsCache();
      resetAndClose();
    } catch (err) {
      console.error("Failed to add account: ", err);
      setError(err.message || "Failed to add account - try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={resetAndClose}
      title="Add Account"
      panelClassName="max-w-md"
      footer={
        <Button
          variant="primary"
          size="md"
          className="w-full"
          disabled={saving || !name.trim() || !parentGroupId}
          onClick={handleSubmit}
        >
          {saving ? "Adding..." : "Add Account"}
        </Button>
      }
    >
      <div className="p-5 space-y-3">
        <Input label="Name" size="sm" className="w-full" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Select label="Parent Group" size="sm" className="w-full" value={parentGroupId} onChange={(e) => setParentGroupId(e.target.value)}>
          <option value="">Select a group</option>
          {groupOptions.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
        <Select label="Category" size="sm" className="w-full" value={category} onChange={(e) => setCategory(e.target.value)}>
          {ACCOUNT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </Select>
        <Select label="Normal Balance" size="sm" className="w-full" value={normalBalance} onChange={(e) => setNormalBalance(e.target.value)}>
          <option value="dr">Debit (Dr)</option>
          <option value="cr">Credit (Cr)</option>
        </Select>
        <label className="flex items-center gap-2 text-xs font-semibold text-warmgray-600 dark:text-warmgray-300">
          <input type="checkbox" checked={isSystemAccount} onChange={(e) => setIsSystemAccount(e.target.checked)} />
          System account (referenced by name from POS/Khata code - avoid renaming later)
        </label>
        {error && <p className="text-xs font-semibold text-rust-600 dark:text-rust-400">{error}</p>}
      </div>
    </Modal>
  );
}
