"use client";

import { useState } from "react";
import { formatINR, roundKg } from "@/lib/format";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { AlertTriangle } from "@/components/ui/icons";

function buildInitialQuantities(items) {
  const quantities = {};
  for (const item of items) {
    quantities[item.id] = item.remaining > 0 ? item.remaining : 0;
  }
  return quantities;
}

// The parent keys this component by transaction id (falling back to "none"
// when closed), so a fresh instance mounts every time it's opened for a
// (possibly different) transaction - state below only needs a lazy initial
// value, never a reset-on-open effect.
export default function ReturnModal({ isOpen, onClose, transaction, returnedByItem, isOnline, onProcessReturn }) {
  const items = (transaction?.items || []).map((item) => {
    const alreadyReturned = returnedByItem?.[item.id] || 0;
    return { ...item, alreadyReturned, remaining: roundKg((item.weight_kg || 0) - alreadyReturned) };
  });

  const [quantities, setQuantities] = useState(() => buildInitialQuantities(items));
  const [included, setIncluded] = useState(() =>
    Object.fromEntries(items.map((item) => [item.id, item.remaining > 0]))
  );
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen || !transaction) return null;

  const hasReturnableItems = items.some((item) => item.remaining > 0);

  const refundAmount = items.reduce((sum, item) => {
    if (!included[item.id]) return sum;
    return sum + item.billedPrice * (quantities[item.id] || 0);
  }, 0);

  const handleQuantityChange = (id, value, remaining) => {
    const kg = roundKg(Math.min(Math.max(Number(value) || 0, 0), remaining));
    setQuantities((prev) => ({ ...prev, [id]: kg }));
  };

  const handleClose = () => {
    if (submitting) return;
    onClose?.();
  };

  const handleSubmit = async () => {
    if (!isOnline) {
      setError("Returns require an internet connection. Reconnect and try again.");
      return;
    }
    const itemsToReturn = items
      .filter((item) => included[item.id] && (quantities[item.id] || 0) > 0)
      .map((item) => ({ id: item.id, weight_kg: quantities[item.id] }));

    if (itemsToReturn.length === 0) {
      setError("Select at least one item to return.");
      return;
    }
    if (!reason.trim()) {
      setError("Enter a reason for the return.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await onProcessReturn({ originalTransactionId: transaction.id, itemsToReturn, reason: reason.trim() });
      onClose?.();
    } catch (err) {
      console.error("Return failed: ", err);
      setError(err.message || "Failed to process return.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Process Return"
      panelClassName="max-w-lg max-h-[85vh]"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" size="md" className="flex-1" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            className="flex-1"
            onClick={handleSubmit}
            disabled={submitting || !isOnline || !hasReturnableItems}
          >
            {submitting ? "Processing..." : `Refund ₹${formatINR(refundAmount)}`}
          </Button>
        </div>
      }
    >
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {!isOnline && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-rust-50 dark:bg-rust-950/40 border border-rust-200 dark:border-rust-800 text-sm font-semibold text-rust-700 dark:text-rust-400">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>Returns require an internet connection. Reconnect and try again.</span>
          </div>
        )}

        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400 mb-1">
            Original Sale
          </p>
          <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">
            {transaction.customer?.name || "N/A"} &middot; ₹{formatINR(transaction.grandTotal)}
          </p>
        </div>

        {!hasReturnableItems ? (
          <p className="text-sm text-warmgray-500 dark:text-warmgray-400 text-center py-6">
            All items from this sale have already been returned.
          </p>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className={`p-3 rounded-xl border ${
                  item.remaining > 0
                    ? "border-warmgray-200 dark:border-warmgray-700"
                    : "border-warmgray-100 dark:border-warmgray-800 opacity-50"
                }`}
              >
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!included[item.id]}
                    disabled={item.remaining <= 0}
                    onChange={(e) => setIncluded((prev) => ({ ...prev, [item.id]: e.target.checked }))}
                  />
                  <div className="flex-1">
                    <p className="font-bold text-ink-900 dark:text-ink-50 text-sm">{item.name}</p>
                    <p className="text-xs text-warmgray-500 dark:text-warmgray-400">
                      Sold {item.weight_kg}kg &middot; ₹{formatINR(item.billedPrice)}/kg
                      {item.alreadyReturned > 0 ? ` · ${item.alreadyReturned}kg already returned` : ""}
                    </p>
                    {item.remaining > 0 && (
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          max={item.remaining}
                          step="0.01"
                          disabled={!included[item.id]}
                          value={quantities[item.id] === 0 ? "" : quantities[item.id]}
                          onChange={(e) => handleQuantityChange(item.id, e.target.value, item.remaining)}
                          className="w-24 bg-warmgray-50 dark:bg-warmgray-800 border border-warmgray-200 dark:border-warmgray-700 rounded-lg px-2.5 py-1.5 text-sm font-bold text-ink-900 dark:text-ink-50 focus:outline-none focus:ring-2 focus:ring-clay-400 disabled:opacity-50"
                        />
                        <span className="text-xs font-semibold text-warmgray-500 dark:text-warmgray-400">
                          kg of {item.remaining}kg max
                        </span>
                      </div>
                    )}
                  </div>
                  <span className="font-bold text-ink-900 dark:text-ink-50 text-sm">
                    ₹{formatINR(included[item.id] ? item.billedPrice * (quantities[item.id] || 0) : 0)}
                  </span>
                </label>
              </div>
            ))}
          </div>
        )}

        <Input
          label="Return Reason"
          className="w-full font-medium"
          placeholder="e.g. Customer changed mind, damaged item..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={!hasReturnableItems}
        />

        {error && <p className="text-sm font-semibold text-rust-600 dark:text-rust-400">{error}</p>}
      </div>
    </Modal>
  );
}
