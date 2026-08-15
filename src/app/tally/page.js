"use client";
import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatINR } from "@/lib/format";
import CustomerLookupModal from "@/components/CustomerLookupModal";
import SupplierLookupModal from "@/components/SupplierLookupModal";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Skeleton from "@/components/ui/Skeleton";
import ToggleGroup from "@/components/ui/ToggleGroup";
import { Table, THead, Th, Tr, Td } from "@/components/ui/Table";
import { Wallet } from "@/components/ui/icons";

const SKELETON_ROWS = 6;
const TAB_OPTIONS = [
  { value: "unified", label: "Unified" },
  { value: "receivables", label: "Receivables" },
  { value: "payables", label: "Payables" },
];

// One cell of the divided-grid summary strip - same shape already used by
// the Owner Dashboard's top stat row (grid-cols-N gap-px bg-warmgray-200
// wrapper, bg-warmgray-50 px-5 py-5 cells), colocated here rather than
// shared since it's a small enough shape to duplicate across the two pages
// (dashboard/page.js's stat cells aren't extracted either).
function StatTile({ label, value, loading, valueClassName = "text-ink-900 dark:text-ink-50", skeletonWidth = "w-24" }) {
  return (
    <div className="bg-warmgray-50 dark:bg-warmgray-800/50 px-5 py-5">
      <p className="text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400">{label}</p>
      {loading ? (
        <Skeleton className={`h-8 ${skeletonWidth} mt-1.5`} />
      ) : (
        <p className={`text-2xl font-black mt-1.5 ${valueClassName}`}>{value}</p>
      )}
    </div>
  );
}

// The Card+Table list block, shared by the standalone Receivables/Payables
// tabs and (twice, side by side) by the Unified tab - one implementation
// instead of the same table duplicated per tab.
function LedgerList({ title, columnLabel, rows, loading, emptyMessage, onRowClick, getSubtext }) {
  return (
    <Card padding="p-0" className="overflow-hidden flex-shrink-0">
      <div className="px-6 py-4 border-b border-warmgray-100 dark:border-warmgray-700 flex items-center gap-2">
        <Wallet className="w-4 h-4 text-warmgray-400" />
        <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50 tracking-wide uppercase">{title}</h2>
      </div>
      <Table variant="comfortable">
        <THead>
          <Th>{columnLabel}</Th>
          <Th align="right">Balance Owed</Th>
        </THead>
        <tbody>
          {loading ? (
            Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <Tr key={i}>
                <Td><Skeleton className="h-4 w-32" /></Td>
                <Td align="right"><Skeleton className="h-4 w-16 ml-auto" /></Td>
              </Tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan="2" className="text-left px-6 py-10 text-warmgray-500 dark:text-warmgray-400">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <Tr key={row.id} onClick={() => onRowClick(row)} className="cursor-pointer">
                <Td>
                  <p className="font-medium text-ink-900 dark:text-ink-50">{row.name}</p>
                  {getSubtext(row) && <p className="text-xs text-warmgray-400">{getSubtext(row)}</p>}
                </Td>
                <Td align="right" className="font-bold text-rust-600 dark:text-rust-400">
                  ₹{formatINR(row.balance)}
                </Td>
              </Tr>
            ))
          )}
        </tbody>
      </Table>
    </Card>
  );
}

