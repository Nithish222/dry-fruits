"use client";
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatINR } from "@/lib/format";
import PurchaseDetailModal from "@/components/PurchaseDetailModal";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Skeleton from "@/components/ui/Skeleton";
import { Table, THead, Th, Tr, Td } from "@/components/ui/Table";
import { Eye } from "@/components/ui/icons";

const SKELETON_ROWS = 6;

export default function PurchaseHistoryPage() {
  const [purchases, setPurchases] = useState([]);
  const [purchaseReturns, setPurchaseReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRecord, setSelectedRecord] = useState(null);

  useEffect(() => {
    const q = query(collection(db, "purchases"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        setPurchases(querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        setLoading(false);
      },
      (error) => {
        console.error("Error fetching purchases: ", error);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "purchaseReturns"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        setPurchaseReturns(querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      },
      (error) => {
        console.error("Error fetching purchase returns: ", error);
      }
    );
    return () => unsubscribe();
  }, []);

  const mergedRecords = useMemo(() => {
    const purchaseRows = purchases.map((p) => ({ ...p, _kind: "purchase" }));
    const returnRows = purchaseReturns.map((r) => ({ ...r, _kind: "return" }));
    return [...purchaseRows, ...returnRows].sort(
      (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
    );
  }, [purchases, purchaseReturns]);

  const filteredRecords = mergedRecords.filter((r) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (r.supplierName || "").toLowerCase().includes(q);
  });

  return (
    <main className="p-6 md:p-8 h-full flex flex-col w-full bg-cream-50 dark:bg-cream-950 min-h-screen transition-colors duration-300">
      <PageHeader
        title="Purchase History"
        subtitle="Review stock receipts and returns to suppliers"
        className="flex-shrink-0"
      />

      <div className="mb-4 flex-shrink-0">
        <Input
          type="text"
          size="lg"
          className="w-full max-w-md font-medium"
          placeholder="Search by supplier name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <Card padding="p-0" className="overflow-hidden flex-shrink-0">
        <Table variant="comfortable">
          <THead>
            <Th>Date</Th>
            <Th>Supplier</Th>
            <Th>Type</Th>
            <Th align="right">Amount</Th>
            <Th align="right">Actions</Th>
          </THead>
          <tbody>
            {loading ? (
              Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <Tr key={i}>
                  <Td><Skeleton className="h-4 w-28" /></Td>
                  <Td><Skeleton className="h-4 w-32" /></Td>
                  <Td><Skeleton className="h-5 w-24 rounded-full" /></Td>
                  <Td align="right"><Skeleton className="h-4 w-16 ml-auto" /></Td>
                  <Td align="right"><Skeleton className="h-8 w-20 ml-auto rounded-lg" /></Td>
                </Tr>
              ))
            ) : filteredRecords.length === 0 ? (
              <tr>
                <td colSpan="5" className="text-center py-10 text-warmgray-500 dark:text-warmgray-400">
                  {searchQuery ? "No matching purchases found." : "No purchase history found."}
                </td>
              </tr>
            ) : (
              filteredRecords.map((record) => (
                <Tr key={record.id}>
                  <Td className="font-medium text-ink-900 dark:text-ink-50">
                    {record.createdAt ? new Date(record.createdAt.seconds * 1000).toLocaleString() : "N/A"}
                  </Td>
                  <Td className="font-medium text-ink-900 dark:text-ink-50">{record.supplierName || "N/A"}</Td>
                  <Td>
                    <Badge variant={record._kind === "purchase" ? "success" : "warning"} size="sm">
                      {record._kind === "purchase" ? "Stock Receipt" : "Return / Debit Note"}
                    </Badge>
                  </Td>
                  <Td align="right" className="font-bold text-ink-900 dark:text-ink-50">
                    ₹{formatINR(record._kind === "purchase" ? record.grandTotal : record.totalAmount)}
                  </Td>
                  <Td align="right">
                    <Button variant="secondary" size="sm" onClick={() => setSelectedRecord(record)}>
                      <Eye className="w-3.5 h-3.5" />
                      View
                    </Button>
                  </Td>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>

      <PurchaseDetailModal
        key={selectedRecord?.id || "none"}
        isOpen={!!selectedRecord}
        record={selectedRecord}
        onClose={() => setSelectedRecord(null)}
      />
    </main>
  );
}
