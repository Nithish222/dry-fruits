"use client";
import { useEffect, useState } from "react";
import { collection, doc, increment, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatINR, roundKg, LOW_STOCK_THRESHOLD_KG } from "@/lib/format";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Badge from "@/components/ui/Badge";
import Skeleton from "@/components/ui/Skeleton";
import { Table, THead, Th, Tr, Td } from "@/components/ui/Table";

const SKELETON_ROWS = 3;

export default function AdminPage() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({ type: "", message: "" });
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");

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
    setEditingId(product.id);
    setEditError("");
    setEditForm({
      retailPrice: String(product.retail_price_per_kg ?? 0),
      wholesalePrice: String(product.wholesale_price_per_kg ?? 0),
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

    if (!Number.isFinite(retailPrice) || retailPrice < 0) {
      setEditError("Retail price must be a non-negative number.");
      return;
    }
    if (!Number.isFinite(wholesalePrice) || wholesalePrice < 0) {
      setEditError("Wholesale price must be a non-negative number.");
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

  return (
    <main className="p-8 md:p-12 h-full flex flex-col w-full bg-cream-50 dark:bg-cream-950 min-h-screen transition-colors">
      <PageHeader
        title="Price Setup"
        subtitle="Upload a new vendor spreadsheet to instantly update catalog prices across all registers."
      />

      <Card padding="p-6" className="max-w-2xl mx-auto w-full">
        <form onSubmit={handleUpload} className="space-y-6">
          <div className="border-2 border-dashed border-warmgray-300 dark:border-warmgray-700 rounded-xl p-8 text-center bg-warmgray-50 dark:bg-warmgray-800/50">
            <input
              id="file-input"
              type="file"
              accept=".csv, .xlsx"
              onChange={handleFileChange}
              disabled={uploading}
              className="block w-full text-sm text-warmgray-500 dark:text-warmgray-400 file:mr-4 file:py-2.5 file:px-6 file:rounded-lg file:border-0 file:bg-clay-400 file:text-white hover:file:bg-clay-600 cursor-pointer mx-auto font-semibold"
            />
          </div>

          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={!selectedFile || uploading}>
            {uploading ? "Syncing Database..." : "Update Live Prices"}
          </Button>
        </form>

        {uploadStatus.message && (
          <div className={`mt-6 p-4 rounded-xl font-bold text-center text-sm ${
            uploadStatus.type === "success"
              ? "bg-sage-50 dark:bg-sage-950 text-sage-700 dark:text-sage-400 border border-sage-200 dark:border-sage-800"
              : "bg-rust-50 dark:bg-rust-950 text-rust-700 dark:text-rust-400 border border-rust-200 dark:border-rust-800"
          }`}>
            {uploadStatus.message}
          </div>
        )}
      </Card>

      <Card padding="p-6" className="max-w-4xl mx-auto w-full mt-6">
        <h2 className="text-2xl font-black text-ink-900 dark:text-ink-50 mb-1">Inventory</h2>
        <p className="text-warmgray-500 dark:text-warmgray-400 font-medium mb-4 text-sm">Stock and price levels for all products. Click Edit to update a product directly.</p>

        {productsLoading ? (
          <Table variant="compact">
            <THead>
              <Th>Product</Th>
              <Th>Retail ₹/kg</Th>
              <Th>Wholesale ₹/kg</Th>
              <Th>Stock (kg)</Th>
              <Th>Status</Th>
              <Th></Th>
            </THead>
            <tbody>
              {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <Tr key={i}>
                  <Td><Skeleton className="h-4 w-32" /></Td>
                  <Td><Skeleton className="h-4 w-14" /></Td>
                  <Td><Skeleton className="h-4 w-14" /></Td>
                  <Td><Skeleton className="h-4 w-10" /></Td>
                  <Td><Skeleton className="h-5 w-16 rounded-full" /></Td>
                  <Td><Skeleton className="h-7 w-12 rounded-md" /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : products.length === 0 ? (
          <div className="text-center py-10 text-warmgray-400 font-medium text-sm">No products found.</div>
        ) : (
          <Table variant="compact">
            <THead>
              <Th>Product</Th>
              <Th>Retail ₹/kg</Th>
              <Th>Wholesale ₹/kg</Th>
              <Th>Stock (kg)</Th>
              <Th>Status</Th>
              <Th></Th>
            </THead>
            <tbody>
              {products.map((product) => {
                const stock = product.stock_kg ?? 0;
                const isLow = stock < LOW_STOCK_THRESHOLD_KG;
                const isEditing = editingId === product.id;

                if (isEditing) {
                  const addPreview = editForm.stockMode === "add" ? stock + (Number(editForm.stockValue) || 0) : null;
                  return (
                    <Tr key={product.id} className="bg-warmgray-50 dark:bg-warmgray-800/40">
                      <Td className="font-semibold text-ink-900 dark:text-ink-50 align-top">{product.name}</Td>
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

                return (
                  <Tr key={product.id}>
                    <Td className="font-semibold text-ink-900 dark:text-ink-50">{product.name}</Td>
                    <Td>₹{formatINR(product.retail_price_per_kg ?? 0)}</Td>
                    <Td>₹{formatINR(product.wholesale_price_per_kg ?? 0)}</Td>
                    <Td>{stock}</Td>
                    <Td>
                      <Badge variant={isLow ? "danger" : "success"} size="sm">
                        {isLow ? "⚠ Low Stock" : "In Stock"}
                      </Badge>
                    </Td>
                    <Td>
                      <Button variant="primary" size="sm" onClick={() => startEdit(product)}>
                        Edit
                      </Button>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </main>
  );
}