// Tally/Khata: receivables (Phase 1 - customers who owe the shop), payables
// (Phase 2 - suppliers the shop owes), and a Unified view combining both
// (Phase 3) - all on one page behind a tab, rather than separate nav items.
// This is exactly why the page (and route) were named "Tally" instead of
// "Receivables" back in Phase 1.
export default function TallyPage() {
  const [activeTab, setActiveTab] = useState("unified");

  const [customers, setCustomers] = useState([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [lookupCustomer, setLookupCustomer] = useState(null);
  const [showCustomerLookup, setShowCustomerLookup] = useState(false);

  const [suppliers, setSuppliers] = useState([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  const [lookupSupplier, setLookupSupplier] = useState(null);
  const [showSupplierLookup, setShowSupplierLookup] = useState(false);

  // Real-time listeners instead of one-shot fetches, matching every other
  // page - Firestore serves the cached snapshot instantly on (re)subscribe.
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "customers"),
      (snapshot) => {
        setCustomers(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        setLoadingCustomers(false);
      },
      (error) => {
        console.error("Error fetching customers: ", error);
        setLoadingCustomers(false);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "suppliers"),
      (snapshot) => {
        setSuppliers(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        setLoadingSuppliers(false);
      },
      (error) => {
        console.error("Error fetching suppliers: ", error);
        setLoadingSuppliers(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // Single source of truth for both the summary tiles and the list rows -
  // Unified reuses these same arrays/sums rather than recomputing them, so
  // there's no way for the strip and the lists below it to disagree.
  const receivables = customers
    .filter((customer) => (customer.balance || 0) > 0)
    .sort((a, b) => (b.balance || 0) - (a.balance || 0));
  const totalReceivable = receivables.reduce((sum, customer) => sum + (customer.balance || 0), 0);

  const payables = suppliers
    .filter((supplier) => (supplier.balance || 0) > 0)
    .sort((a, b) => (b.balance || 0) - (a.balance || 0));
  const totalPayable = payables.reduce((sum, supplier) => sum + (supplier.balance || 0), 0);

  // Positive = the shop is net owed money overall; negative = the shop net
  // owes more than it's owed. Purely derived, no new Firestore field.
  const netPosition = totalReceivable - totalPayable;

  const openCustomerLookup = (customer) => {
    setLookupCustomer({
      id: customer.phoneNumber,
      name: customer.name,
      phoneNumber: customer.phoneNumber,
      balance: customer.balance,
    });
    setShowCustomerLookup(true);
  };

  const openSupplierLookup = (supplier) => {
    setLookupSupplier(
      supplier ? { id: supplier.id, name: supplier.name, phone: supplier.phone, notes: supplier.notes, balance: supplier.balance } : null
    );
    setShowSupplierLookup(true);
  };

  const isUnified = activeTab === "unified";
  const isReceivables = activeTab === "receivables";
  const isPayables = activeTab === "payables";
  const loading = isUnified ? loadingCustomers || loadingSuppliers : isReceivables ? loadingCustomers : loadingSuppliers;

  const subtitle = isUnified
    ? "Net position across customers and suppliers"
    : isReceivables
    ? "Customers who owe the shop"
    : "Suppliers the shop owes";

  return (
    <main className="p-6 md:p-8 h-full flex flex-col w-full bg-cream-50 dark:bg-cream-950 min-h-screen transition-colors duration-300">
      <PageHeader
        title="Tally"
        subtitle={subtitle}
        className="flex-shrink-0"
        actions={
          <div className="flex items-center gap-3">
            <ToggleGroup options={TAB_OPTIONS} value={activeTab} onChange={setActiveTab} />
            {(isUnified || isPayables) && (
              <button
                onClick={() => openSupplierLookup(null)}
                className="text-xs font-bold px-3 py-2 rounded-lg text-clay-700 dark:text-clay-400 bg-clay-50 dark:bg-clay-950/40 border border-clay-200 dark:border-clay-800 hover:bg-clay-100 dark:hover:bg-clay-900 transition-colors whitespace-nowrap"
              >
                + Add Supplier
              </button>
            )}
          </div>
        }
      />

      {isUnified ? (
        <>
          <div className="mb-6 flex-shrink-0 grid grid-cols-1 sm:grid-cols-3 gap-px rounded-xl bg-warmgray-200 dark:bg-warmgray-700 overflow-hidden">
            <StatTile label="Total Receivable" value={`₹${formatINR(totalReceivable)}`} loading={loading} valueClassName="text-rust-600 dark:text-rust-400" />
            <StatTile label="Total Payable" value={`₹${formatINR(totalPayable)}`} loading={loading} valueClassName="text-rust-600 dark:text-rust-400" />
            <StatTile
              label="Net Position"
              value={`${netPosition < 0 ? "−" : ""}₹${formatINR(Math.abs(netPosition))}`}
              loading={loading}
              valueClassName={netPosition >= 0 ? "text-sage-600 dark:text-sage-400" : "text-rust-600 dark:text-rust-400"}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <LedgerList
              title="Receivables"
              columnLabel="Customer"
              rows={receivables}
              loading={loadingCustomers}
              emptyMessage="No outstanding balances - everyone's settled up."
              onRowClick={openCustomerLookup}
              getSubtext={(customer) => customer.phoneNumber}
            />
            <LedgerList
              title="Payables"
              columnLabel="Supplier"
              rows={payables}
              loading={loadingSuppliers}
              emptyMessage="No outstanding dues - all suppliers are settled up."
              onRowClick={openSupplierLookup}
              getSubtext={(supplier) => supplier.phone}
            />
          </div>
        </>
      ) : (
        <>
          <div className="mb-6 flex-shrink-0 grid grid-cols-2 gap-px rounded-xl bg-warmgray-200 dark:bg-warmgray-700 overflow-hidden max-w-md">
            <StatTile
              label={isReceivables ? "Total Receivable" : "Total Payable"}
              value={`₹${formatINR(isReceivables ? totalReceivable : totalPayable)}`}
              loading={loading}
              valueClassName="text-rust-600 dark:text-rust-400"
            />
            <StatTile
              label={isReceivables ? "Customers Owing" : "Suppliers Owed"}
              value={isReceivables ? receivables.length : payables.length}
              loading={loading}
              skeletonWidth="w-12"
            />
          </div>

          {isReceivables ? (
            <LedgerList
              title="Receivables"
              columnLabel="Customer"
              rows={receivables}
              loading={loading}
              emptyMessage="No outstanding balances - everyone's settled up."
              onRowClick={openCustomerLookup}
              getSubtext={(customer) => customer.phoneNumber}
            />
          ) : (
            <LedgerList
              title="Payables"
              columnLabel="Supplier"
              rows={payables}
              loading={loading}
              emptyMessage="No outstanding dues - all suppliers are settled up."
              onRowClick={openSupplierLookup}
              getSubtext={(supplier) => supplier.phone}
            />
          )}
        </>
      )}

      <CustomerLookupModal
        key={`customer-${lookupCustomer?.id || "none"}`}
        isOpen={showCustomerLookup}
        initialCustomer={lookupCustomer}
        onClose={() => setShowCustomerLookup(false)}
      />

      <SupplierLookupModal
        key={`supplier-${lookupSupplier?.id || "none"}`}
        isOpen={showSupplierLookup}
        initialSupplier={lookupSupplier}
        onClose={() => setShowSupplierLookup(false)}
      />
    </main>
  );
}
