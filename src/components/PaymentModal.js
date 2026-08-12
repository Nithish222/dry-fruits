"use client";

import { useState } from "react";
import { formatINR, roundRs, CREDIT_LIMIT_WARNING_THRESHOLD } from "@/lib/format";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

// `customerBalance` (the customer's current signed balance, + = they owe
// the shop) is optional - only known once a customer's been selected/typed
// on the Register page. When present, credit mode shows the projected
// balance after this sale so the cashier sees the effect before confirming;
// the actual credit-limit warning (a confirm() dialog) fires one level up,
// in the Register page's checkout handler, since it needs to interrupt the
// whole checkout flow rather than just this modal.
export default function PaymentModal({ isOpen, total, onClose, onConfirm, customerBalance = 0 }) {
  const [mode, setMode] = useState("cash");
  const [amountReceived, setAmountReceived] = useState("");

  const received = mode === "gpay" ? total : Number(amountReceived || 0);
  const changeDue = received - total;
  const isCashInvalid = mode === "cash" && (amountReceived === "" || changeDue < 0);

  const amountReceivedNow = mode === "credit" ? Number(amountReceived || 0) : 0;
  const creditAmount = roundRs(Math.max(total - amountReceivedNow, 0));
  const isCreditInvalid = mode === "credit" && (amountReceivedNow < 0 || amountReceivedNow >= total);
  const projectedBalance = roundRs(customerBalance + creditAmount);

  const resetState = () => {
    setMode("cash");
    setAmountReceived("");
  };

  const handleClose = () => {
    resetState();
    onClose?.();
  };

  const handleConfirm = () => {
    if (isCashInvalid || isCreditInvalid) return;
    const payment =
      mode === "credit"
        ? { mode, amountReceived: roundRs(amountReceivedNow), changeDue: 0, creditAmount }
        : { mode, amountReceived: roundRs(received), changeDue: roundRs(Math.max(changeDue, 0)), creditAmount: 0 };
    resetState();
    onConfirm(payment);
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} panelClassName="max-w-sm p-6">
      <h2 className="text-lg font-black text-ink-900 dark:text-ink-50 mb-1">Payment</h2>
      <p className="text-sm text-warmgray-500 dark:text-warmgray-400 font-medium mb-5">
        Amount Due:{" "}
        <span className="font-bold text-ink-900 dark:text-ink-50">₹{formatINR(total)}</span>
      </p>

      <div className="grid grid-cols-3 gap-2 mb-5">
        <button
          onClick={() => setMode("cash")}
          className={`py-3 rounded-xl font-bold text-sm border transition-all ${
            mode === "cash"
              ? "bg-clay-400 border-clay-400 text-white shadow-sm"
              : "border-warmgray-200 dark:border-warmgray-700 text-warmgray-600 dark:text-warmgray-400 hover:bg-warmgray-50 dark:hover:bg-warmgray-800"
          }`}
        >
          Cash
        </button>
        <button
          onClick={() => setMode("gpay")}
          className={`py-3 rounded-xl font-bold text-sm border transition-all ${
            mode === "gpay"
              ? "bg-clay-400 border-clay-400 text-white shadow-sm"
              : "border-warmgray-200 dark:border-warmgray-700 text-warmgray-600 dark:text-warmgray-400 hover:bg-warmgray-50 dark:hover:bg-warmgray-800"
          }`}
        >
          GPay
        </button>
        <button
          onClick={() => setMode("credit")}
          className={`py-3 rounded-xl font-bold text-sm border transition-all ${
            mode === "credit"
              ? "bg-clay-400 border-clay-400 text-white shadow-sm"
              : "border-warmgray-200 dark:border-warmgray-700 text-warmgray-600 dark:text-warmgray-400 hover:bg-warmgray-50 dark:hover:bg-warmgray-800"
          }`}
        >
          Credit
        </button>
      </div>

      {mode === "cash" ? (
        <div className="mb-5">
          <Input
            label="Amount Received"
            size="lg"
            className="w-full font-bold text-lg"
            type="number"
            min="0"
            step="0.01"
            autoFocus
            value={amountReceived}
            onChange={(e) => setAmountReceived(e.target.value)}
            placeholder={`e.g. ${Math.ceil(total)}`}
          />
          {amountReceived !== "" &&
            (changeDue >= 0 ? (
              <p className="mt-3 text-sm font-semibold text-sage-700 dark:text-sage-400">
                Change to Return: ₹{formatINR(changeDue)}
              </p>
            ) : (
              <p className="mt-3 text-sm font-semibold text-rust-600 dark:text-rust-400">
                Short by ₹{formatINR(Math.abs(changeDue))}
              </p>
            ))}
        </div>
      ) : mode === "gpay" ? (
        <div className="mb-5 p-4 rounded-xl bg-clay-50 dark:bg-clay-950/40 border border-clay-200 dark:border-clay-800 text-sm font-semibold text-clay-800 dark:text-clay-400">
          Confirm ₹{formatINR(total)} received via GPay.
        </div>
      ) : (
        <div className="mb-5">
          <Input
            label="Amount Received Now (optional)"
            size="lg"
            className="w-full font-bold text-lg"
            type="number"
            min="0"
            step="0.01"
            autoFocus
            value={amountReceived}
            onChange={(e) => setAmountReceived(e.target.value)}
            placeholder="0 = full credit"
          />
          <div className="mt-3 p-3 rounded-xl bg-rust-50 dark:bg-rust-950/40 border border-rust-200 dark:border-rust-800 space-y-1">
            <p className="text-sm font-bold text-rust-700 dark:text-rust-400">
              Credit Amount: ₹{formatINR(creditAmount)}
            </p>
            <p className="text-xs font-semibold text-rust-600 dark:text-rust-400">
              Balance: ₹{formatINR(customerBalance)} → ₹{formatINR(projectedBalance)}
              {projectedBalance > CREDIT_LIMIT_WARNING_THRESHOLD && " ⚠ above usual limit"}
            </p>
          </div>
          {isCreditInvalid && amountReceivedNow >= total && (
            <p className="mt-2 text-xs font-semibold text-rust-600 dark:text-rust-400">
              Amount received now must be less than the total - use Cash or GPay if there&apos;s no credit.
            </p>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="secondary" size="md" className="flex-1" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          className="flex-1"
          onClick={handleConfirm}
          disabled={isCashInvalid || isCreditInvalid}
        >
          Confirm Payment
        </Button>
      </div>
    </Modal>
  );
}
