"use client";
import { useEffect, useState } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatINR } from "@/lib/format";
import CustomerLookupModal from "@/components/CustomerLookupModal";

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [lookupCustomer, setLookupCustomer] = useState(null);
  const [showCustomerLookup, setShowCustomerLookup] = useState(false);

  // Real-time listener instead of a one-shot fetch: Firestore serves the
  // cached snapshot instantly on (re)subscribe, so switching tabs and back
  // doesn't cause a visible reload, and it only pushes updates when sales
  // history actually changes in the DB.
  useEffect(() => {
    const q = query(collection(db, "transactions"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        const transactionsList = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setTransactions(transactionsList);
        setLoading(false);
      },
      (error) => {
        console.error("Error fetching transactions: ", error);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const filteredTransactions = transactions.filter((tx) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const name = tx.customer?.name?.toLowerCase() || "";
    const phone = tx.customer?.phoneNumber?.toLowerCase() || "";
    return name.includes(q) || phone.includes(q);
  });

  const openCustomerLookup = (customer) => {
    if (!customer?.phoneNumber) return;
    setLookupCustomer({
      id: customer.phoneNumber,
      name: customer.name,
      phoneNumber: customer.phoneNumber,
    });
    setShowCustomerLookup(true);
  };

  return (
    <main className="p-6 md:p-8 h-full flex flex-col w-full bg-gray-50 dark:bg-gray-950 min-h-screen transition-colors duration-300">
      <header className="mb-6 bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 transition-colors">
        <h1 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">Sales History</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium mt-1">Review all completed transactions</p>
      </header>

      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by customer name or phone number..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full max-w-md px-5 py-3 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 focus:ring-2 focus:ring-emerald-500 text-gray-900 dark:text-white font-medium"
        />
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400">
            <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-800 dark:text-gray-400">
              <tr>
                <th scope="col" className="px-6 py-3">Date</th>
                <th scope="col" className="px-6 py-3">Customer</th>
                <th scope="col" className="px-6 py-3">Total Items</th>
                <th scope="col" className="px-6 py-3">Price Mode</th>
                <th scope="col" className="px-6 py-3 text-right">Total Amount</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="5" className="text-center py-10">Loading transactions...</td></tr>
              ) : filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan="5" className="text-center py-10">
                    {searchQuery ? "No matching transactions found." : "No transactions found."}
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => (
                  <tr key={tx.id} className="bg-white dark:bg-gray-900 border-b dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                    <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">
                      {tx.createdAt ? new Date(tx.createdAt.seconds * 1000).toLocaleString() : 'N/A'}
                    </td>
                    <td className="px-6 py-4">
                      {tx.customer?.phoneNumber ? (
                        <button
                          onClick={() => openCustomerLookup(tx.customer)}
                          className="text-left hover:underline"
                        >
                          <p className="font-medium text-gray-900 dark:text-white">{tx.customer?.name || "N/A"}</p>
                          <p className="text-xs text-gray-400">{tx.customer?.phoneNumber}</p>
                        </button>
                      ) : (
                        <p className="font-medium text-gray-900 dark:text-white">N/A</p>
                      )}
                    </td>
                    <td className="px-6 py-4">{tx.items.length}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${tx.priceType === 'retail' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}`}>
                        {tx.priceType}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-gray-800 dark:text-gray-200">
                      ₹{formatINR(tx.grandTotal)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CustomerLookupModal
        key={lookupCustomer?.id || "none"}
        isOpen={showCustomerLookup}
        initialCustomer={lookupCustomer}
        onClose={() => setShowCustomerLookup(false)}
      />
    </main>
  );
}