"use client";

import { formatINR } from "@/lib/format";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { Table, THead, Th, Tr, Td } from "@/components/ui/Table";

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

export default function PurchaseDetailModal({ isOpen, onClose, record }) {
  if (!record) return null;

  const isReturn = record._kind === "return";
  const items = record.items || [];
  const total = isReturn ? record.totalAmount : record.grandTotal;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isReturn ? "Return to Supplier" : "Stock Receipt"}
      panelClassName="max-w-lg max-h-[90vh]"
      footer={
        <Button variant="secondary" size="md" className="w-full" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="overflow-y-auto px-5 py-5 space-y-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400">Supplier</p>
            <p className="font-semibold text-ink-900 dark:text-ink-50">{record.supplierName || "N/A"}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400">Date</p>
            <p className="font-semibold text-ink-900 dark:text-ink-50">{formatDate(record.createdAt)}</p>
          </div>
          {!isReturn && (
            <>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400">Invoice #</p>
                <p className="font-semibold text-ink-900 dark:text-ink-50">{record.invoiceNumber || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400">Amount Paid Now</p>
                <p className="font-semibold text-ink-900 dark:text-ink-50">₹{formatINR(record.amountPaidNow)}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400">Credit Amount</p>
                <p className="font-semibold text-ink-900 dark:text-ink-50">₹{formatINR(record.creditAmount)}</p>
              </div>
            </>
          )}
          {isReturn && (
            <div className="col-span-2">
              <p className="text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400">Reason</p>
              <p className="font-semibold text-ink-900 dark:text-ink-50">{record.reason || "—"}</p>
            </div>
          )}
        </div>

        <Card padding="p-0" className="overflow-hidden">
          <Table variant="compact">
            <THead>
              <Th>Item</Th>
              <Th align="right">Weight (kg)</Th>
              <Th align="right">Cost/kg</Th>
              <Th align="right">Subtotal</Th>
            </THead>
            <tbody>
              {items.map((item, idx) => (
                <Tr key={item.id || idx}>
                  <Td className="font-medium text-ink-900 dark:text-ink-50">{item.name}</Td>
                  <Td align="right">{item.weight_kg}</Td>
                  <Td align="right">₹{formatINR(item.costPerKg)}</Td>
                  <Td align="right" className="font-semibold text-ink-900 dark:text-ink-50">
                    ₹{formatINR(item.subtotal)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <div className="flex justify-between items-center pt-2 border-t border-warmgray-100 dark:border-warmgray-700">
          <span className="text-sm font-bold text-warmgray-600 dark:text-warmgray-400">
            {isReturn ? "Total Refund/Debit" : "Grand Total"}
          </span>
          <span className="text-xl font-black text-clay-600 dark:text-clay-400">₹{formatINR(total)}</span>
        </div>
      </div>
    </Modal>
  );
}
