"use client";
import { useEffect, useState } from "react";
import { collection, getDocs, doc, runTransaction, serverTimestamp, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

export default function Home() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [cart, setCart] = useState([]);
  const [priceType, setPriceType] = useState("retail");
  const [showReceipt, setShowReceipt] = useState(false);

  // New states for customer details
  const [customerName, setCustomerName] = useState("");
  const [customerPhoneNumber, setCustomerPhoneNumber] = useState("");
  const [customerSuggestions, setCustomerSuggestions] = useState([]);
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null); // To store the selected customer object

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

  // New useEffect for customer suggestions
  useEffect(() => {
    const fetchCustomerSuggestions = async () => {
      // Only show suggestions if there's some input in either field
      if (!customerName && !customerPhoneNumber) {
        setCustomerSuggestions([]);
        setShowCustomerSuggestions(false);
        return;
      }

      try {
        let q = collection(db, "customers");
        let queryConstraints = [];

        // Build query constraints based on input
        if (customerName) {
          // Case-insensitive search for name starting with or containing
          queryConstraints.push(where("name", ">=", customerName));
          queryConstraints.push(where("name", "<=", customerName + "\uf8ff"));
        }

        // If a name is typed, and then a phone number is typed, filter by phone number too
        // This allows for dynamic filtering of multiple users with the same name
        if (customerPhoneNumber) {
          queryConstraints.push(where("phoneNumber", ">=", customerPhoneNumber));
          queryConstraints.push(where("phoneNumber", "<=", customerPhoneNumber + "\uf8ff"));
        }

        const customerQuery = query(collection(db, "customers"), ...queryConstraints);
        const querySnapshot = await getDocs(customerQuery);
        const suggestions = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setCustomerSuggestions(suggestions);
        setShowCustomerSuggestions(suggestions.length > 0);
      } catch (error) {
        console.error("Error fetching customer suggestions: ", error);
        setCustomerSuggestions([]);
        setShowCustomerSuggestions(false);
      }
    };

    const handler = setTimeout(fetchCustomerSuggestions, 300); // Debounce search
    return () => clearTimeout(handler);
  }, [customerName, customerPhoneNumber]); // Depend on both for dynamic filtering

  const filteredProducts = products.filter((product) =>
    product.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const addToCart = (product) => {
    const activePrice = priceType === "retail" ? product.retail_price_per_kg : product.wholesale_price_per_kg;
    setCart((prevCart) => {
      if (prevCart.find((item) => item.id === product.id)) return prevCart;
      return [...prevCart, { ...product, weight_kg: 0, unit: "kg", billedPrice: activePrice }];
    });
  };

  const handlePriceTypeChange = (newType) => {
    setPriceType(newType);
    setCart((prevCart) =>
      prevCart.map((item) => ({
        ...item,
        billedPrice: newType === "retail" ? item.retail_price_per_kg : item.wholesale_price_per_kg,
      }))
    );
  };

  const updateWeight = (id, newWeightVal) => {
    setCart((prevCart) =>
      prevCart.map((item) => {
        if (item.id === id) {
          const kgValue = item.unit === "gm" ? Number(newWeightVal) / 1000 : Number(newWeightVal);
          return { ...item, weight_kg: kgValue };
        }
        return item;
      })
    );
  };

  const addQuickWeight = (id, kgToAdd) => {
    setCart((prevCart) =>
      prevCart.map((item) =>
        item.id === id ? { ...item, weight_kg: item.weight_kg + kgToAdd } : item
      )
    );
  };

  const toggleUnit = (id) => {
    setCart((prevCart) =>
      prevCart.map((item) =>
        item.id === id ? { ...item, unit: item.unit === "kg" ? "gm" : "kg" } : item
      )
    );
  };

  const removeItem = (id) => {
    setCart((prevCart) => prevCart.filter((item) => item.id !== id));
  };

  const cartTotal = cart.reduce((total, item) => total + item.billedPrice * (item.weight_kg || 0), 0);

  const handleCheckout = async () => {
    if (cart.length === 0 || cartTotal <= 0) {
      alert("Cart is empty.");
      return;
    }
    // Validate customer details
    if (!customerName || !customerPhoneNumber) {
      alert("Please enter customer name and phone number.");
      return;
    }

    try {
      await runTransaction(db, async (transaction) => {
        const productUpdates = [];

        // 1. Read all product stocks and validate cart in one loop
        for (const item of cart) {
          if (item.weight_kg <= 0) {
            throw new Error(`Weight for ${item.name} must be positive.`);
          }
          const productRef = doc(db, "products", item.id);
          const productDoc = await transaction.get(productRef);

          if (!productDoc.exists()) {
            throw new Error(`Product ${item.name} not found.`);
          }

          const currentStock = productDoc.data().stock_kg;
          if (currentStock < item.weight_kg) {
            throw new Error(`Not enough stock for ${item.name}. Available: ${currentStock}kg, Requested: ${item.weight_kg}kg`);
          }

          // Prepare the update
          productUpdates.push({ ref: productRef, newStock: currentStock - item.weight_kg });
        }

        // 2. Handle Customer (find or create)
        // Use the phone number as the document ID for a predictable reference.
        const customerRef = doc(db, "customers", customerPhoneNumber);
        const customerDoc = await transaction.get(customerRef);

        if (!customerDoc.exists()) {
          // If the customer doesn't exist, create them.
          transaction.set(customerRef, { 
            name: customerName, 
            phoneNumber: customerPhoneNumber, 
            createdAt: serverTimestamp() 
          });
        }

        // 3. Create the transaction record
        const transactionRef = doc(collection(db, "transactions"));
        const transactionData = {
          items: cart.map(item => ({
            id: item.id, name: item.name, weight_kg: item.weight_kg, billedPrice: item.billedPrice,
            subtotal: item.billedPrice * (item.weight_kg || 0)
          })),
          priceType: priceType, grandTotal: cartTotal, createdAt: serverTimestamp(),
        };
        // Add customer details to transaction
        transactionData.customer = {
          id: customerPhoneNumber, // The ID is now the phone number
          name: customerName,
          phoneNumber: customerPhoneNumber,
        };
        transaction.set(transactionRef, transactionData);

        // 4. Apply all stock updates
        for (const update of productUpdates) {
          transaction.update(update.ref, { stock_kg: update.newStock });
        }
      });

      // 4. On success, show receipt and update local state
      setShowReceipt(true);
      // You might want to refetch products here for the most up-to-date state,
      // or optimistically update the local state. For now, we'll clear the cart.
    } catch (error) {
      console.error("Transaction failed: ", error);
      alert(`Checkout failed: ${error.message}`);
    }
  };

  return (
    <main className="p-6 md:p-8 h-full flex flex-col w-full bg-gray-50 dark:bg-gray-950 min-h-screen transition-colors duration-300">
      <header className="flex justify-between items-center mb-6 bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 transition-colors">
        <div>
          <h1 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">Checkout Register</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-medium mt-1">Select items from catalog and calculate customer bills</p>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-950/50 px-4 py-2 rounded-xl border border-emerald-200 dark:border-emerald-800 shadow-sm flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-sm font-bold text-emerald-800 dark:text-emerald-400">System Online</span>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0">
        <div className="lg:col-span-7 xl:col-span-8 flex flex-col min-h-0 bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-6 transition-colors">
          <div className="mb-6">
            <input
              type="text"
              placeholder="Search products by name... (e.g., Cashew, Raisin)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-5 py-3.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-emerald-500 text-gray-900 dark:text-white font-semibold"
            />
          </div>

          <div className="flex-1 overflow-y-auto pr-2">
            {loading ? (
              <div className="text-center py-20 text-gray-400 font-medium">Loading catalog...</div>
            ) : filteredProducts.length === 0 ? (
              <div className="text-center py-20 text-gray-400 font-medium">No matching products found.</div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredProducts.map((product) => {
                  const displayPrice = priceType === "retail" ? product.retail_price_per_kg : product.wholesale_price_per_kg;
                  return (
                    <div
                      key={product.id}
                      onClick={() => addToCart(product)}
                      className="bg-gray-50 dark:bg-gray-800/50 rounded-xl hover:bg-emerald-50/60 dark:hover:bg-emerald-950/30 hover:border-emerald-400 transition-all cursor-pointer p-4 border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col justify-between h-36 active:scale-95"
                    >
                      <h3 className="font-bold text-gray-900 dark:text-white text-sm leading-snug">{product.name}</h3>
                      <div className="mt-auto pt-2 border-t border-gray-200 dark:border-gray-700 flex justify-between items-end">
                        <span className="text-xs font-medium text-gray-400">{product.stock_kg}kg left</span>
                        <span className="text-emerald-700 dark:text-emerald-400 font-black text-base">
                          ₹{displayPrice} <span className="text-[10px] text-gray-500 uppercase font-bold">/{priceType}</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 xl:col-span-4 flex flex-col min-h-0 bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden transition-colors">
          <div className="p-4 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Current Bill</h2>
            
            <div className="bg-gray-100 dark:bg-gray-800 p-1 rounded-lg flex text-xs font-bold border border-gray-200 dark:border-gray-700">
              <button 
                onClick={() => handlePriceTypeChange("retail")}
                className={`px-3 py-1.5 rounded-md transition-all ${priceType === "retail" ? "bg-emerald-600 text-white shadow-sm" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"}`}
              >
                Retail
              </button>
              <button 
                onClick={() => handlePriceTypeChange("wholesale")}
                className={`px-3 py-1.5 rounded-md transition-all ${priceType === "wholesale" ? "bg-emerald-600 text-white shadow-sm" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"}`}
              >
                Wholesale
              </button>
            </div>
          </div>
          
          {/* New Customer Input Section */}
          <div className="p-5 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
            <h3 className="text-md font-bold text-gray-900 dark:text-white mb-3">Customer Details</h3>
            <div className="space-y-3">
              <div>
                <input
                  type="text"
                  placeholder="Customer Name"
                  value={customerName}
                  onChange={(e) => {
                    setCustomerName(e.target.value);
                    setSelectedCustomer(null); // Clear selected customer if name changes
                  }}
                  className="w-full px-4 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-1 focus:ring-emerald-500 text-gray-900 dark:text-white font-medium"
                />
              </div>
              <div className="relative">
                <input
                  type="tel" // Use type="tel" for phone numbers
                  placeholder="Phone Number"
                  value={customerPhoneNumber}
                  onChange={(e) => {
                    setCustomerPhoneNumber(e.target.value);
                    setSelectedCustomer(null); // Clear selected customer if phone changes
                  }}
                  className="w-full px-4 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-1 focus:ring-emerald-500 text-gray-900 dark:text-white font-medium"
                />
                {showCustomerSuggestions && customerSuggestions.length > 0 && (
                  <ul className="absolute z-10 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                    {customerSuggestions.map((customer) => (
                      <li
                        key={customer.id}
                        onClick={() => {
                          setCustomerName(customer.name);
                          setCustomerPhoneNumber(customer.phoneNumber);
                          setSelectedCustomer(customer);
                          setShowCustomerSuggestions(false); // Hide suggestions after selection
                        }}
                        className="px-4 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 flex justify-between items-center"
                      >
                        <span className="font-medium text-gray-900 dark:text-white">{customer.name}</span>
                        <span className="text-gray-500 dark:text-gray-400 text-sm">{customer.phoneNumber}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-gray-50 dark:bg-gray-950">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-400">
                <span className="text-4xl mb-2">🛒</span>
                <p className="font-medium text-sm">Tap products to start billing</p>
              </div>
            ) : (
              cart.map((item) => {
                const displayValue = item.weight_kg === 0 ? "" : item.unit === "gm" ? (item.weight_kg * 1000) : item.weight_kg;
                return (
                  <div key={item.id} className="bg-white dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm relative">
                    <button onClick={() => removeItem(item.id)} className="absolute top-3 right-3 text-gray-300 dark:text-gray-600 hover:text-red-500 font-bold">✕</button>
                    <p className="font-bold text-gray-900 dark:text-white pr-6">{item.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">₹{item.billedPrice} / kg ({priceType})</p>
                    
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-1">
                        <input 
                          type="number" 
                          min="0" step={item.unit === "kg" ? "0.01" : "1"}
                          value={displayValue} 
                          onChange={(e) => updateWeight(item.id, e.target.value)}
                          className="w-16 bg-transparent px-2 font-bold text-gray-900 dark:text-white text-center focus:outline-none"
                          placeholder="0"
                        />
                        <button 
                          onClick={() => toggleUnit(item.id)}
                          className="bg-white dark:bg-gray-700 shadow-sm text-gray-700 dark:text-gray-200 text-xs font-bold px-2.5 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600"
                        >
                          {item.unit === "kg" ? "kg" : "gm"}
                        </button>
                      </div>
                      <span className="font-black text-gray-900 dark:text-white text-lg">
                        ₹{(item.billedPrice * (item.weight_kg || 0)).toFixed(2)}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-3 border-t border-gray-100 dark:border-gray-800">
                      {[0.05, 0.10, 0.25, 0.50, 1.00].map(w => (
                        <button 
                          key={w} 
                          onClick={() => addQuickWeight(item.id, w)} 
                          className="text-[11px] bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2.5 py-1 font-semibold text-gray-600 dark:text-gray-300 hover:bg-emerald-50 dark:hover:bg-emerald-950 hover:text-emerald-700 dark:hover:text-emerald-400 hover:border-emerald-300"
                        >
                          +{w >= 1 ? `${w}kg` : `${w*1000}g`}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="p-5 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 transition-colors">
            <div className="flex justify-between items-center mb-4">
              <span className="text-gray-500 dark:text-gray-400 font-semibold">Grand Total</span>
              <span className="text-3xl font-black text-emerald-600 dark:text-emerald-400">
                ₹{cartTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
              </span>
            </div>
            <button
              onClick={handleCheckout}
              disabled={cart.length === 0 || cartTotal === 0}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-200 dark:disabled:bg-gray-800 disabled:text-gray-400 text-white font-bold text-lg py-4 rounded-xl shadow-sm transition-all"
            >
              Checkout & Pay
            </button>
          </div>
        </div>
      </div>

      {showReceipt && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
          <div className="bg-white dark:bg-gray-900 p-8 rounded-2xl max-w-sm w-full shadow-2xl text-center border dark:border-gray-800">
            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl font-bold">✓</div>
            <h2 className="text-2xl font-black text-gray-900 dark:text-white">Order Complete!</h2>
            <p className="text-gray-500 dark:text-gray-400 mt-2 font-medium">Total Received: ₹{cartTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
            <button onClick={() => { 
              setCart([]); 
              setShowReceipt(false); 
              // Clear customer details for next order
              setCustomerName("");
              setCustomerPhoneNumber("");
              setCustomerSuggestions([]);
              setSelectedCustomer(null);
            }} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 rounded-xl mt-6 transition-all">
              Start Next Order
            </button>
          </div>
        </div>
      )}
    </main>
  );
}