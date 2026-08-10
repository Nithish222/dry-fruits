"use client";
import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";

const LOW_STOCK_THRESHOLD_KG = 5;

export default function AdminPage() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({ type: "", message: "" });
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);

  useEffect(() => {
    async function fetchProducts() {
      try {
        const querySnapshot = await getDocs(collection(db, "products"));
        const productsList = querySnapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .sort((a, b) => (a.stock_kg ?? 0) - (b.stock_kg ?? 0));
        setProducts(productsList);
      } catch (error) {
        console.error("Error fetching products: ", error);
      } finally {
        setProductsLoading(false);
      }
    }
    fetchProducts();
  }, []);

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
    <main className="p-8 md:p-12 h-full flex flex-col w-full bg-gray-50 dark:bg-gray-950 min-h-screen transition-colors">
      <div className="max-w-2xl mx-auto w-full bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-8 mt-6">
        
        <h1 className="text-3xl font-black text-gray-900 dark:text-white mb-2">Price Setup</h1>
        <p className="text-gray-500 dark:text-gray-400 font-medium mb-8 text-sm">Upload a new vendor spreadsheet to instantly update catalog prices across all registers.</p>
        
        <form onSubmit={handleUpload} className="space-y-6">
          <div className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-8 text-center bg-gray-50 dark:bg-gray-800/50">
            <input
              id="file-input"
              type="file"
              accept=".csv, .xlsx"
              onChange={handleFileChange}
              disabled={uploading}
              className="block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2.5 file:px-6 file:rounded-lg file:border-0 file:bg-gray-900 dark:file:bg-emerald-600 file:text-white hover:file:bg-black dark:hover:file:bg-emerald-700 cursor-pointer mx-auto font-semibold"
            />
          </div>
          
          <button
            type="submit"
            disabled={!selectedFile || uploading}
            className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
              selectedFile && !uploading 
                ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-md" 
                : "bg-gray-200 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed"
            }`}
          >
            {uploading ? "Syncing Database..." : "Update Live Prices"}
          </button>
        </form>

        {uploadStatus.message && (
          <div className={`mt-6 p-4 rounded-xl font-bold text-center text-sm ${
            uploadStatus.type === "success" 
              ? "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800" 
              : "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800"
          }`}>
            {uploadStatus.message}
          </div>
        )}
      </div>

      <div className="max-w-2xl mx-auto w-full bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-8 mt-6">
        <h2 className="text-xl font-black text-gray-900 dark:text-white mb-1">Inventory</h2>
        <p className="text-gray-500 dark:text-gray-400 font-medium mb-6 text-sm">Current stock levels for all products.</p>

        {productsLoading ? (
          <div className="text-center py-10 text-gray-400 font-medium text-sm">Loading inventory...</div>
        ) : products.length === 0 ? (
          <div className="text-center py-10 text-gray-400 font-medium text-sm">No products found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-left text-gray-500 dark:text-gray-400 font-semibold">
                <th className="py-2 pr-4">Product</th>
                <th className="py-2 pr-4">Stock (kg)</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const stock = product.stock_kg ?? 0;
                const isLow = stock < LOW_STOCK_THRESHOLD_KG;
                return (
                  <tr key={product.id} className="border-b border-gray-100 dark:border-gray-800/60">
                    <td className="py-2 pr-4 font-semibold text-gray-900 dark:text-white">{product.name}</td>
                    <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">{stock}</td>
                    <td className="py-2">
                      {isLow ? (
                        <span className="text-red-700 dark:text-red-400 font-bold text-xs">⚠ Low Stock</span>
                      ) : (
                        <span className="text-emerald-700 dark:text-emerald-400 font-medium text-xs">In Stock</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}