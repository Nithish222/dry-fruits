"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { formatINR, roundRs } from "@/lib/format";
import { postVoucher, VOUCHER_TYPES } from "@/lib/accounting";
import Select from "@/components/ui/Select";
import Input from "@/components/ui/Input";
import DatePicker from "@/components/ui/DatePicker";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { Plus, Trash2 } from "@/components/ui/icons";

const VOUCHER_TYPE_LABELS = { receipt: "Receipt", payment: "Payment", journal: "Journal", contra: "Contra", sales: "Sales", purchase: "Purchase" };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function emptyLine() {
  return { accountId: "", type: "dr", amount: "" };
}

// Voucher entry form - dynamic dr/cr line rows with a live balance-check
// footer, modeled on the "complex standalone form" precedent (PaymentModal/
// ReturnModal) rather than colocated in accounts/page.js, since it carries
// real state (dynamic rows, live validation) worth isolating.
export default function VoucherForm({ onPosted }) {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  const [voucherType, setVoucherType] = useState("journal");
  const [date, setDate] = useState(todayStr());
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState([emptyLine(), emptyLine()]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    async function fetchAccounts() {
      setLoadingAccounts(true);
      try {
        const snapshot = await getDocs(query(collection(db, "accounts"), where("isGroup", "==", false), where("isActive", "==", true)));
        const list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => a.name.localeCompare(b.name));
        setAccounts(list);
      } catch (err) {
        console.error("Failed to load accounts: ", err);
        setAccounts([]);
      } finally {
        setLoadingAccounts(false);
      }
    }
    fetchAccounts();
  }, []);

  const updateLine = (index, patch) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (index) => setLines((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== index) : prev));

  const sumDr = roundRs(lines.filter((l) => l.type === "dr").reduce((sum, l) => sum + (Number(l.amount) || 0), 0));
  const sumCr = roundRs(lines.filter((l) => l.type === "cr").reduce((sum, l) => sum + (Number(l.amount) || 0), 0));
  const isBalanced = sumDr === sumCr && sumDr > 0;
  const linesFilled = lines.every((l) => l.accountId && Number(l.amount) > 0);
  const canSubmit = isBalanced && linesFilled && !submitting;

  const resetForm = () => {
    setVoucherType("journal");
    setDate(todayStr());
    setNarration("");
    setLines([emptyLine(), emptyLine()]);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    setSuccessMessage("");
    try {
      const accountsById = new Map(accounts.map((account) => [account.id, account]));
      const { voucherNumber } = await postVoucher({
        voucherType,
        date,
        narration: narration.trim(),
        lines: lines.map((l) => ({
          accountId: l.accountId,
          type: l.type,
          amount: Number(l.amount),
          category: accountsById.get(l.accountId)?.category,
        })),
        createdBy: { uid: user?.uid || null, email: user?.email || null },
      });
      setSuccessMessage(`Posted ${voucherNumber}.`);
      resetForm();
      onPosted?.();
    } catch (err) {
      console.error("Failed to post voucher: ", err);
      setError(err.message || "Failed to post voucher - try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Select label="Voucher Type" size="md" value={voucherType} onChange={(e) => setVoucherType(e.target.value)}>
          {VOUCHER_TYPES.map((type) => (
            <option key={type} value={type}>
              {VOUCHER_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400 mb-2">Date</label>
          <DatePicker value={date} onChange={setDate} max={todayStr()} aria-label="Voucher date" />
        </div>
      </div>

      <Input
        label="Narration"
        size="md"
        className="w-full"
        placeholder="What is this voucher for?"
        value={narration}
        onChange={(e) => setNarration(e.target.value)}
      />

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400">Lines</label>
          <button
            type="button"
            onClick={addLine}
            className="inline-flex items-center gap-1 text-xs font-bold text-clay-600 dark:text-clay-400 hover:underline"
          >
            <Plus className="w-3.5 h-3.5" /> Add Line
          </button>
        </div>

        <div className="space-y-2">
          {lines.map((line, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <Select
                size="sm"
                className="flex-1 min-w-[140px]"
                value={line.accountId}
                onChange={(e) => updateLine(index, { accountId: e.target.value })}
                disabled={loadingAccounts}
              >
                <option value="">{loadingAccounts ? "Loading accounts..." : "Select account"}</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
              <Select size="sm" className="w-20 flex-shrink-0" value={line.type} onChange={(e) => updateLine(index, { type: e.target.value })}>
                <option value="dr">Dr</option>
                <option value="cr">Cr</option>
              </Select>
              <Input
                type="number"
                min="0"
                step="0.01"
                size="sm"
                className="w-24 flex-shrink-0 font-bold"
                placeholder="Amount"
                value={line.amount}
                onChange={(e) => updateLine(index, { amount: e.target.value })}
              />
              <button
                type="button"
                onClick={() => removeLine(index)}
                disabled={lines.length <= 2}
                aria-label="Remove line"
                className="flex-shrink-0 p-2 rounded-lg text-warmgray-400 hover:text-rust-600 dark:hover:text-rust-400 hover:bg-rust-50 dark:hover:bg-rust-950/40 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-warmgray-200 dark:border-warmgray-700 bg-warmgray-50 dark:bg-warmgray-800/50">
        <div className="text-xs font-semibold text-warmgray-600 dark:text-warmgray-300 space-x-4">
          <span>
            Dr <span className="font-bold text-ink-900 dark:text-ink-50">₹{formatINR(sumDr)}</span>
          </span>
          <span>
            Cr <span className="font-bold text-ink-900 dark:text-ink-50">₹{formatINR(sumCr)}</span>
          </span>
        </div>
        <Badge variant={isBalanced ? "success" : "warning"} size="sm">
          {isBalanced ? "Balanced" : "Not Balanced"}
        </Badge>
      </div>

      {error && <p className="text-xs font-semibold text-rust-600 dark:text-rust-400">{error}</p>}
      {successMessage && <p className="text-xs font-semibold text-sage-600 dark:text-sage-400">{successMessage}</p>}

      <Button variant="primary" size="md" onClick={handleSubmit} disabled={!canSubmit} className="w-full sm:w-auto">
        {submitting ? "Posting..." : "Post Voucher"}
      </Button>
    </div>
  );
}
