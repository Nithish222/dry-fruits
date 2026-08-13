"use client";
import { useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import ToggleGroup from "@/components/ui/ToggleGroup";
import ReceiveStockForm from "@/components/ReceiveStockForm";
import ReturnToSupplierForm from "@/components/ReturnToSupplierForm";

const TAB_OPTIONS = [
  { value: "receive", label: "Receive Stock" },
  { value: "return", label: "Return to Supplier" },
];

export default function PurchasesPage() {
  const [activeTab, setActiveTab] = useState("receive");
  const isReceive = activeTab === "receive";

  return (
    <main className="p-6 md:p-8 h-full flex flex-col w-full bg-cream-50 dark:bg-cream-950 min-h-screen transition-colors duration-300">
      <PageHeader
        title="Purchases"
        subtitle={isReceive ? "Record an itemized supplier delivery" : "Send stock back to a supplier"}
        className="flex-shrink-0"
        actions={<ToggleGroup options={TAB_OPTIONS} value={activeTab} onChange={setActiveTab} />}
      />
      <Card padding="p-0" className="max-w-3xl">
        {isReceive ? <ReceiveStockForm /> : <ReturnToSupplierForm />}
      </Card>
    </main>
  );
}
