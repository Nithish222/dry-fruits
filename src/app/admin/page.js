"use client";
import { useEffect, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatINR, roundKg, computeMargin, LOW_STOCK_THRESHOLD_KG } from "@/lib/format";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Badge from "@/components/ui/Badge";
import Skeleton from "@/components/ui/Skeleton";
import Modal from "@/components/ui/Modal";
import { Trash2 } from "@/components/ui/icons";
import { Table, THead, Th, Tr, Td } from "@/components/ui/Table";

const SKELETON_ROWS = 3;
const EMPTY_ADD_FORM = { name: "", category: "", retailPrice: "", wholesalePrice: "", costPrice: "", stockValue: "" };
const EMPTY_EDIT_FORM = { category: "", retailPrice: "", wholesalePrice: "", costPrice: "", stockValue: "" };

export default function AdminPage() {
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({ type: "", message: "" });
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const [editingProduct, setEditingProduct] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [savingAdd, setSavingAdd] = useState(false);
  const [addError, setAddError] = useState("");

  // Mouse-drag-to-scroll for the category chip strip. Trackpad swipes and
  // shift+wheel already work natively on any overflow-x-auto container -
  // this only adds the click-and-drag gesture for plain mice, which browsers
  // don't do for a generic <div> the way they do for e.g. <input type=range>.
  const chipStripRef = useRef(null);
  const dragState = useRef({ isDown: false, startX: 0, startScrollLeft: 0, moved: false });

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

  const openEditModal = (product) => {
    setEditingProduct(product);
    setEditError("");
    setEditForm({
      category: product.category || "",
      retailPrice: String(product.retail_price_per_kg ?? 0),
      wholesalePrice: String(product.wholesale_price_per_kg ?? 0),
      // Blank (not "0") when unset - a genuine ₹0 cost and "cost not entered
      // yet" are different things and shouldn't look the same in the form.
      costPrice: product.cost_price_per_kg != null ? String(product.cost_price_per_kg) : "",
      stockValue: String(product.stock_kg ?? 0),
    });
  };

  const closeEditModal = () => {
    setEditingProduct(null);
    setEditForm(EMPTY_EDIT_FORM);
    setEditError("");
  };

  const handleSaveEdit = async () => {
    if (!editingProduct) return;
    const category = editForm.category.trim();
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
      setEditError("Stock must be a non-negative number.");
      return;
    }

    setSavingEdit(true);
    setEditError("");
    try {
      await updateDoc(doc(db, "products", editingProduct.id), {
        category,
        retail_price_per_kg: retailPrice,
        wholesale_price_per_kg: wholesalePrice,
        cost_price_per_kg: costPrice,
        // Round to gram precision before writing so this edit doesn't
        // introduce (or perpetuate) floating-point drift in stock_kg.
        stock_kg: roundKg(stockValue),
        last_updated: serverTimestamp(),
      });
      closeEditModal();
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
    if (!window.confirm(`Delete ${product.name}? This can't be undone.`)) return;
    setDeletingId(product.id);
    try {
      // Deleting the product doc never touches past transactions - every
      // sale already snapshotted its own name/weight/price into
      // transactions/{id}.items[] at checkout time, so historical receipts
      // and sales history keep rendering correctly with no live lookup.
      await deleteDoc(doc(db, "products", product.id));
      if (editingProduct?.id === product.id) closeEditModal();
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

  const handleChipMouseDown = (e) => {
    dragState.current = { isDown: true, startX: e.pageX, startScrollLeft: chipStripRef.current?.scrollLeft ?? 0, moved: false };
  };
  const handleChipMouseMove = (e) => {
    const el = chipStripRef.current;
    if (!el || !dragState.current.isDown) return;
    const dx = e.pageX - dragState.current.startX;
    if (Math.abs(dx) > 3) dragState.current.moved = true;
    el.scrollLeft = dragState.current.startScrollLeft - dx;
  };
  const handleChipMouseUpOrLeave = () => {
    dragState.current.isDown = false;
  };
  const handleChipClick = (value) => {
    if (dragState.current.moved) return; // was a drag, not a click
    setCategoryFilter(value);
  };

  const categoryCounts = products.reduce((acc, p) => {
    const category = (p.category || "").trim();
    if (category) acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});
  const categoryList = Object.keys(categoryCounts).sort();

  const filteredProducts = products.filter((p) => {
    const matchesSearch = (p.name || "").toLowerCase().includes(searchQuery.trim().toLowerCase());
    const matchesCategory = !categoryFilter || (p.category || "").trim() === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const editCostPriceInput = editForm.costPrice.trim();
  const editCostPrice = editCostPriceInput === "" ? null : Number(editCostPriceInput);
  const editMargin = computeMargin(Number(editForm.retailPrice), editCostPrice);

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
          <div className="flex-shrink-0">
            <h2 className="text-2xl font-black text-ink-900 dark:text-ink-50 mb-1">Inventory</h2>
            <p className="text-warmgray-500 dark:text-warmgray-400 font-medium text-sm">Stock and price levels for all products. Click a row to edit it.</p>
          </div>

          <div className="flex items-center gap-3 flex-1 min-w-0 justify-end">
            {categoryList.length > 0 && (
              <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
                {/* Pinned - always visible, not part of the scrollable strip. */}
                <button
                  type="button"
                  onClick={() => setCategoryFilter("")}
                  className={`flex-shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-bold transition-colors ${
                    categoryFilter === "" ? "bg-clay-800 text-white" : "bg-clay-50 dark:bg-clay-950/40 text-clay-800 dark:text-clay-300"
                  }`}
                >
                  All ({products.length})
                </button>

                {/* Scrollable - clipped right where the search bar begins,
                    with a fade on each edge: left toward the pinned All
                    chip (where scrolled-past chips go), right toward search. */}
                <div className="relative min-w-0 flex-1 max-w-xs">
                  <div
                    ref={chipStripRef}
                    onMouseDown={handleChipMouseDown}
                    onMouseMove={handleChipMouseMove}
                    onMouseUp={handleChipMouseUpOrLeave}
                    onMouseLeave={handleChipMouseUpOrLeave}
                    className="flex gap-2 overflow-x-auto scrollbar-none py-1 cursor-grab active:cursor-grabbing select-none"
                  >
                    {categoryList.map((category) => (
                      <button
                        key={category}
                        type="button"
                        onClick={() => handleChipClick(category)}
                        className={`flex-shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-bold transition-colors ${
                          categoryFilter === category ? "bg-clay-800 text-white" : "bg-clay-50 dark:bg-clay-950/40 text-clay-800 dark:text-clay-300"
                        }`}
                      >
                        {category} ({categoryCounts[category]})
                      </button>
                    ))}
                  </div>
                  <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-white dark:from-warmgray-900 to-transparent pointer-events-none" />
                  <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-white dark:from-warmgray-900 to-transparent pointer-events-none" />
                </div>
              </div>
            )}

            <Input
              type="text"
              size="md"
              className="w-48 flex-shrink-0"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search products"
            />
          </div>
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
                  <Td><Skeleton className="h-7 w-7 rounded-md" /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : products.length === 0 ? (
          <div className="text-center py-10 text-warmgray-400 font-medium text-sm">No products found.</div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-10 text-warmgray-400 font-medium text-sm">No products match your search or filter.</div>
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
                const margin = computeMargin(product.retail_price_per_kg ?? 0, product.cost_price_per_kg);

                return (
                  <Tr
                    key={product.id}
                    onClick={() => openEditModal(product)}
                    className="cursor-pointer"
                  >
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
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteProduct(product);
                        }}
                        disabled={deletingId === product.id}
                        aria-label={`Delete ${product.name}`}
                        className="p-1.5 rounded-lg text-rust-500 hover:bg-rust-50 dark:hover:bg-rust-950/50 hover:text-rust-700 dark:hover:text-rust-400 disabled:opacity-50 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
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
        isOpen={!!editingProduct}
        onClose={closeEditModal}
        title={editingProduct?.name || ""}
        panelClassName="max-w-md"
        headerActions={
          editingProduct && (
            <button
              type="button"
              onClick={() => handleDeleteProduct(editingProduct)}
              disabled={deletingId === editingProduct.id}
              aria-label={`Delete ${editingProduct.name}`}
              className="p-1.5 rounded-lg text-rust-500 hover:bg-rust-50 dark:hover:bg-rust-950/50 hover:text-rust-700 dark:hover:text-rust-400 disabled:opacity-50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )
        }
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" size="md" className="flex-1" onClick={closeEditModal} disabled={savingEdit}>
              Cancel
            </Button>
            <Button variant="primary" size="md" className="flex-1" onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? "Saving..." : "Save"}
            </Button>
          </div>
        }
      >
        <div className="p-5 space-y-4">
          <Input
            label="Category"
            className="w-full"
            value={editForm.category}
            onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
            placeholder="e.g. Cashews"
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Retail ₹/kg"
              type="number"
              min="0"
              step="0.01"
              className="w-full"
              value={editForm.retailPrice}
              onChange={(e) => setEditForm({ ...editForm, retailPrice: e.target.value })}
            />
            <Input
              label="Wholesale ₹/kg"
              type="number"
              min="0"
              step="0.01"
              className="w-full"
              value={editForm.wholesalePrice}
              onChange={(e) => setEditForm({ ...editForm, wholesalePrice: e.target.value })}
            />
          </div>
          <Input
            label="Cost ₹/kg (optional)"
            type="number"
            min="0"
            step="0.01"
            className="w-full"
            value={editForm.costPrice}
            onChange={(e) => setEditForm({ ...editForm, costPrice: e.target.value })}
            placeholder="Leave blank if unknown"
          />

          {/* Read-only, always derived from Retail/Cost above - never a
              directly-editable field, so it can't drift out of sync. Given
              a distinct clay tint (rather than the same tone as the actual
              inputs above) so it visually reads as a computed result, not
              another field to fill in. */}
          <div className="rounded-xl px-4 py-3 bg-clay-50 dark:bg-clay-950/40 border border-clay-200 dark:border-clay-800 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-clay-700 dark:text-clay-400">Margin (auto)</p>
            {editMargin ? (
              <p className="text-base font-black text-clay-800 dark:text-clay-300">
                ₹{Math.round(editMargin.marginRs)}
                {editMargin.marginPct != null && ` · ${editMargin.marginPct.toFixed(0)}%`}
              </p>
            ) : (
              <p className="text-base font-black text-clay-800/50 dark:text-clay-300/50">—</p>
            )}
          </div>

          <Input
            label="Stock (kg)"
            type="number"
            min="0"
            step="0.001"
            className="w-full"
            value={editForm.stockValue}
            onChange={(e) => setEditForm({ ...editForm, stockValue: e.target.value })}
          />
          {editError && <p className="text-sm text-rust-600 dark:text-rust-400 font-semibold">{editError}</p>}
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
