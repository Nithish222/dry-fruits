"use client";
import { useEffect, useState } from "react";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTransactions() {
      try {
        const q = query(collection(db, "transactions"), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        const transactionsList = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setTransactions(transactionsList);
      } catch (error) {
        console.error("Error fetching transactions: ", error);
      } finally {
        setLoading(false);
      }
    }
    fetchTransactions();
  }, []);

  return (
    <main className="p-6 md:p-8 h-full flex flex-col w-full bg-gray-50 dark:bg-gray-950 min-h-screen transition-colors duration-300">
      <header className="mb-6 bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 transition-colors">
        <h1 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">Sales History</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium mt-1">Review all completed transactions</p>
      </header>

      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400">
            <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-800 dark:text-gray-400">
              <tr>
                <th scope="col" className="px-6 py-3">Date</th>
                <th scope="col" className="px-6 py-3">Total Items</th>
                <th scope="col" className="px-6 py-3">Price Mode</th>
                <th scope="col" className="px-6 py-3 text-right">Total Amount</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="4" className="text-center py-10">Loading transactions...</td></tr>
              ) : transactions.length === 0 ? (
                <tr><td colSpan="4" className="text-center py-10">No transactions found.</td></tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="bg-white dark:bg-gray-900 border-b dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                    <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">
                      {tx.createdAt ? new Date(tx.createdAt.seconds * 1000).toLocaleString() : 'N/A'}
                    </td>
                    <td className="px-6 py-4">{tx.items.length}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${tx.priceType === 'retail' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}`}>
                        {tx.priceType}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-gray-800 dark:text-gray-200">
                      ₹{tx.grandTotal.toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}