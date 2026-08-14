"use client";
import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, serverTimestamp, writeBatch } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { formatINR, roundKg, computeMargin, LOW_STOCK_THRESHOLD_KG, formatDate } from "@/lib/format";
import { parsePriceSheetWorkbook } from "@/lib/priceSheet";
import EditProductModal from "@/components/EditProductModal";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Badge from "@/components/ui/Badge";
import Skeleton from "@/components/ui/Skeleton";
import Modal from "@/components/ui/Modal";
import DatePicker from "@/components/ui/DatePicker";
import CategoryChipFilter from "@/components/ui/CategoryChipFilter";
import { Trash2 } from "@/components/ui/icons";
import { Table, THead, Th, Tr, Td } from "@/components/ui/Table";

const SKELETON_ROWS = 3;
const EMPTY_ADD_FORM = { name: "", tamilName: "", category: "", retailPrice: "", wholesalePrice: "", costPrice: "", stockValue: "", priceEffectiveDate: "" };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function AdminPage() {
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({ type: "", message: "" });
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  // Lazy-initialized from the URL (deep-linked from the Dashboard's Low
  // Stock Alerts "View all" link, /admin?filter=low-stock) rather than set
  // in an effect - this route is statically prerendered, so the static
  // shell never reflects a runtime query string either way (the same
  // "shell first, real content a moment later" pattern this page already
  // has for its Firestore data below).
  const [lowStockOnly, setLowStockOnly] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("filter") === "low-stock"
  );

  const [editingProduct, setEditingProduct] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [savingAdd, setSavingAdd] = useState(false);
  const [addError, setAddError] = useState("");

  const [showTallyExport, setShowTallyExport] = useState(false);
  const [tallyFrom, setTallyFrom] = useState(todayStr());
  const [tallyTo, setTallyTo] = useState(todayStr());
  const [exportingTally, setExportingTally] = useState(false);
  const [tallyExportError, setTallyExportError] = useState("");

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

  const openEditModal = (product) => setEditingProduct(product);
  const closeEditModal = () => setEditingProduct(null);

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
        tamil_name: addForm.tamilName.trim() || null,
        category,
        retail_price_per_kg: retailPrice,
        wholesale_price_per_kg: wholesalePrice,
        cost_price_per_kg: costPrice,
        stock_kg: roundKg(stockValue),
        price_effective_date: addForm.priceEffectiveDate || null,
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
    if (file && file.name.endsWith(".xlsx")) {
      setSelectedFile(file);
      setUploadStatus({ type: "", message: "" });
    } else {
      setSelectedFile(null);
      setUploadStatus({ type: "error", message: "Select a valid .xlsx price sheet." });
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) return;

    setUploading(true);
    setUploadStatus({ type: "", message: "" });

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const { category, items, skipped } = parsePriceSheetWorkbook(arrayBuffer);

      const existingSnapshot = await getDocs(collection(db, "products"));
      const existingByName = new Map(
        existingSnapshot.docs.map((d) => [(d.data().name || "").trim().toLowerCase(), d])
      );

      const batch = writeBatch(db);
      let created = 0;
      let updated = 0;

      for (const item of items) {
        const existingDoc = existingByName.get(item.name.trim().toLowerCase());
        const fields = {
          category,
          cost_price_per_kg: item.costPrice,
          wholesale_price_per_kg: item.wholesalePrice,
          retail_price_per_kg: item.retailPrice,
          price_effective_date: item.priceEffectiveDate,
          last_updated: serverTimestamp(),
        };
        if (item.tamilName) fields.tamil_name = item.tamilName;

        if (existingDoc) {
          batch.update(existingDoc.ref, fields);
          updated += 1;
        } else {
          batch.set(doc(collection(db, "products")), {
            name: item.name,
            tamil_name: item.tamilName || null,
            stock_kg: 0,
            ...fields,
          });
          created += 1;
        }
      }

      await batch.commit();

      const skippedNote = skipped.length > 0 ? ` ${skipped.length} row${skipped.length === 1 ? "" : "s"} skipped: ${skipped.map((s) => s.reason).join(" ")}` : "";
      setUploadStatus({
        type: skipped.length > 0 ? "error" : "success",
        message: `Synced ${items.length} item${items.length === 1 ? "" : "s"} — ${created} created, ${updated} updated.${skippedNote}`,
      });
      setSelectedFile(null);
      document.getElementById("file-input").value = "";
    } catch (err) {
      console.error("Failed to process price sheet: ", err);
      setUploadStatus({ type: "error", message: err.message || "Failed to process the price sheet - try again." });
    } finally {
      setUploading(false);
    }
  };

  // fetch + Blob download rather than a plain navigation/link, since the
  // export route requires a Bearer token (Authorization header) that a
  // window.location.href navigation can't carry.
  const handleTallyExport = async () => {
    setExportingTally(true);
    setTallyExportError("");
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/export-tally?from=${tallyFrom}&to=${tallyTo}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Export failed - try again.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tally-export-${tallyFrom}_to_${tallyTo}.xml`;
      a.click();
      URL.revokeObjectURL(url);
      setShowTallyExport(false);
    } catch (error) {
      console.error("Tally export failed: ", error);
      setTallyExportError(error.message || "Export failed - try again.");
    } finally {
      setExportingTally(false);
    }
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
    const matchesLowStock = !lowStockOnly || (p.stock_kg ?? 0) < LOW_STOCK_THRESHOLD_KG;
    return matchesSearch && matchesCategory && matchesLowStock;
  });

  return (
    <main className="p-8 md:p-12 h-full flex flex-col w-full bg-cream-50 dark:bg-cream-950 min-h-screen transition-colors">
      <PageHeader
        title="Price Setup"
        subtitle="Manage your product catalog, prices, and stock levels."
        actions={
          <>
            <Button variant="secondary" size="md" onClick={() => setShowTallyExport(true)}>
              Export to Tally
            </Button>
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
            <p className="text-warmgray-500 dark:text-warmgray-400 font-medium text-sm mb-2">Stock and price levels for all products. Click a row to edit it.</p>
            {lowStockOnly && (
              <button
                type="button"
                onClick={() => setLowStockOnly(false)}
                className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-rust-100 dark:bg-rust-950/50 text-rust-700 dark:text-rust-400 hover:bg-rust-200 dark:hover:bg-rust-900 transition-colors"
              >
                Filtered: Low Stock ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 flex-1 min-w-0 justify-end">
            <CategoryChipFilter
              categories={categoryList}
              counts={categoryCounts}
              totalCount={products.length}
              value={categoryFilter}
              onChange={setCategoryFilter}
              className="flex-1 justify-end"
            />

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
              <Th>Price As Of</Th>
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
                  <Td><Skeleton className="h-4 w-16" /></Td>
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
              <Th>Price As Of</Th>
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
                    <Td className="font-semibold text-ink-900 dark:text-ink-50">
                      {product.name}
                      {product.tamil_name && (
                        <span className="block text-xs font-normal text-warmgray-400">{product.tamil_name}</span>
                      )}
                    </Td>
                    <Td className="text-warmgray-500 dark:text-warmgray-400">{product.category || "—"}</Td>
                    <Td>₹{formatINR(product.retail_price_per_kg ?? 0)}</Td>
                    <Td>₹{formatINR(product.wholesale_price_per_kg ?? 0)}</Td>
                    <Td>{product.cost_price_per_kg != null ? `₹${formatINR(product.cost_price_per_kg)}` : <span className="text-warmgray-400">—</span>}</Td>
                    <Td className="text-warmgray-500 dark:text-warmgray-400">{product.price_effective_date ? formatDate(product.price_effective_date) : "—"}</Td>
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
            label="Tamil Name (optional)"
            className="w-full"
            value={addForm.tamilName}
            onChange={(e) => setAddForm({ ...addForm, tamilName: e.target.value })}
            placeholder="e.g. முந்திரி"
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
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400 mb-2">
              Price As Of (optional)
            </label>
            <DatePicker
              value={addForm.priceEffectiveDate}
              onChange={(value) => setAddForm({ ...addForm, priceEffectiveDate: value })}
              max={todayStr()}
              aria-label="Price as of date"
            />
          </div>
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
        isOpen={showTallyExport}
        onClose={() => {
          if (exportingTally) return;
          setShowTallyExport(false);
          setTallyExportError("");
        }}
        title="Export to Tally"
        panelClassName="max-w-sm"
        footer={
          <Button variant="primary" size="md" className="w-full" disabled={exportingTally} onClick={handleTallyExport}>
            {exportingTally ? "Exporting..." : "Download XML"}
          </Button>
        }
      >
        <div className="p-5 space-y-3">
          <p className="text-sm text-warmgray-500 dark:text-warmgray-400 font-medium">
            Downloads a simple accounting-only XML (Debit Cash/Sundry Debtors, Credit Sales Account per transaction) for
            TallyPrime&apos;s Import Data &gt; Vouchers. No GST/HSN/item lines.
          </p>
          <div className="flex items-center gap-2">
            <DatePicker value={tallyFrom} onChange={setTallyFrom} max={tallyTo} aria-label="From date" />
            <span className="text-xs text-warmgray-400">to</span>
            <DatePicker value={tallyTo} onChange={setTallyTo} max={todayStr()} aria-label="To date" />
          </div>
          {tallyExportError && <p className="text-sm text-rust-600 dark:text-rust-400 font-semibold">{tallyExportError}</p>}
        </div>
      </Modal>

      <EditProductModal
        key={editingProduct?.id || "none"}
        product={editingProduct}
        onClose={closeEditModal}
        onDelete={handleDeleteProduct}
        deletingId={deletingId}
      />

      <Modal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        title="Upload Price Sheet"
        panelClassName="max-w-sm"
      >
        <div className="p-5">
          <p className="text-sm text-warmgray-500 dark:text-warmgray-400 font-medium mb-5">
            Upload a .xlsx price sheet with a Category label, and a table of Item Name / Tamil Name / Purchase Price /
            WS / R / As Per columns. Matching products are updated; new item names are added to the catalog.
          </p>
          <form onSubmit={handleUpload} className="space-y-5">
            <div className="border-2 border-dashed border-warmgray-300 dark:border-warmgray-700 rounded-xl p-6 text-center bg-warmgray-50 dark:bg-warmgray-800/50">
              <input
                id="file-input"
                type="file"
                accept=".xlsx"
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
