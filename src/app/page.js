"use client";

import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase"; // Make sure this points to your firebase config

export default function Home() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Upload States
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({ type: "", message: "" });

  // Fetch Inventory on mount
  useEffect(() => {
    async function fetchProducts() {
      try {
        const querySnapshot = await getDocs(collection(db, "products"));
        const productsList = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setProducts(productsList);
      } catch (error) {
        console.error("Error fetching products: ", error);
      } finally {
        setLoading(false);
      }
    }

    fetchProducts();
  }, []);

  // File selection handler
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const extension = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
      if (extension === ".csv" || extension === ".xlsx") {
        setSelectedFile(file);
        setUploadStatus({ type: "", message: "" });
      } else {
        setSelectedFile(null);
        setUploadStatus({
          type: "error",
          message: "Please select a valid .csv or .xlsx sheet.",
        });
      }
    }
  };

  // Upload trigger
  const handleUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) return;

    setUploading(true);
    setUploadStatus({ type: "", message: "" });

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        setUploadStatus({
          type: "success",
          message: `Success! ${selectedFile.name} uploaded to Cloud Storage.`,
        });
        setSelectedFile(null);
        // Reset file input element
        document.getElementById("file-input").value = "";
        
        // Optional: Refresh the page after 2 seconds to see new prices
        setTimeout(() => window.location.reload(), 2000);
      } else {
        setUploadStatus({
          type: "error",
          message: data.error || "Something went wrong during the upload.",
        });
      }
    } catch (err) {
      setUploadStatus({
        type: "error",
        message: "Network error occurred. Could not reach server.",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-6 animate-fade-in">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="border-b pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Dry Fruits POS</h1>
            <p className="text-gray-500 mt-1">Real-time inventory & price management</p>
          </div>
          <div className="bg-white px-4 py-2 rounded-lg border border-gray-200 shadow-sm flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            <span className="text-sm font-medium text-gray-700">Firestore Connected</span>
          </div>
        </header>

        {/* GCS Price Sheet Uploader Component */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-xl font-bold text-gray-800 mb-2">Upload Price Sheet</h2>
          <p className="text-sm text-gray-500 mb-4">
            Upload custom vendor prices directly to your Google Cloud Storage bucket (`dry-fruits-price`).
          </p>
          
          <form onSubmit={handleUpload} className="space-y-4">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <input
                id="file-input"
                type="file"
                accept=".csv, .xlsx"
                onChange={handleFileChange}
                disabled={uploading}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-amber-50 file:text-amber-700 hover:file:bg-amber-100 cursor-pointer disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!selectedFile || uploading}
                className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm flex items-center justify-center gap-2 whitespace-nowrap
                ${
                  selectedFile && !uploading
                    ? "bg-amber-500 text-white hover:bg-amber-600 cursor-pointer"
                    : "bg-gray-200 text-gray-400 cursor-not-allowed"
                }`}
              >
                {uploading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    Uploading...
                  </>
                ) : (
                  "Upload to GCS"
                )}
              </button>
            </div>

            {/* Status Feedback Messages */}
            {uploadStatus.message && (
              <div
                className={`p-3.5 rounded-lg text-sm border font-medium ${
                  uploadStatus.type === "success"
                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                    : "bg-rose-50 text-rose-800 border-rose-200"
                }`}
              >
                {uploadStatus.message}
              </div>
            )}
          </form>
        </section>

        {/* Product Catalog List */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold text-gray-800">Current Catalog</h2>
          {loading ? (
            <div className="flex flex-col justify-center items-center h-48 gap-3">
              <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-500 font-medium">Fetching fresh catalog...</p>
            </div>
          ) : products.length === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center max-w-md mx-auto">
              <h3 className="text-lg font-semibold text-amber-800 mb-2">No Products Seeded</h3>
              <p className="text-amber-700 mb-2 text-sm">
                No active products found in Firestore.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {products.map((product) => (
                <div
                  key={product.id}
                  className="bg-white rounded-xl shadow-sm hover:shadow-md transition-all duration-200 p-6 border border-gray-200 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex justify-between items-start gap-2 mb-3">
                      <h2 className="text-lg font-bold text-gray-900 leading-tight">{product.name}</h2>
                      <span className="bg-amber-50 text-amber-800 text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap">
                        {product.category || 'Dry Fruits'}
                      </span>
                    </div>
                    
                    <div className="space-y-2 text-sm text-gray-600 mt-4 border-t pt-4">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Stock Available</span>
                        <span className={`font-semibold ${product.stock_kg < 30 ? 'text-rose-600' : 'text-gray-800'}`}>
                          {product.stock_kg} kg
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Retail Price</span>
                        <span className="font-bold text-emerald-600 text-base">₹{product.retail_price_per_kg}/kg</span>
                      </div>
                      <div className="flex justify-between border-t border-dashed pt-2 mt-2">
                        <span className="text-gray-400">Wholesale Price</span>
                        <span className="font-semibold text-blue-600">₹{product.wholesale_price_per_kg}/kg</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-5 pt-3 border-t border-gray-100 text-[10px] text-gray-400 text-right">
                    ID: {product.id}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}