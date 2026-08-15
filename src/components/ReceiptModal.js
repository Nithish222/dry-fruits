"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { formatINR, formatDateTime as formatDate, formatPaymentMode } from "@/lib/format";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

// Retail and wholesale bills go out under different registered names - the
// wholesale one hasn't been provided yet, so it falls back to this default
// until it is.
const DEFAULT_STORE = {
  name: "Southern Traders",
  tagline: "Premium Dry Fruits & Nuts",
  address: "175-E Masi St, opposite to Motta pillayar kovil, Madurai 625001",
  phone: "+91 9655366676",
  email: "support@srisouthern.in",
  gstin: "33ABCDE1234F1Z5",
};

const RETAIL_STORE_NAME = "Sri Southern Traders";

const REVIEW_URL =
  "https://www.google.com/maps/place/Sri+Southern+Traders/@9.9189159,78.1207228,17z/data=!3m1!4b1!4m6!3m5!1s0x3b00c59b5c64399d:0x6cc054c44d8c56b3!8m2!3d9.9189159!4d78.1232977!16s%2Fg%2F11fzf8mpbh?entry=ttu&g_ep=EgoyMDI2MDgxMi4wIKXMDSoASAFQAw%3D%3D";

export default function ReceiptModal({ isOpen, onClose, transaction, storeInfo }) {
  const store = { ...DEFAULT_STORE, ...storeInfo };

  // Generated once, not fetched from a third-party QR API - keeps the
  // review link private to this page load and means the receipt still
  // renders (sans QR) if that generation ever throws, rather than sending
  // the URL out to render one. Runs before the transaction-null return
  // since hooks can't follow an early return.
  const [reviewQrDataUrl, setReviewQrDataUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(REVIEW_URL, { margin: 1, width: 160 })
      .then((url) => {
        if (!cancelled) setReviewQrDataUrl(url);
      })
      .catch((error) => console.error("Error generating review QR code: ", error));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!transaction) return null;

  if (transaction.priceType === "retail" && !storeInfo?.name) {
    store.name = RETAIL_STORE_NAME;
  }

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
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Receipt Preview"
        panelClassName="max-w-sm max-h-[90vh]"
        backdropClassName="print:hidden"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" size="md" className="flex-1" onClick={onClose}>
              Close
            </Button>
            <button
              onClick={() => window.print()}
              className="flex-1 py-3 rounded-xl font-semibold text-sm text-white bg-gray-900 hover:bg-black transition-colors"
            >
              Print Receipt
            </button>
          </div>
        }
      >
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
              {store.email && <p className="text-[10px] text-gray-600">Email: {store.email}</p>}
              {store.gstin && <p className="text-[10px] text-gray-600">GSTIN: {store.gstin}</p>}
            </div>

            <div className="border-t border-dashed border-gray-400 my-2" />

            <div className="flex justify-between text-[10px] text-gray-700">
              <span>
                Receipt #{transaction.id ? transaction.id.slice(0, 8).toUpperCase() : "-----"}
              </span>
              <span>{formatDate(transaction.createdAt)}</span>
            </div>
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

            <div className="flex justify-between text-sm font-bold mt-2 pt-2 border-t border-clay-800 text-clay-800">
              <span>GRAND TOTAL</span>
              <span>₹{formatINR(grandTotal)}</span>
            </div>

            {transaction.payment && (
              <>
                <div className="border-t border-dashed border-gray-400 my-2" />
                <div className="text-[10px] text-gray-700 space-y-0.5">
                  <div className="flex justify-between">
                    <span>Payment Mode</span>
                    <span className="uppercase font-semibold">{formatPaymentMode(transaction.payment.mode)}</span>
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

            {reviewQrDataUrl && (
              <>
                <div className="border-t border-dashed border-gray-400 my-3" />
                <div className="text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a
                      data: URL, not a real image source next/image can
                      optimize, and this only ever renders client-side */}
                  <img src={reviewQrDataUrl} alt="QR code to leave a Google review" className="mx-auto" width={100} height={100} />
                  <p className="text-[10px] text-gray-600 mt-1">Enjoyed shopping with us? Scan to leave a review!</p>
                </div>
              </>
            )}
          </div>
        </div>
      </Modal>

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
