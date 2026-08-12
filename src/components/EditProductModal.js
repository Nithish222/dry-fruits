"use client";
import { useState } from "react";
import { doc, increment, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { roundKg, computeMargin } from "@/lib/format";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import ToggleGroup from "@/components/ui/ToggleGroup";
import { Trash2 } from "@/components/ui/icons";

const STOCK_MODE_OPTIONS = [
  { value: "set", label: "Set to" },
  { value: "add", label: "Add stock" },
];

// The one product-edit surface, shared by Price Setup's click-to-edit table
// and the Dashboard's Low Stock Alerts "Restock" action - same component,
// same Firestore write, so there's exactly one place that can drift from
// the other. `restockMode` is the only behavioral difference between the
// two call sites: it defaults the stock field to "Add stock" instead of
// "Set to" (restocking is normally topping up, not re-declaring a count),
// and moves the Stock field to the top of the form so Modal's own "focus
// the first focusable element on open" behavior lands there without needing
// separate ref/autoFocus plumbing that would fight that existing mechanism.
//
// Keyed by the caller on `product?.id` (falling back to "none" when
// closed) so a fresh instance mounts per product - form state below only
// needs a lazy initial value, never a reset-on-open effect (same reasoning
// as ReturnModal.js).
export default function EditProductModal({ product, onClose, onDelete, deletingId, restockMode = false }) {
  const [form, setForm] = useState(() => ({
    category: product?.category || "",
    retailPrice: String(product?.retail_price_per_kg ?? 0),
    wholesalePrice: String(product?.wholesale_price_per_kg ?? 0),
    costPrice: product?.cost_price_per_kg != null ? String(product.cost_price_per_kg) : "",
    stockMode: restockMode ? "add" : "set",
    stockValue: restockMode ? "" : String(product?.stock_kg ?? 0),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!product) return null;

  const currentStock = product.stock_kg ?? 0;
  const stockValueNum = Number(form.stockValue);
  const projectedStock =
    form.stockMode === "add" && Number.isFinite(stockValueNum) ? roundKg(currentStock + stockValueNum) : null;

  const costPriceInput = form.costPrice.trim();
  const costPrice = costPriceInput === "" ? null : Number(costPriceInput);
  const margin = computeMargin(Number(form.retailPrice), costPrice);

  const handleStockModeChange = (mode) => {
    setForm((prev) => ({
      ...prev,
      stockMode: mode,
      stockValue: mode === "add" ? "" : String(currentStock),
    }));
  };

  const handleSave = async () => {
    const category = form.category.trim();
    const retailPrice = Number(form.retailPrice);
    const wholesalePrice = Number(form.wholesalePrice);

    if (!Number.isFinite(retailPrice) || retailPrice < 0) {
      setError("Retail price must be a non-negative number.");
      return;
    }
    if (!Number.isFinite(wholesalePrice) || wholesalePrice < 0) {
      setError("Wholesale price must be a non-negative number.");
      return;
    }
    if (costPrice !== null && (!Number.isFinite(costPrice) || costPrice < 0)) {
      setError("Cost price must be a non-negative number, or left blank.");
      return;
    }
    if (!Number.isFinite(stockValueNum) || stockValueNum < 0) {
      setError(form.stockMode === "add" ? "Enter a non-negative quantity to add." : "Stock must be a non-negative number.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await updateDoc(doc(db, "products", product.id), {
        category,
        retail_price_per_kg: retailPrice,
        wholesale_price_per_kg: wholesalePrice,
        cost_price_per_kg: costPrice,
        // "Add" uses Firestore's atomic increment (safe without a read -
        // no transaction needed for a single-document update) rather than
        // computing currentStock + stockValueNum client-side, so two
        // restocks landing close together both apply instead of the second
        // clobbering the first. "Set" still rounds and writes the absolute
        // value, matching how this field always worked.
        stock_kg: form.stockMode === "add" ? increment(roundKg(stockValueNum)) : roundKg(stockValueNum),
        last_updated: serverTimestamp(),
      });
      onClose();
    } catch (err) {
      console.error("Failed to update product: ", err);
      setError("Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const stockField = (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400">
          Stock (kg)
        </label>
        <ToggleGroup options={STOCK_MODE_OPTIONS} value={form.stockMode} onChange={handleStockModeChange} />
      </div>
      <Input
        type="number"
        min="0"
        step="0.001"
        className="w-full"
        autoFocus={restockMode}
        placeholder={form.stockMode === "add" ? "e.g. 10" : undefined}
        value={form.stockValue}
        onChange={(e) => setForm((prev) => ({ ...prev, stockValue: e.target.value }))}
      />
      {form.stockMode === "add" && (
        <p className="text-xs text-warmgray-400 mt-1.5">
          Current {currentStock}kg → New {projectedStock ?? currentStock}kg
        </p>
      )}
    </div>
  );

  return (
    <Modal
      isOpen={!!product}
      onClose={onClose}
      title={product.name}
      panelClassName="max-w-md"
      headerActions={
        onDelete && (
          <button
            type="button"
            onClick={() => onDelete(product)}
            disabled={deletingId === product.id}
            aria-label={`Delete ${product.name}`}
            className="p-1.5 rounded-lg text-rust-500 hover:bg-rust-50 dark:hover:bg-rust-950/50 hover:text-rust-700 dark:hover:text-rust-400 disabled:opacity-50 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )
      }
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" size="md" className="flex-1" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="md" className="flex-1" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      }
    >
      <div className="p-5 space-y-4">
        {restockMode && stockField}

        <Input
          label="Category"
          className="w-full"
          value={form.category}
          onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
          placeholder="e.g. Cashews"
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Retail ₹/kg"
            type="number"
            min="0"
            step="0.01"
            className="w-full"
            value={form.retailPrice}
            onChange={(e) => setForm((prev) => ({ ...prev, retailPrice: e.target.value }))}
          />
          <Input
            label="Wholesale ₹/kg"
            type="number"
            min="0"
            step="0.01"
            className="w-full"
            value={form.wholesalePrice}
            onChange={(e) => setForm((prev) => ({ ...prev, wholesalePrice: e.target.value }))}
          />
        </div>
        <Input
          label="Cost ₹/kg (optional)"
          type="number"
          min="0"
          step="0.01"
          className="w-full"
          value={form.costPrice}
          onChange={(e) => setForm((prev) => ({ ...prev, costPrice: e.target.value }))}
          placeholder="Leave blank if unknown"
        />

        {/* Read-only, always derived from Retail/Cost above - never a
            directly-editable field, so it can't drift out of sync. */}
        <div className="rounded-xl px-4 py-3 bg-clay-50 dark:bg-clay-950/40 border border-clay-200 dark:border-clay-800 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wide text-clay-700 dark:text-clay-400">Margin (auto)</p>
          {margin ? (
            <p className="text-base font-black text-clay-800 dark:text-clay-300">
              ₹{Math.round(margin.marginRs)}
              {margin.marginPct != null && ` · ${margin.marginPct.toFixed(0)}%`}
            </p>
          ) : (
            <p className="text-base font-black text-clay-800/50 dark:text-clay-300/50">—</p>
          )}
        </div>

        {!restockMode && stockField}
        {error && <p className="text-sm text-rust-600 dark:text-rust-400 font-semibold">{error}</p>}
      </div>
    </Modal>
  );
}
