"use client";

import { useEffect } from "react";
import { formatINR } from "@/lib/format";

const DEFAULT_STORE = {
  name: "Southern Traders",
  tagline: "Premium Dry Fruits & Nuts",
  address: "123 Market Street, Chennai, TN 600001",
  phone: "+91 98765 43210",
  gstin: "33ABCDE1234F1Z5",
};

function formatDate(createdAt) {
  const date = createdAt?.seconds
    ? new Date(createdAt.seconds * 1000)
    : createdAt
    ? new Date(createdAt)
    : new Date();
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ReceiptModal({ isOpen, onClose, transaction, storeInfo }) {
  const store = { ...DEFAULT_STORE, ...storeInfo };

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e) {
      if (e.key === "Escape") onClose?.();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !transaction) return null;

  const items = transaction.items || [];
  const grandTotal =
    transaction.grandTotal ??
    items.reduce((sum, item) => {
      const qty = item.qty ?? item.weight ?? item.quantity ?? 0;
      const rate = item.price ?? item.rate ?? 0;
      return sum + (item.total ?? item.lineTotal ?? qty * rate);
    }, 0);

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:hidden"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-bold text-gray-900 tracking-wide uppercase">
              Receipt Preview
            </h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            >
              &times;
            </button>
          </div>

          <div className="overflow-y-auto bg-gray-50 px-5 py-5">
            <div
              id="thermal-receipt"
              className="mx-auto bg-white text-black font-mono"
              style={{ width: "80mm", padding: "6mm 4mm" }}
            >
              <div className="text-center mb-3">
                <p className="text-base font-bold uppercase tracking-wide">{store.name}</p>
                {store.tagline && <p className="text-[10px] text-gray-600">{store.tagline}</p>}
                {store.address && (
                  <p className="text-[10px] text-gray-600 mt-1">{store.address}</p>
                )}
                {store.phone && <p className="text-[10px] text-gray-600">Ph: {store.phone}</p>}
                {store.gstin && <p className="text-[10px] text-gray-600">GSTIN: {store.gstin}</p>}
              </div>

              <div className="border-t border-dashed border-gray-400 my-2" />

              <div className="flex justify-between text-[10px] text-gray-700">
                <span>
                  Receipt #{transaction.id ? transaction.id.slice(0, 8).toUpperCase() : "-----"}
                </span>
                <span>{formatDate(transaction.createdAt)}</span>
              </div>
              {transaction.priceType && (
                <div className="text-[10px] text-gray-700 uppercase mt-1">
                  Price Mode: {transaction.priceType}
                </div>
              )}

              <div className="border-t border-dashed border-gray-400 my-2" />

              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-dashed border-gray-400">
                    <th className="text-left py-1 font-semibold">Item</th>
                    <th className="text-right py-1 font-semibold">Qty</th>
                    <th className="text-right py-1 font-semibold">Rate</th>
                    <th className="text-right py-1 font-semibold">Amt</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const qty = item.qty ?? item.weight ?? item.quantity ?? 0;
                    const unit = item.unit || (item.weight != null ? "kg" : "pcs");
                    const rate = item.price ?? item.rate ?? 0;
                    const amount = item.total ?? item.lineTotal ?? qty * rate;
                    return (
                      <tr key={item.id || idx} className="align-top">
                        <td className="py-1 pr-1">{item.name || item.productName || "Item"}</td>
                        <td className="py-1 text-right whitespace-nowrap">
                          {qty}
                          {unit}
                        </td>
                        <td className="py-1 text-right">{formatINR(rate)}</td>
                        <td className="py-1 text-right font-semibold">{formatINR(amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="border-t border-dashed border-gray-400 my-2" />

              <div className="flex justify-between text-[10px] text-gray-700">
                <span>Total Items</span>
                <span>{items.length}</span>
              </div>

              <div className="flex justify-between text-sm font-bold mt-2 pt-2 border-t border-gray-900">
                <span>GRAND TOTAL</span>
                <span>₹{formatINR(grandTotal)}</span>
              </div>

              {transaction.payment && (
                <>
                  <div className="border-t border-dashed border-gray-400 my-2" />
                  <div className="text-[10px] text-gray-700 space-y-0.5">
                    <div className="flex justify-between">
                      <span>Payment Mode</span>
                      <span className="uppercase font-semibold">{transaction.payment.mode}</span>
                    </div>
                    {transaction.payment.mode === "cash" && (
                      <>
                        <div className="flex justify-between">
                          <span>Amount Received</span>
                          <span>₹{formatINR(transaction.payment.amountReceived)}</span>
                        </div>
                        <div className="flex justify-between font-semibold">
                          <span>Change Returned</span>
                          <span>₹{formatINR(transaction.payment.changeDue)}</span>
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}

              <div className="border-t border-dashed border-gray-400 my-3" />

              <div className="text-center text-[10px] text-gray-600 leading-relaxed">
                <p>Thank you for shopping with us!</p>
                <p>Goods once sold will not be taken back.</p>
              </div>
            </div>
          </div>

          <div className="px-5 py-4 border-t border-gray-100 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl font-semibold text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              Close
            </button>
            <button
              onClick={() => window.print()}
              className="flex-1 py-3 rounded-xl font-semibold text-sm text-white bg-gray-900 hover:bg-black transition-colors"
            >
              Print Receipt
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #thermal-receipt,
          #thermal-receipt * {
            visibility: visible;
          }
          #thermal-receipt {
            position: absolute;
            top: 0;
            left: 0;
            width: 80mm;
            margin: 0;
          }
          @page {
            size: 80mm auto;
            margin: 0;
          }
        }
      `}</style>
    </>
  );
}
