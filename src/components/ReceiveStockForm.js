"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, getDocs, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { formatINR, roundRs } from "@/lib/format";
import { receiveStockWithVoucher } from "@/lib/purchases";
import Select from "@/components/ui/Select";
import Input from "@/components/ui/Input";
import DatePicker from "@/components/ui/DatePicker";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import SupplierLookupModal from "@/components/SupplierLookupModal";
import { Plus, Trash2 } from "@/components/ui/icons";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function emptyLine() {
  return { productId: "", weightKg: "", costPerKg: "" };
}

// Itemized supplier purchase entry - the back-office counterpart to
// SupplierLookupModal.js's amount-only "Record Purchase" (untouched,
// still exists for quick/informal entries). This form actually moves
// stock and cost, so it's precision-oriented rather than speed-oriented,
// modeled on VoucherForm.js's dynamic-rows pattern.
export default function ReceiveStockForm() {
  const { user } = useAuth();

  const [suppliers, setSuppliers] = useState([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  const [supplierId, setSupplierId] = useState("");
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierPhone, setNewSupplierPhone] = useState("");
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [createSupplierError, setCreateSupplierError] = useState("");

  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [date, setDate] = useState(todayStr());
  const [lines, setLines] = useState([emptyLine()]);
  const [amountPaidNow, setAmountPaidNow] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [showSupplierLedger, setShowSupplierLedger] = useState(false);

  useEffect(() => {
    async function fetchSuppliers() {
      setLoadingSuppliers(true);
      try {
        const snapshot = await getDocs(collection(db, "suppliers"));
        const list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => a.name.localeCompare(b.name));
        setSuppliers(list);
      } catch (err) {
        console.error("Failed to load suppliers: ", err);
        setSuppliers([]);
      } finally {
        setLoadingSuppliers(false);
      }
    }
    fetchSuppliers();
  }, []);

  const fetchProducts = async () => {
    setLoadingProducts(true);
    try {
      const snapshot = await getDocs(collection(db, "products"));
      const list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => a.name.localeCompare(b.name));
      setProducts(list);
    } catch (err) {
      console.error("Failed to load products: ", err);
      setProducts([]);
    } finally {
      setLoadingProducts(false);
    }
  };

  useEffect(() => {
    async function load() {
      await fetchProducts();
    }
    load();
  }, []);

  const handleCreateSupplier = async () => {
    const name = newSupplierName.trim();
    if (!name) {
      setCreateSupplierError("Enter a supplier name.");
      return;
    }
    setCreatingSupplier(true);
    setCreateSupplierError("");
    try {
      const docRef = await addDoc(collection(db, "suppliers"), {
        name,
        phone: newSupplierPhone.trim(),
        notes: "",
        balance: 0,
        createdAt: serverTimestamp(),
      });
      const created = { id: docRef.id, name, phone: newSupplierPhone.trim(), notes: "", balance: 0 };
      setSuppliers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setSupplierId(created.id);
      setShowNewSupplier(false);
      setNewSupplierName("");
      setNewSupplierPhone("");
    } catch (err) {
      console.error("Failed to create supplier: ", err);
      setCreateSupplierError(err.message || "Failed to save - try again.");
    } finally {
      setCreatingSupplier(false);
    }
  };

  const updateLine = (index, patch) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const handleProductChange = (index, productId) => {
    const product = products.find((p) => p.id === productId);
    updateLine(index, {
      productId,
      costPerKg: product?.cost_price_per_kg != null ? String(product.cost_price_per_kg) : "",
    });
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (index) => setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

  const chosenProductIds = new Set(lines.map((l) => l.productId).filter(Boolean));

  const grandTotal = roundRs(lines.reduce((sum, l) => sum + (Number(l.weightKg) || 0) * (Number(l.costPerKg) || 0), 0));
  const paidNow = roundRs(Number(amountPaidNow) || 0);
  const creditAmount = roundRs(Math.max(grandTotal - paidNow, 0));
  const overpaid = paidNow > grandTotal;

  const hasDuplicateProduct = lines.some((l, i) => l.productId && lines.findIndex((other) => other.productId === l.productId) !== i);
  const linesValid = lines.every((l) => l.productId && Number(l.weightKg) > 0 && Number(l.costPerKg) >= 0);
  const canSubmit =
    !!supplierId && linesValid && !hasDuplicateProduct && invoiceNumber.trim() && date && !overpaid && paidNow >= 0 && !submitting;

  const resetForm = () => {
    setSupplierId("");
    setInvoiceNumber("");
    setDate(todayStr());
    setLines([emptyLine()]);
    setAmountPaidNow("");
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const supplier = suppliers.find((s) => s.id === supplierId);
      const trimmedInvoiceNumber = invoiceNumber.trim();
      const itemCount = lines.length;
      const outcome = await receiveStockWithVoucher({
        supplierId,
        supplierName: supplier?.name || "",
        invoiceNumber: trimmedInvoiceNumber,
        items: lines.map((l) => {
          const product = products.find((p) => p.id === l.productId);
          return { id: l.productId, name: product?.name || "", weight_kg: Number(l.weightKg), costPerKg: Number(l.costPerKg) };
        }),
        amountPaidNow: paidNow,
        createdBy: { uid: user?.uid || null, email: user?.email || null },
        date,
      });
      setResult({
        ...outcome,
        supplierId,
        supplierName: supplier?.name || "",
        invoiceNumber: trimmedInvoiceNumber,
        itemCount,
      });
      resetForm();
      fetchProducts(); // stock_kg/cost_price_per_kg just changed - refresh so the next line's prefill isn't stale
    } catch (err) {
      console.error("Failed to record purchase: ", err);
      setError(err.message || "Failed to record purchase - try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 space-y-5">
      {result && (
        <div className="p-4 rounded-xl border border-sage-200 dark:border-sage-800 bg-sage-50 dark:bg-sage-950/40 space-y-2">
          <p className="text-sm font-semibold text-sage-800 dark:text-sage-300">
            Purchase recorded — Invoice #{result.invoiceNumber}, {result.itemCount} item{result.itemCount === 1 ? "" : "s"}, ₹
            {formatINR(result.grandTotal)} total.{" "}
            {result.creditAmount > 0
              ? `₹${formatINR(result.creditAmount)} added to ${result.supplierName}'s Udhaar — new balance ₹${formatINR(result.newSupplierBalance)}.`
              : "Paid in full — no balance added."}
          </p>
          <button
            type="button"
            onClick={() => setShowSupplierLedger(true)}
            className="text-xs font-bold text-clay-600 dark:text-clay-400 hover:underline"
          >
            View Supplier Ledger
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400 mb-2">Supplier</label>
          <div className="flex items-center gap-2">
            <Select
              size="md"
              className="flex-1 min-w-0"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              disabled={loadingSuppliers}
            >
              <option value="">{loadingSuppliers ? "Loading suppliers..." : "Select supplier"}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <button
              type="button"
              onClick={() => setShowNewSupplier((v) => !v)}
              className="flex-shrink-0 text-xs font-bold px-3 py-2.5 rounded-lg text-clay-700 dark:text-clay-400 bg-clay-50 dark:bg-clay-950/40 border border-clay-200 dark:border-clay-800 hover:bg-clay-100 dark:hover:bg-clay-900 transition-colors whitespace-nowrap"
            >
              + New
            </button>
          </div>
        </div>
        <Input
          label="Invoice Number"
          size="md"
          className="w-full"
          value={invoiceNumber}
          onChange={(e) => setInvoiceNumber(e.target.value)}
          placeholder="e.g. INV-9942"
        />
      </div>

      {showNewSupplier && (
        <div className="p-4 rounded-xl border border-warmgray-200 dark:border-warmgray-700 bg-warmgray-50 dark:bg-warmgray-800/50 space-y-3">
          <p className="text-xs font-bold uppercase text-ink-900 dark:text-ink-50">New Supplier</p>
          <Input
            type="text"
            size="sm"
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
          {createSupplierError && <p className="text-xs font-semibold text-rust-600 dark:text-rust-400">{createSupplierError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowNewSupplier(false)}
              disabled={creatingSupplier}
              className="flex-1 py-2 rounded-lg text-xs font-bold text-warmgray-600 dark:text-warmgray-400 border border-warmgray-200 dark:border-warmgray-700 hover:bg-warmgray-100 dark:hover:bg-warmgray-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateSupplier}
              disabled={creatingSupplier}
              className="flex-1 py-2 rounded-lg text-xs font-bold text-white bg-clay-400 hover:bg-clay-600 disabled:opacity-50"
            >
              {creatingSupplier ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400 mb-2">Date</label>
        <DatePicker value={date} onChange={setDate} max={todayStr()} aria-label="Purchase date" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400">Items</label>
          <button
            type="button"
            onClick={addLine}
            className="inline-flex items-center gap-1 text-xs font-bold text-clay-600 dark:text-clay-400 hover:underline"
          >
            <Plus className="w-3.5 h-3.5" /> Add Line
          </button>
        </div>

        <div className="space-y-2">
          {lines.map((line, index) => {
            const product = products.find((p) => p.id === line.productId);
            const subtotal = roundRs((Number(line.weightKg) || 0) * (Number(line.costPerKg) || 0));
            return (
              <div key={index} className="p-3 rounded-xl border border-warmgray-200 dark:border-warmgray-700 space-y-2">
                <div className="flex items-center gap-2">
                  <Select
                    size="sm"
                    className="flex-1 min-w-0"
                    value={line.productId}
                    onChange={(e) => handleProductChange(index, e.target.value)}
                    disabled={loadingProducts}
                  >
                    <option value="">{loadingProducts ? "Loading products..." : "Select product"}</option>
                    {products
                      .filter((p) => p.id === line.productId || !chosenProductIds.has(p.id))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </Select>
                  <button
                    type="button"
                    onClick={() => removeLine(index)}
                    disabled={lines.length <= 1}
                    aria-label="Remove line"
                    className="flex-shrink-0 p-2 rounded-lg text-warmgray-400 hover:text-rust-600 dark:hover:text-rust-400 hover:bg-rust-50 dark:hover:bg-rust-950/40 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    step="0.001"
                    size="sm"
                    className="w-28 flex-shrink-0"
                    placeholder="Weight (kg)"
                    value={line.weightKg}
                    onChange={(e) => updateLine(index, { weightKg: e.target.value })}
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    size="sm"
                    className="w-28 flex-shrink-0"
                    placeholder="Cost/kg"
                    value={line.costPerKg}
                    onChange={(e) => updateLine(index, { costPerKg: e.target.value })}
                  />
                  <span className="text-xs font-bold text-ink-900 dark:text-ink-50 ml-auto">₹{formatINR(subtotal)}</span>
                </div>
                {product && (
                  <p className="text-[11px] text-warmgray-400">Current stock: {product.stock_kg ?? 0}kg</p>
                )}
              </div>
            );
          })}
        </div>
        {hasDuplicateProduct && (
          <p className="text-xs font-semibold text-rust-600 dark:text-rust-400 mt-2">Each product can only appear once - combine the weight into a single line.</p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
        <Input
          label="Amount Paid Now"
          type="number"
          min="0"
          step="0.01"
          size="md"
          className="w-full font-bold"
          value={amountPaidNow}
          onChange={(e) => setAmountPaidNow(e.target.value)}
          placeholder="0 = full credit"
        />
        <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-warmgray-200 dark:border-warmgray-700 bg-warmgray-50 dark:bg-warmgray-800/50">
          <div className="text-xs font-semibold text-warmgray-600 dark:text-warmgray-300 space-y-0.5">
            <p>
              Grand Total <span className="font-bold text-ink-900 dark:text-ink-50">₹{formatINR(grandTotal)}</span>
            </p>
            <p>
              Credit (Udhaar) <span className="font-bold text-ink-900 dark:text-ink-50">₹{formatINR(creditAmount)}</span>
            </p>
          </div>
          <Badge variant={creditAmount > 0 ? "warning" : "success"} size="sm">
            {creditAmount > 0 ? "On Credit" : "Paid in Full"}
          </Badge>
        </div>
      </div>

      {overpaid && <p className="text-xs font-semibold text-rust-600 dark:text-rust-400">Amount paid cannot exceed the grand total.</p>}
      {error && <p className="text-xs font-semibold text-rust-600 dark:text-rust-400">{error}</p>}

      <Button variant="primary" size="md" onClick={handleSubmit} disabled={!canSubmit} className="w-full sm:w-auto">
        {submitting ? "Saving..." : "Receive Stock"}
      </Button>

      <SupplierLookupModal
        key={result?.purchaseId || "none"}
        isOpen={showSupplierLedger}
        initialSupplier={result ? { id: result.supplierId, name: result.supplierName, balance: result.newSupplierBalance ?? 0 } : null}
        onClose={() => setShowSupplierLedger(false)}
      />
    </div>
  );
}
