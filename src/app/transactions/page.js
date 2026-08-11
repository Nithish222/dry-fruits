"use client";
import { useEffect, useState } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatINR } from "@/lib/format";
import CustomerLookupModal from "@/components/CustomerLookupModal";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Badge from "@/components/ui/Badge";
import Skeleton from "@/components/ui/Skeleton";
import { Table, THead, Th, Tr, Td } from "@/components/ui/Table";

const SKELETON_ROWS = 6;

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
      <PageHeader title="Sales History" subtitle="Review all completed transactions" />

      <div className="mb-4">
        <Input
          type="text"
          size="lg"
          className="w-full max-w-md font-medium"
          placeholder="Search by customer name or phone number..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <Card padding="p-0" className="overflow-hidden">
        <Table variant="comfortable">
          <THead>
            <Th>Date</Th>
            <Th>Customer</Th>
            <Th>Total Items</Th>
            <Th>Price Mode</Th>
            <Th align="right">Total Amount</Th>
          </THead>
          <tbody>
            {loading ? (
              Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <Tr key={i}>
                  <Td><Skeleton className="h-4 w-28" /></Td>
                  <Td><Skeleton className="h-4 w-32" /></Td>
                  <Td><Skeleton className="h-4 w-10" /></Td>
                  <Td><Skeleton className="h-5 w-16 rounded-full" /></Td>
                  <Td align="right"><Skeleton className="h-4 w-16 ml-auto" /></Td>
                </Tr>
              ))
            ) : filteredTransactions.length === 0 ? (
              <tr>
                <td colSpan="5" className="text-center py-10 text-gray-500 dark:text-gray-400">
                  {searchQuery ? "No matching transactions found." : "No transactions found."}
                </td>
              </tr>
            ) : (
              filteredTransactions.map((tx) => (
                <Tr key={tx.id}>
                  <Td className="font-medium text-gray-900 dark:text-white">
                    {tx.createdAt ? new Date(tx.createdAt.seconds * 1000).toLocaleString() : "N/A"}
                  </Td>
                  <Td>
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
                  </Td>
                  <Td>{tx.items.length}</Td>
                  <Td>
                    <Badge variant={tx.priceType === "retail" ? "success" : "info"} size="sm">
                      {tx.priceType}
                    </Badge>
                  </Td>
                  <Td align="right" className="font-bold text-gray-800 dark:text-gray-200">
                    ₹{formatINR(tx.grandTotal)}
                  </Td>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>

      <CustomerLookupModal
        key={lookupCustomer?.id || "none"}
        isOpen={showCustomerLookup}
        initialCustomer={lookupCustomer}
        onClose={() => setShowCustomerLookup(false)}
      />
    </main>
  );
}
