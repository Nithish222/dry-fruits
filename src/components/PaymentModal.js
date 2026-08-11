"use client";

import { useState } from "react";
import { formatINR } from "@/lib/format";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

export default function PaymentModal({ isOpen, total, onClose, onConfirm }) {
  const [mode, setMode] = useState("cash");
  const [amountReceived, setAmountReceived] = useState("");

  const received = mode === "gpay" ? total : Number(amountReceived || 0);
  const changeDue = received - total;
  const isCashInvalid = mode === "cash" && (amountReceived === "" || changeDue < 0);

  const resetState = () => {
    setMode("cash");
    setAmountReceived("");
  };

  const handleClose = () => {
    resetState();
    onClose?.();
  };

  const handleConfirm = () => {
    if (isCashInvalid) return;
    const payment = {
      mode,
      amountReceived: Number(received.toFixed(2)),
      changeDue: Number(Math.max(changeDue, 0).toFixed(2)),
    };
    resetState();
    onConfirm(payment);
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} panelClassName="max-w-sm p-6">
      <h2 className="text-lg font-black text-gray-900 dark:text-white mb-1">Payment</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 font-medium mb-5">
        Amount Due:{" "}
        <span className="font-bold text-gray-900 dark:text-white">₹{formatINR(total)}</span>
      </p>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <button
          onClick={() => setMode("cash")}
          className={`py-3 rounded-xl font-bold text-sm border transition-all ${
            mode === "cash"
              ? "bg-emerald-600 border-emerald-600 text-white shadow-sm"
              : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
          }`}
        >
          Cash
        </button>
        <button
          onClick={() => setMode("gpay")}
          className={`py-3 rounded-xl font-bold text-sm border transition-all ${
            mode === "gpay"
              ? "bg-emerald-600 border-emerald-600 text-white shadow-sm"
              : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
          }`}
        >
          GPay
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
              <p className="mt-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                Change to Return: ₹{formatINR(changeDue)}
              </p>
            ) : (
              <p className="mt-3 text-sm font-semibold text-red-600 dark:text-red-400">
                Short by ₹{formatINR(Math.abs(changeDue))}
              </p>
            ))}
        </div>
      ) : (
        <div className="mb-5 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-sm font-semibold text-emerald-800 dark:text-emerald-400">
          Confirm ₹{formatINR(total)} received via GPay.
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="secondary" size="md" className="flex-1" onClick={handleClose}>
          Cancel
        </Button>
        <Button variant="primary" size="md" className="flex-1" onClick={handleConfirm} disabled={isCashInvalid}>
          Confirm Payment
        </Button>
      </div>
    </Modal>
  );
}
