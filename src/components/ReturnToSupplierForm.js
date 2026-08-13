"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, getDocs, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { formatINR, roundRs } from "@/lib/format";
import { returnStockToSupplierWithVoucher } from "@/lib/purchases";
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

// Mirror-opposite of ReceiveStockForm.js: stock decreases instead of
// increases, and the supplier's Khata balance decreases (or goes negative -
// a credit owed to the shop) instead of increasing. No invoice number /
// amount-paid-now split here - a return is purely a debt adjustment, not a
// cash event, so "Reason" replaces that entire footer.
export default function ReturnToSupplierForm() {
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

  const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayStr());
  const [lines, setLines] = useState([emptyLine()]);

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

  const hasDuplicateProduct = lines.some((l, i) => l.productId && lines.findIndex((other) => other.productId === l.productId) !== i);
  const hasOverStockLine = lines.some((l) => {
    const product = products.find((p) => p.id === l.productId);
    return product && Number(l.weightKg) > (product.stock_kg ?? 0);
  });
  const linesValid = lines.every((l) => l.productId && Number(l.weightKg) > 0 && Number(l.costPerKg) >= 0);
  const canSubmit = !!supplierId && linesValid && !hasDuplicateProduct && !hasOverStockLine && date && !submitting;

  const resetForm = () => {
    setSupplierId("");
    setReason("");
    setDate(todayStr());
    setLines([emptyLine()]);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const supplier = suppliers.find((s) => s.id === supplierId);
      const trimmedReason = reason.trim();
      const itemCount = lines.length;
      const outcome = await returnStockToSupplierWithVoucher({
        supplierId,
        supplierName: supplier?.name || "",
        items: lines.map((l) => {
          const product = products.find((p) => p.id === l.productId);
          return { id: l.productId, name: product?.name || "", weight_kg: Number(l.weightKg), costPerKg: Number(l.costPerKg) };
        }),
        reason: trimmedReason,
        createdBy: { uid: user?.uid || null, email: user?.email || null },
        date,
      });
      setResult({
        ...outcome,
        supplierId,
        supplierName: supplier?.name || "",
        itemCount,
      });
      resetForm();
      fetchProducts(); // stock_kg just changed - refresh so the next return's cap isn't stale
    } catch (err) {
      console.error("Failed to record return: ", err);
      setError(err.message || "Failed to record return - try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 space-y-5">
      {result && (
        <div className="p-4 rounded-xl border border-sage-200 dark:border-sage-800 bg-sage-50 dark:bg-sage-950/40 space-y-2">
          <p className="text-sm font-semibold text-sage-800 dark:text-sage-300">
            Return recorded — {result.itemCount} item{result.itemCount === 1 ? "" : "s"}, ₹{formatINR(result.totalAmount)} total.{" "}
            {result.newSupplierBalance >= 0
              ? `${result.supplierName}'s balance is now ₹${formatINR(result.newSupplierBalance)}, owed to them.`
              : `${result.supplierName}'s balance is now ₹${formatINR(Math.abs(result.newSupplierBalance))}, owed to you as a credit.`}
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
          label="Reason"
          size="md"
          className="w-full"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Damaged goods, wrong item"
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
        <DatePicker value={date} onChange={setDate} max={todayStr()} aria-label="Return date" />
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
            const stock = product?.stock_kg ?? 0;
            const subtotal = roundRs((Number(line.weightKg) || 0) * (Number(line.costPerKg) || 0));
            const overStock = product && Number(line.weightKg) > stock;
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
                          {p.name} ({p.stock_kg ?? 0}kg in stock)
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
                    max={product ? stock : undefined}
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
                  <p className={`text-[11px] ${overStock ? "font-semibold text-rust-600 dark:text-rust-400" : "text-warmgray-400"}`}>
                    Current stock: {stock}kg{overStock ? " - cannot return more than this" : ""}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        {hasDuplicateProduct && (
          <p className="text-xs font-semibold text-rust-600 dark:text-rust-400 mt-2">Each product can only appear once - combine the weight into a single line.</p>
        )}
      </div>

      <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-warmgray-200 dark:border-warmgray-700 bg-warmgray-50 dark:bg-warmgray-800/50">
        <p className="text-xs font-semibold text-warmgray-600 dark:text-warmgray-300">
          Return Total <span className="font-bold text-ink-900 dark:text-ink-50">₹{formatINR(grandTotal)}</span>
        </p>
        <Badge variant="warning" size="sm">
          Reduces Payable
        </Badge>
      </div>

      {error && <p className="text-xs font-semibold text-rust-600 dark:text-rust-400">{error}</p>}

      <Button variant="primary" size="md" onClick={handleSubmit} disabled={!canSubmit} className="w-full sm:w-auto">
        {submitting ? "Saving..." : "Return to Supplier"}
      </Button>

      <SupplierLookupModal
        key={result?.purchaseReturnId || "none"}
        isOpen={showSupplierLedger}
        initialSupplier={result ? { id: result.supplierId, name: result.supplierName, balance: result.newSupplierBalance ?? 0 } : null}
        onClose={() => setShowSupplierLedger(false)}
      />
    </div>
  );
}
