"use client";
import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, increment, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatINR, roundKg, computeMargin, LOW_STOCK_THRESHOLD_KG } from "@/lib/format";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Badge from "@/components/ui/Badge";
import Skeleton from "@/components/ui/Skeleton";
import Modal from "@/components/ui/Modal";
import { Table, THead, Th, Tr, Td } from "@/components/ui/Table";

const SKELETON_ROWS = 3;
const EMPTY_ADD_FORM = { name: "", category: "", retailPrice: "", wholesalePrice: "", costPrice: "", stockValue: "" };

export default function AdminPage() {
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({ type: "", message: "" });
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("");

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");

  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [savingAdd, setSavingAdd] = useState(false);
  const [addError, setAddError] = useState("");

  // Real-time listener instead of a one-shot fetch: Firestore serves the
  // cached snapshot instantly on (re)subscribe, so switching tabs and back
  // doesn't cause a visible reload, and it only pushes updates when stock
  // actually changes in the DB.
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "products"),
      (querySnapshot) => {
        const productsList = querySnapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .sort((a, b) => (a.stock_kg ?? 0) - (b.stock_kg ?? 0));
        setProducts(productsList);
        setProductsLoading(false);
      },
      (error) => {
        console.error("Error fetching products: ", error);
        setProductsLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const startEdit = (product) => {
    setConfirmDeleteId(null);
    setEditingId(product.id);
    setEditError("");
    setEditForm({
      retailPrice: String(product.retail_price_per_kg ?? 0),
      wholesalePrice: String(product.wholesale_price_per_kg ?? 0),
      // Blank (not "0") when unset - a genuine ₹0 cost and "cost not entered
      // yet" are different things and shouldn't look the same in the form.
      costPrice: product.cost_price_per_kg != null ? String(product.cost_price_per_kg) : "",
      stockMode: "set", // "set" overwrites stock_kg, "add" restocks on top of the current value
      stockValue: String(product.stock_kg ?? 0),
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(null);
    setEditError("");
  };

  const handleSaveEdit = async (product) => {
    const retailPrice = Number(editForm.retailPrice);
    const wholesalePrice = Number(editForm.wholesalePrice);
    const stockValue = Number(editForm.stockValue);
    const costPriceInput = editForm.costPrice.trim();
    const costPrice = costPriceInput === "" ? null : Number(costPriceInput);

    if (!Number.isFinite(retailPrice) || retailPrice < 0) {
      setEditError("Retail price must be a non-negative number.");
      return;
    }
    if (!Number.isFinite(wholesalePrice) || wholesalePrice < 0) {
      setEditError("Wholesale price must be a non-negative number.");
      return;
    }
    if (costPrice !== null && (!Number.isFinite(costPrice) || costPrice < 0)) {
      setEditError("Cost price must be a non-negative number, or left blank.");
      return;
    }
    if (!Number.isFinite(stockValue) || stockValue < 0) {
      setEditError(editForm.stockMode === "add" ? "Restock amount must be a non-negative number." : "Stock must be a non-negative number.");
      return;
    }

    setSavingEdit(true);
    setEditError("");
    try {
      // Round to gram precision before writing so this edit doesn't introduce
      // (or perpetuate) floating-point drift in stock_kg.
      const roundedStockValue = roundKg(stockValue);
      await updateDoc(doc(db, "products", product.id), {
        retail_price_per_kg: retailPrice,
        wholesale_price_per_kg: wholesalePrice,
        cost_price_per_kg: costPrice,
        // "add" uses an atomic server-side increment so it can't be clobbered by a
        // checkout transaction decrementing stock_kg at the same moment; "set" is a
        // deliberate overwrite of the current value. "Set to" is also the way to
        // manually clean up a stock_kg value that already drifted (e.g.
        // 98.35000000000001) before this rounding fix was in place.
        stock_kg: editForm.stockMode === "add" ? increment(roundedStockValue) : roundedStockValue,
        last_updated: serverTimestamp(),
      });
      cancelEdit();
    } catch (error) {
      console.error("Failed to update product: ", error);
      setEditError("Save failed. Please try again.");
    } finally {
      setSavingEdit(false);
    }
  };

  const openAddModal = () => {
    setAddForm(EMPTY_ADD_FORM);
    setAddError("");
    setShowAddModal(true);
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    setAddForm(EMPTY_ADD_FORM);
    setAddError("");
  };

  const handleAddProduct = async () => {
    const name = addForm.name.trim();
    const category = addForm.category.trim();
    const retailPrice = Number(addForm.retailPrice);
    const wholesalePrice = Number(addForm.wholesalePrice);
    const stockValue = Number(addForm.stockValue);
    const costPriceInput = addForm.costPrice.trim();
    const costPrice = costPriceInput === "" ? null : Number(costPriceInput);

    if (!name) {
      setAddError("Product name is required.");
      return;
    }
    // Case-insensitive: price-update-function/main.py matches CSV rows to
    // products by exact name, so two products differing only by case would
    // silently break that matching (and confuse a cashier searching the
    // catalog besides).
    if (products.some((p) => (p.name || "").trim().toLowerCase() === name.toLowerCase())) {
      setAddError("A product with this name already exists.");
      return;
    }
    if (!Number.isFinite(retailPrice) || retailPrice < 0) {
      setAddError("Retail price must be a non-negative number.");
      return;
    }
    if (!Number.isFinite(wholesalePrice) || wholesalePrice < 0) {
      setAddError("Wholesale price must be a non-negative number.");
      return;
    }
    if (costPrice !== null && (!Number.isFinite(costPrice) || costPrice < 0)) {
      setAddError("Cost price must be a non-negative number, or left blank.");
      return;
    }
    if (!Number.isFinite(stockValue) || stockValue < 0) {
      setAddError("Stock must be a non-negative number.");
      return;
    }

    setSavingAdd(true);
    setAddError("");
    try {
      await addDoc(collection(db, "products"), {
        name,
        category,
        retail_price_per_kg: retailPrice,
        wholesale_price_per_kg: wholesalePrice,
        cost_price_per_kg: costPrice,
        stock_kg: roundKg(stockValue),
        last_updated: serverTimestamp(),
      });
      closeAddModal();
    } catch (error) {
      console.error("Failed to add product: ", error);
      setAddError("Save failed. Please try again.");
    } finally {
      setSavingAdd(false);
    }
  };

  const handleDeleteProduct = async (product) => {
    setDeletingId(product.id);
    try {
      // Deleting the product doc never touches past transactions - every
      // sale already snapshotted its own name/weight/price into
      // transactions/{id}.items[] at checkout time, so historical receipts
      // and sales history keep rendering correctly with no live lookup.
      await deleteDoc(doc(db, "products", product.id));
      setConfirmDeleteId(null);
    } catch (error) {
      console.error("Failed to delete product: ", error);
      alert("Delete failed. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && (file.name.endsWith(".csv") || file.name.endsWith(".xlsx"))) {
      setSelectedFile(file);
      setUploadStatus({ type: "", message: "" });
    } else {
      setSelectedFile(null);
      setUploadStatus({ type: "error", message: "Select a valid .csv or .xlsx sheet." });
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) return;

    setUploading(true);
    setUploadStatus({ type: "", message: "" });
    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (res.ok) {
        setUploadStatus({ type: "success", message: `Prices successfully synced from ${selectedFile.name}!` });
        setSelectedFile(null);
        document.getElementById("file-input").value = "";
      } else {
        setUploadStatus({ type: "error", message: "Upload failed. Please try again." });
      }
    } catch (err) {
      setUploadStatus({ type: "error", message: "Network error occurred." });
    } finally {
      setUploading(false);
    }
  };

  const categories = Array.from(
    new Set(products.map((p) => (p.category || "").trim()).filter(Boolean))
  ).sort();
  const filteredProducts = categoryFilter
    ? products.filter((p) => (p.category || "").trim() === categoryFilter)
    : products;

  return (
    <main className="p-8 md:p-12 h-full flex flex-col w-full bg-cream-50 dark:bg-cream-950 min-h-screen transition-colors">
      <PageHeader
        title="Price Setup"
        subtitle="Manage your product catalog, prices, and stock levels."
        actions={
          <>
            <Button variant="secondary" size="md" onClick={() => setShowUploadModal(true)}>
              Upload Price Sheet
            </Button>
            <Button variant="primary" size="md" onClick={openAddModal}>
              + Add Product
            </Button>
          </>
        }
      />

      <Card padding="p-6" className="w-full">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-2xl font-black text-ink-900 dark:text-ink-50 mb-1">Inventory</h2>
            <p className="text-warmgray-500 dark:text-warmgray-400 font-medium text-sm">Stock and price levels for all products. Click Edit to update a product directly.</p>
          </div>
          {categories.length > 0 && (
            <Select
              size="sm"
              className="flex-shrink-0"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </Select>
          )}
        </div>

        {productsLoading ? (
          <Table variant="compact">
            <THead>
              <Th>Product</Th>
              <Th>Category</Th>
              <Th>Retail ₹/kg</Th>
              <Th>Wholesale ₹/kg</Th>
              <Th>Cost ₹/kg</Th>
              <Th>Margin</Th>
              <Th>Stock (kg)</Th>
              <Th>Status</Th>
              <Th></Th>
            </THead>
            <tbody>
              {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <Tr key={i}>
                  <Td><Skeleton className="h-4 w-32" /></Td>
                  <Td><Skeleton className="h-4 w-16" /></Td>
                  <Td><Skeleton className="h-4 w-14" /></Td>
                  <Td><Skeleton className="h-4 w-14" /></Td>
                  <Td><Skeleton className="h-4 w-14" /></Td>
                  <Td><Skeleton className="h-5 w-16 rounded-full" /></Td>
                  <Td><Skeleton className="h-4 w-10" /></Td>
                  <Td><Skeleton className="h-5 w-16 rounded-full" /></Td>
                  <Td><Skeleton className="h-7 w-12 rounded-md" /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : products.length === 0 ? (
          <div className="text-center py-10 text-warmgray-400 font-medium text-sm">No products found.</div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-10 text-warmgray-400 font-medium text-sm">No products match this category.</div>
        ) : (
          <Table variant="compact">
            <THead>
              <Th>Product</Th>
              <Th>Category</Th>
              <Th>Retail ₹/kg</Th>
              <Th>Wholesale ₹/kg</Th>
              <Th>Cost ₹/kg</Th>
              <Th>Margin</Th>
              <Th>Stock (kg)</Th>
              <Th>Status</Th>
              <Th></Th>
            </THead>
            <tbody>
              {filteredProducts.map((product) => {
                const stock = product.stock_kg ?? 0;
                const isLow = stock < LOW_STOCK_THRESHOLD_KG;
                const isEditing = editingId === product.id;
                const margin = computeMargin(product.retail_price_per_kg ?? 0, product.cost_price_per_kg);

                if (isEditing) {
                  const addPreview = editForm.stockMode === "add" ? stock + (Number(editForm.stockValue) || 0) : null;
                  const editCostPriceInput = editForm.costPrice.trim();
                  const editCostPrice = editCostPriceInput === "" ? null : Number(editCostPriceInput);
                  const editMargin = computeMargin(Number(editForm.retailPrice), editCostPrice);
                  return (
                    <Tr key={product.id} className="bg-warmgray-50 dark:bg-warmgray-800/40">
                      <Td className="font-semibold text-ink-900 dark:text-ink-50 align-top">{product.name}</Td>
                      <Td className="align-top text-warmgray-500 dark:text-warmgray-400">{product.category || "—"}</Td>
                      <Td className="align-top">
                        <Input
                          type="number"
                          size="sm"
                          min="0"
                          step="0.01"
                          value={editForm.retailPrice}
                          onChange={(e) => setEditForm({ ...editForm, retailPrice: e.target.value })}
                          className="w-24"
                        />
                      </Td>
                      <Td className="align-top">
                        <Input
                          type="number"
                          size="sm"
                          min="0"
                          step="0.01"
                          value={editForm.wholesalePrice}
                          onChange={(e) => setEditForm({ ...editForm, wholesalePrice: e.target.value })}
                          className="w-24"
                        />
                      </Td>
                      <Td className="align-top">
                        <Input
                          type="number"
                          size="sm"
                          min="0"
                          step="0.01"
                          value={editForm.costPrice}
                          onChange={(e) => setEditForm({ ...editForm, costPrice: e.target.value })}
                          className="w-24"
                          placeholder="Blank"
                        />
                      </Td>
                      <Td className="align-top">
                        {editMargin ? (
                          <Badge variant={editMargin.marginRs <= 0 ? "danger" : "success"} size="sm">
                            ₹{formatINR(editMargin.marginRs)}
                            {editMargin.marginPct != null ? ` (${editMargin.marginPct.toFixed(0)}%)` : ""}
                          </Badge>
                        ) : (
                          <span className="text-warmgray-400 text-sm">—</span>
                        )}
                      </Td>
                      <Td className="align-top">
                        <div className="flex items-center gap-1 mb-1.5">
                          <button
                            type="button"
                            onClick={() => setEditForm({ ...editForm, stockMode: "set", stockValue: String(stock) })}
                            className={`px-2 py-0.5 rounded-md text-xs font-bold ${editForm.stockMode === "set" ? "bg-clay-400 text-white" : "bg-warmgray-200 dark:bg-warmgray-700 text-warmgray-600 dark:text-warmgray-300"}`}
                          >
                            Set to
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditForm({ ...editForm, stockMode: "add", stockValue: "0" })}
                            className={`px-2 py-0.5 rounded-md text-xs font-bold ${editForm.stockMode === "add" ? "bg-clay-400 text-white" : "bg-warmgray-200 dark:bg-warmgray-700 text-warmgray-600 dark:text-warmgray-300"}`}
                          >
                            Add stock
                          </button>
                        </div>
                        <Input
                          type="number"
                          size="sm"
                          min="0"
                          step="0.001"
                          value={editForm.stockValue}
                          onChange={(e) => setEditForm({ ...editForm, stockValue: e.target.value })}
                          className="w-24"
                        />
                        {editForm.stockMode === "add" && (
                          <p className="text-xs text-warmgray-400 mt-1">New total: {addPreview}kg</p>
                        )}
                      </Td>
                      <Td className="align-top">
                        <Badge variant={isLow ? "danger" : "success"} size="sm">
                          {isLow ? "⚠ Low Stock" : "In Stock"}
                        </Badge>
                      </Td>
                      <Td className="align-top">
                        <div className="flex flex-col gap-1.5">
                          <Button variant="primary" size="sm" onClick={() => handleSaveEdit(product)} disabled={savingEdit}>
                            {savingEdit ? "Saving..." : "Save"}
                          </Button>
                          <Button variant="secondary" size="sm" onClick={cancelEdit} disabled={savingEdit}>
                            Cancel
                          </Button>
                        </div>
                        {editError && <p className="text-xs text-rust-600 dark:text-rust-400 mt-1 max-w-[8rem]">{editError}</p>}
                      </Td>
                    </Tr>
                  );
                }

                if (confirmDeleteId === product.id) {
                  return (
                    <Tr key={product.id} className="bg-rust-50/60 dark:bg-rust-950/30">
                      <Td className="font-semibold text-ink-900 dark:text-ink-50 align-top">{product.name}</Td>
                      <Td className="align-top text-warmgray-500 dark:text-warmgray-400">{product.category || "—"}</Td>
                      <Td className="align-top" colSpan={6}>
                        <p className="text-sm font-semibold text-rust-700 dark:text-rust-400">
                          Delete {product.name}? This can&apos;t be undone.
                        </p>
                      </Td>
                      <Td className="align-top">
                        <div className="flex gap-1.5">
                          <Button variant="danger" size="sm" onClick={() => handleDeleteProduct(product)} disabled={deletingId === product.id}>
                            {deletingId === product.id ? "Deleting..." : "Confirm"}
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => setConfirmDeleteId(null)} disabled={deletingId === product.id}>
                            Cancel
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  );
                }

                return (
                  <Tr key={product.id}>
                    <Td className="font-semibold text-ink-900 dark:text-ink-50">{product.name}</Td>
                    <Td className="text-warmgray-500 dark:text-warmgray-400">{product.category || "—"}</Td>
                    <Td>₹{formatINR(product.retail_price_per_kg ?? 0)}</Td>
                    <Td>₹{formatINR(product.wholesale_price_per_kg ?? 0)}</Td>
                    <Td>{product.cost_price_per_kg != null ? `₹${formatINR(product.cost_price_per_kg)}` : <span className="text-warmgray-400">—</span>}</Td>
                    <Td>
                      {margin ? (
                        <Badge variant={margin.marginRs <= 0 ? "danger" : "success"} size="sm">
                          ₹{formatINR(margin.marginRs)}
                          {margin.marginPct != null ? ` (${margin.marginPct.toFixed(0)}%)` : ""}
                        </Badge>
                      ) : (
                        <span className="text-warmgray-400 text-sm">—</span>
                      )}
                    </Td>
                    <Td>{stock}</Td>
                    <Td>
                      <Badge variant={isLow ? "danger" : "success"} size="sm">
                        {isLow ? "⚠ Low Stock" : "In Stock"}
                      </Badge>
                    </Td>
                    <Td>
                      <div className="flex gap-1.5">
                        <Button variant="primary" size="sm" onClick={() => startEdit(product)}>
                          Edit
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => setConfirmDeleteId(product.id)}>
                          Delete
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        isOpen={showAddModal}
        onClose={closeAddModal}
        title="Add Product"
        panelClassName="max-w-sm"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" size="md" className="flex-1" onClick={closeAddModal} disabled={savingAdd}>
              Cancel
            </Button>
            <Button variant="primary" size="md" className="flex-1" onClick={handleAddProduct} disabled={savingAdd}>
              {savingAdd ? "Adding..." : "Add Product"}
            </Button>
          </div>
        }
      >
        <div className="p-5 space-y-4">
          <Input
            label="Product Name"
            className="w-full"
            value={addForm.name}
            onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
            placeholder="e.g. Premium Cashews (W320)"
            autoFocus
          />
          <Input
            label="Category"
            className="w-full"
            value={addForm.category}
            onChange={(e) => setAddForm({ ...addForm, category: e.target.value })}
            placeholder="e.g. Cashews"
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Retail ₹/kg"
              type="number"
              min="0"
              step="0.01"
              className="w-full"
              value={addForm.retailPrice}
              onChange={(e) => setAddForm({ ...addForm, retailPrice: e.target.value })}
            />
            <Input
              label="Wholesale ₹/kg"
              type="number"
              min="0"
              step="0.01"
              className="w-full"
              value={addForm.wholesalePrice}
              onChange={(e) => setAddForm({ ...addForm, wholesalePrice: e.target.value })}
            />
          </div>
          <Input
            label="Cost ₹/kg (optional)"
            type="number"
            min="0"
            step="0.01"
            className="w-full"
            value={addForm.costPrice}
            onChange={(e) => setAddForm({ ...addForm, costPrice: e.target.value })}
            placeholder="Leave blank if unknown"
          />
          <Input
            label="Stock (kg)"
            type="number"
            min="0"
            step="0.001"
            className="w-full"
            value={addForm.stockValue}
            onChange={(e) => setAddForm({ ...addForm, stockValue: e.target.value })}
          />
          {addError && <p className="text-sm text-rust-600 dark:text-rust-400 font-semibold">{addError}</p>}
        </div>
      </Modal>

      <Modal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        title="Upload Price Sheet"
        panelClassName="max-w-sm"
      >
        <div className="p-5">
          <p className="text-sm text-warmgray-500 dark:text-warmgray-400 font-medium mb-5">
            Upload a new vendor spreadsheet to instantly update catalog prices across all registers.
          </p>
          <form onSubmit={handleUpload} className="space-y-5">
            <div className="border-2 border-dashed border-warmgray-300 dark:border-warmgray-700 rounded-xl p-6 text-center bg-warmgray-50 dark:bg-warmgray-800/50">
              <input
                id="file-input"
                type="file"
                accept=".csv, .xlsx"
                onChange={handleFileChange}
                disabled={uploading}
                className="block w-full text-sm text-warmgray-500 dark:text-warmgray-400 file:mr-4 file:py-2.5 file:px-6 file:rounded-lg file:border-0 file:bg-clay-400 file:text-white hover:file:bg-clay-600 cursor-pointer mx-auto font-semibold"
              />
            </div>

            <Button type="submit" variant="primary" size="md" className="w-full" disabled={!selectedFile || uploading}>
              {uploading ? "Syncing Database..." : "Update Live Prices"}
            </Button>
          </form>

          {uploadStatus.message && (
            <div className={`mt-5 p-4 rounded-xl font-bold text-center text-sm ${
              uploadStatus.type === "success"
                ? "bg-sage-50 dark:bg-sage-950 text-sage-700 dark:text-sage-400 border border-sage-200 dark:border-sage-800"
                : "bg-rust-50 dark:bg-rust-950 text-rust-700 dark:text-rust-400 border border-rust-200 dark:border-rust-800"
            }`}>
              {uploadStatus.message}
            </div>
          )}
        </div>
      </Modal>
    </main>
  );
}
