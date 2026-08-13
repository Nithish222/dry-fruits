"use client";
import { useState, useEffect, useMemo, Fragment } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { formatINR, roundRs } from "@/lib/format";
import { seedChartOfAccounts, cancelVoucher, ACCOUNT_CATEGORIES } from "@/lib/accounting";
import { seedOpeningInventoryBalance } from "@/lib/inventoryOpeningBalance";
import { SYSTEM_LEDGER_NAMES } from "@/lib/systemAccounts";
import VoucherForm from "@/components/VoucherForm";
import AccountLedgerModal from "@/components/AccountLedgerModal";
import AddAccountModal from "@/components/AddAccountModal";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Skeleton from "@/components/ui/Skeleton";
import ToggleGroup from "@/components/ui/ToggleGroup";
import Modal from "@/components/ui/Modal";
import Input from "@/components/ui/Input";
import { Table, THead, Th, Tr, Td } from "@/components/ui/Table";
import { BookOpen, Ban } from "@/components/ui/icons";

const SKELETON_ROWS = 6;
const TAB_OPTIONS = [
  { value: "chart", label: "Chart of Accounts" },
  { value: "voucher", label: "New Voucher" },
  { value: "vouchers", label: "Vouchers" },
  { value: "trial", label: "Trial Balance" },
  { value: "pl", label: "P&L" },
];
const CATEGORY_LABELS = { asset: "Assets", liability: "Liabilities", equity: "Equity", income: "Income", expense: "Expenses" };
const PL_PERIOD_OPTIONS = [
  { value: "month", label: "This Month" },
  { value: "fy", label: "This Financial Year" },
  { value: "custom", label: "Custom" },
];

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Resolves the active P&L period into the set of "{year}-{month}" keys
// (unpadded, matching monthly_ledger_balances' numeric year/month fields)
// it covers - "This Month" is a single key, "This Financial Year" spans
// Apr-Mar same as voucher numbering's FY convention, "Custom" spans the
// two chosen <input type="month"> values inclusive.
function resolvedMonthKeys(period, customStart, customEnd) {
  let start;
  let end;
  if (period === "month") {
    start = end = currentMonthValue();
  } else if (period === "fy") {
    const now = new Date();
    const startYear = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
    start = `${startYear}-04`;
    end = `${startYear + 1}-03`;
  } else {
    start = customStart;
    end = customEnd;
  }
  if (!start || !end) return new Set();
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  const keys = new Set();
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    keys.add(`${y}-${m}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return keys;
}

// Builds a Group -> children[] tree from the flat accounts collection
// (parentGroupId pointers), then flattens it depth-first into rows with an
// explicit `depth` for indentation - same "fetch the whole collection,
// shape it in JS" approach tally/page.js already uses for customers/
// suppliers.
function buildAccountTree(accounts) {
  const byParent = new Map();
  for (const account of accounts) {
    const key = account.parentGroupId || "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(account);
  }
  const rows = [];
  function walk(parentKey, depth) {
    const children = (byParent.get(parentKey) || []).sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      rows.push({ ...child, depth });
      walk(child.id, depth + 1);
    }
  }
  walk("root", 0);
  return rows;
}

export default function AccountsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("chart");

  const [accounts, setAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState("");

  const [seedingInventory, setSeedingInventory] = useState(false);
  const [seedInventoryResult, setSeedInventoryResult] = useState(null);
  const [seedInventoryError, setSeedInventoryError] = useState("");

  const [vouchers, setVouchers] = useState([]);
  const [loadingVouchers, setLoadingVouchers] = useState(true);

  const [selectedAccount, setSelectedAccount] = useState(null);
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);

  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");

  const [plPeriod, setPlPeriod] = useState("month");
  const [plCustomStart, setPlCustomStart] = useState(currentMonthValue());
  const [plCustomEnd, setPlCustomEnd] = useState(currentMonthValue());
  const [monthlyBalances, setMonthlyBalances] = useState([]);
  const [loadingMonthlyBalances, setLoadingMonthlyBalances] = useState(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "accounts"),
      (snapshot) => {
        setAccounts(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        setLoadingAccounts(false);
      },
      (error) => {
        console.error("Error fetching accounts: ", error);
        setLoadingAccounts(false);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, "vouchers"), orderBy("createdAt", "desc")),
      (snapshot) => {
        setVouchers(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        setLoadingVouchers(false);
      },
      (error) => {
        console.error("Error fetching vouchers: ", error);
        setLoadingVouchers(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // Single-field `in` filter (no composite index needed) fetches every
  // income/expense rollup bucket ever written; the selected period is
  // applied client-side via resolvedMonthKeys. Bucket count scales with
  // (active income/expense accounts x months with activity), not with
  // voucher count, so this stays cheap even read in full - the same cost
  // property the rollup was built for, just with the date-range filter
  // applied after the fetch instead of in the query itself.
  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, "monthly_ledger_balances"), where("category", "in", ["income", "expense"])),
      (snapshot) => {
        setMonthlyBalances(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        setLoadingMonthlyBalances(false);
      },
      (error) => {
        console.error("Error fetching monthly ledger balances: ", error);
        setLoadingMonthlyBalances(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const accountRows = useMemo(() => buildAccountTree(accounts), [accounts]);
  const leafAccounts = useMemo(() => accounts.filter((a) => !a.isGroup && a.isActive !== false), [accounts]);

  // The button's own visibility condition IS the seed's guard condition -
  // once seeded, Inventory's balance is no longer 0 and the button
  // disappears on its own, no separate "already seeded" flag needed.
  const inventoryAccount = useMemo(
    () => accounts.find((a) => a.name === SYSTEM_LEDGER_NAMES.inventoryAsset),
    [accounts]
  );
  const showSeedInventoryButton = inventoryAccount && roundRs(inventoryAccount.currentBalance || 0) === 0;

  const trialBalanceRows = useMemo(() => {
    return ACCOUNT_CATEGORIES.map((category) => ({
      category,
      accounts: leafAccounts.filter((a) => a.category === category).sort((a, b) => a.name.localeCompare(b.name)),
    })).filter((group) => group.accounts.length > 0);
  }, [leafAccounts]);

  // currentBalance is always (debits - credits), universally, regardless of
  // an account's normalBalance - a positive balance is a net debit
  // position, a negative balance is a net credit position, full stop.
  // normalBalance says which side is "healthy" for that account, not which
  // side a given number's sign represents - conflating the two here was a
  // real bug (silently correct for every dr-normal account, silently wrong
  // for every cr-normal one) that stayed invisible until a cr-normal
  // account - Sales Account - first carried a real balance in Phase 6.
  const { totalDr, totalCr } = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const account of leafAccounts) {
      const balance = account.currentBalance || 0;
      if (balance >= 0) dr += balance;
      else cr += -balance;
    }
    return { totalDr: Math.round(dr * 100) / 100, totalCr: Math.round(cr * 100) / 100 };
  }, [leafAccounts]);
  const trialBalanced = totalDr === totalCr;

  const plMonthKeys = useMemo(() => resolvedMonthKeys(plPeriod, plCustomStart, plCustomEnd), [plPeriod, plCustomStart, plCustomEnd]);

  const plByAccount = useMemo(() => {
    const sums = new Map();
    for (const balance of monthlyBalances) {
      if (!plMonthKeys.has(`${balance.year}-${balance.month}`)) continue;
      sums.set(balance.accountId, roundRs((sums.get(balance.accountId) || 0) + (balance.netChange || 0)));
    }
    return sums;
  }, [monthlyBalances, plMonthKeys]);

  // Same normal-side sign logic as the Trial Balance's isDr computation:
  // netChange is stored as (debits - credits), so an income account
  // (credit-normal) shows real earnings as a negative netChange - flip it
  // here so "amount earned"/"amount spent" both read as positive numbers.
  const plRows = useMemo(() => {
    return leafAccounts
      .filter((account) => account.category === "income" || account.category === "expense")
      .map((account) => {
        const netChangeSum = plByAccount.get(account.id) || 0;
        const periodAmount = account.normalBalance === "dr" ? netChangeSum : -netChangeSum;
        return { ...account, periodAmount: roundRs(periodAmount) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [leafAccounts, plByAccount]);

  const { totalIncome, totalExpense, netProfit } = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const row of plRows) {
      if (row.category === "income") income += row.periodAmount;
      else expense += row.periodAmount;
    }
    income = roundRs(income);
    expense = roundRs(expense);
    return { totalIncome: income, totalExpense: expense, netProfit: roundRs(income - expense) };
  }, [plRows]);

  const openLedger = (account) => {
    setSelectedAccount(account);
    setShowLedgerModal(true);
  };

  const handleSeed = async () => {
    setSeeding(true);
    setSeedError("");
    try {
      await seedChartOfAccounts({ createdBy: { uid: user?.uid || null, email: user?.email || null } });
    } catch (error) {
      console.error("Failed to seed Chart of Accounts: ", error);
      setSeedError(error.message || "Failed to set up Chart of Accounts - try again.");
    } finally {
      setSeeding(false);
    }
  };

  const handleSeedOpeningInventory = async () => {
    setSeedingInventory(true);
    setSeedInventoryError("");
    setSeedInventoryResult(null);
    try {
      const result = await seedOpeningInventoryBalance({ createdBy: { uid: user?.uid || null, email: user?.email || null } });
      setSeedInventoryResult(result);
    } catch (error) {
      console.error("Failed to seed opening Inventory balance: ", error);
      setSeedInventoryError(error.message || "Failed to seed opening Inventory balance - try again.");
    } finally {
      setSeedingInventory(false);
    }
  };

  const handleCancelVoucher = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    setCancelError("");
    try {
      await cancelVoucher({
        voucherId: cancelTarget.id,
        cancelledBy: { uid: user?.uid || null, email: user?.email || null },
        reason: cancelReason.trim(),
      });
      setCancelTarget(null);
      setCancelReason("");
    } catch (error) {
      console.error("Failed to cancel voucher: ", error);
      setCancelError(error.message || "Failed to cancel voucher - try again.");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <main className="p-6 md:p-8 h-full flex flex-col w-full bg-cream-50 dark:bg-cream-950 min-h-screen transition-colors duration-300">
      <PageHeader
        title="Accounting"
        subtitle="Chart of Accounts, vouchers, Trial Balance, and P&L"
        className="flex-shrink-0"
        actions={<ToggleGroup options={TAB_OPTIONS} value={activeTab} onChange={setActiveTab} />}
      />

      {activeTab === "chart" && (
        <Card padding="p-0" className="overflow-hidden">
          <div className="px-6 py-4 border-b border-warmgray-100 dark:border-warmgray-700 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-warmgray-400" />
              <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50 tracking-wide uppercase">Chart of Accounts</h2>
            </div>
            {accountRows.length > 0 && (
              <div className="flex items-center gap-2">
                {showSeedInventoryButton && (
                  <Button variant="secondary" size="sm" onClick={handleSeedOpeningInventory} disabled={seedingInventory}>
                    {seedingInventory ? "Seeding..." : "Seed Opening Inventory Balance"}
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={() => setShowAddAccount(true)}>
                  + Add Account
                </Button>
              </div>
            )}
          </div>
          {(seedInventoryResult || seedInventoryError) && (
            <div className="px-6 py-3 border-b border-warmgray-100 dark:border-warmgray-700">
              {seedInventoryResult && (
                <p className="text-xs font-semibold text-sage-700 dark:text-sage-400">
                  Seeded ₹{formatINR(seedInventoryResult.total)} opening Inventory balance.
                  {seedInventoryResult.missingCostCount > 0
                    ? ` ${seedInventoryResult.missingCostCount} product${seedInventoryResult.missingCostCount === 1 ? "" : "s"} with stock had no cost price and were skipped.`
                    : ""}
                </p>
              )}
              {seedInventoryError && <p className="text-xs font-semibold text-rust-600 dark:text-rust-400">{seedInventoryError}</p>}
            </div>
          )}
          {loadingAccounts ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : accountRows.length === 0 ? (
            <div className="text-center py-16 px-6">
              <p className="text-sm text-warmgray-500 dark:text-warmgray-400 mb-4">No accounts yet.</p>
              <Button variant="primary" size="md" onClick={handleSeed} disabled={seeding}>
                {seeding ? "Setting up..." : "Set Up Chart of Accounts"}
              </Button>
              {seedError && <p className="text-xs font-semibold text-rust-600 dark:text-rust-400 mt-3">{seedError}</p>}
            </div>
          ) : (
            <Table variant="comfortable">
              <THead>
                <Th>Account</Th>
                <Th>Category</Th>
                <Th align="right">Balance</Th>
              </THead>
              <tbody>
                {accountRows.map((row) => (
                  <Tr
                    key={row.id}
                    onClick={row.isGroup ? undefined : () => openLedger(row)}
                    className={row.isGroup ? undefined : "cursor-pointer"}
                  >
                    <Td style={{ paddingLeft: `${1.5 + row.depth * 1.25}rem` }}>
                      <span className={row.isGroup ? "font-bold uppercase text-xs text-warmgray-500 dark:text-warmgray-400" : "font-medium text-ink-900 dark:text-ink-50"}>
                        {row.name}
                      </span>
                    </Td>
                    <Td className="capitalize text-xs text-warmgray-500 dark:text-warmgray-400">{!row.isGroup && CATEGORY_LABELS[row.category]}</Td>
                    <Td align="right" className={row.isGroup ? "" : "font-bold text-ink-900 dark:text-ink-50"}>
                      {!row.isGroup && `₹${formatINR(Math.abs(row.currentBalance || 0))}`}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {activeTab === "voucher" && (
        <Card padding="p-6">
          <VoucherForm onPosted={() => setActiveTab("vouchers")} />
        </Card>
      )}

      {activeTab === "vouchers" && (
        <Card padding="p-0" className="overflow-hidden">
          <Table variant="comfortable">
            <THead>
              <Th>Voucher No.</Th>
              <Th>Date</Th>
              <Th>Type</Th>
              <Th>Narration</Th>
              <Th align="right">Amount</Th>
              <Th>Status</Th>
              <Th />
            </THead>
            <tbody>
              {loadingVouchers ? (
                Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                  <Tr key={i}>
                    <Td colSpan="7">
                      <Skeleton className="h-4 w-full" />
                    </Td>
                  </Tr>
                ))
              ) : vouchers.length === 0 ? (
                <tr>
                  <td colSpan="7" className="text-center py-10 text-warmgray-500 dark:text-warmgray-400">
                    No vouchers posted yet.
                  </td>
                </tr>
              ) : (
                vouchers.map((voucher) => (
                  <Tr key={voucher.id}>
                    <Td className="font-mono text-xs font-bold">{voucher.voucherNumber}</Td>
                    <Td>{voucher.date}</Td>
                    <Td className="capitalize">{voucher.voucherType}</Td>
                    <Td className="max-w-xs truncate">{voucher.narration || "—"}</Td>
                    <Td align="right" className="font-bold">
                      ₹{formatINR(voucher.totalAmount)}
                    </Td>
                    <Td>
                      <Badge variant={voucher.status === "active" ? "success" : "neutral"} size="sm">
                        {voucher.status}
                      </Badge>
                    </Td>
                    <Td align="right">
                      {voucher.status === "active" && (
                        <button
                          onClick={() => setCancelTarget(voucher)}
                          aria-label="Cancel voucher"
                          className="inline-flex items-center gap-1 text-xs font-bold text-rust-600 dark:text-rust-400 hover:underline"
                        >
                          <Ban className="w-3.5 h-3.5" /> Cancel
                        </button>
                      )}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        </Card>
      )}

      {activeTab === "trial" && (
        <Card padding="p-0" className="overflow-hidden">
          <div className="px-6 py-4 border-b border-warmgray-100 dark:border-warmgray-700 flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50 tracking-wide uppercase">Trial Balance</h2>
            {!loadingAccounts && (
              <Badge variant={trialBalanced ? "success" : "warning"} size="sm">
                {trialBalanced ? "Balanced" : "Out of balance!"}
              </Badge>
            )}
          </div>
          {loadingAccounts ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : (
            <Table variant="comfortable">
              <THead>
                <Th>Account</Th>
                <Th align="right">Debit</Th>
                <Th align="right">Credit</Th>
              </THead>
              <tbody>
                {trialBalanceRows.map((group) => (
                  <Fragment key={group.category}>
                    <tr>
                      <td colSpan="3" className="px-6 py-2 text-xs font-bold uppercase text-warmgray-500 dark:text-warmgray-400 bg-warmgray-50 dark:bg-warmgray-800/50">
                        {CATEGORY_LABELS[group.category]}
                      </td>
                    </tr>
                    {group.accounts.map((account) => {
                      const balance = account.currentBalance || 0;
                      const isDr = balance >= 0;
                      const amount = Math.abs(balance);
                      return (
                        <Tr key={account.id} onClick={() => openLedger(account)} className="cursor-pointer">
                          <Td>{account.name}</Td>
                          <Td align="right">{isDr && amount > 0 ? `₹${formatINR(amount)}` : "—"}</Td>
                          <Td align="right">{!isDr && amount > 0 ? `₹${formatINR(amount)}` : "—"}</Td>
                        </Tr>
                      );
                    })}
                  </Fragment>
                ))}
                <tr className="font-bold border-t-2 border-warmgray-300 dark:border-warmgray-600">
                  <td className="px-6 py-3 text-ink-900 dark:text-ink-50">Total</td>
                  <td className="px-6 py-3 text-right text-ink-900 dark:text-ink-50">₹{formatINR(totalDr)}</td>
                  <td className="px-6 py-3 text-right text-ink-900 dark:text-ink-50">₹{formatINR(totalCr)}</td>
                </tr>
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {activeTab === "pl" && (
        <Card padding="p-0" className="overflow-hidden">
          <div className="px-6 py-4 border-b border-warmgray-100 dark:border-warmgray-700 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50 tracking-wide uppercase">Profit &amp; Loss</h2>
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup options={PL_PERIOD_OPTIONS} value={plPeriod} onChange={setPlPeriod} />
              {plPeriod === "custom" && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="month"
                    aria-label="Start month"
                    value={plCustomStart}
                    onChange={(e) => setPlCustomStart(e.target.value)}
                    className="text-xs font-semibold bg-warmgray-50 dark:bg-warmgray-800 border border-warmgray-200 dark:border-warmgray-700 rounded-md px-2 py-1.5 text-ink-900 dark:text-ink-50 focus:outline-none focus:ring-2 focus:ring-clay-400"
                  />
                  <span className="text-xs text-warmgray-400">to</span>
                  <input
                    type="month"
                    aria-label="End month"
                    value={plCustomEnd}
                    onChange={(e) => setPlCustomEnd(e.target.value)}
                    className="text-xs font-semibold bg-warmgray-50 dark:bg-warmgray-800 border border-warmgray-200 dark:border-warmgray-700 rounded-md px-2 py-1.5 text-ink-900 dark:text-ink-50 focus:outline-none focus:ring-2 focus:ring-clay-400"
                  />
                </div>
              )}
            </div>
          </div>
          {loadingAccounts || loadingMonthlyBalances ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : (
            <Table variant="comfortable">
              <THead>
                <Th>Account</Th>
                <Th align="right">Amount</Th>
              </THead>
              <tbody>
                <tr>
                  <td colSpan="2" className="px-6 py-2 text-xs font-bold uppercase text-warmgray-500 dark:text-warmgray-400 bg-warmgray-50 dark:bg-warmgray-800/50">
                    Income
                  </td>
                </tr>
                {plRows
                  .filter((row) => row.category === "income")
                  .map((row) => (
                    <Tr key={row.id} onClick={() => openLedger(row)} className="cursor-pointer">
                      <Td>{row.name}</Td>
                      <Td align="right">{row.periodAmount !== 0 ? `₹${formatINR(row.periodAmount)}` : "—"}</Td>
                    </Tr>
                  ))}
                <tr>
                  <td colSpan="2" className="px-6 py-2 text-xs font-bold uppercase text-warmgray-500 dark:text-warmgray-400 bg-warmgray-50 dark:bg-warmgray-800/50">
                    Expenses
                  </td>
                </tr>
                {plRows
                  .filter((row) => row.category === "expense")
                  .map((row) => (
                    <Tr key={row.id} onClick={() => openLedger(row)} className="cursor-pointer">
                      <Td>{row.name}</Td>
                      <Td align="right">{row.periodAmount !== 0 ? `₹${formatINR(row.periodAmount)}` : "—"}</Td>
                    </Tr>
                  ))}
                <tr className="border-t border-warmgray-200 dark:border-warmgray-700">
                  <td className="px-6 py-2.5 text-xs font-semibold text-warmgray-500 dark:text-warmgray-400">Total Income</td>
                  <td className="px-6 py-2.5 text-right text-xs font-semibold text-warmgray-500 dark:text-warmgray-400">₹{formatINR(totalIncome)}</td>
                </tr>
                <tr>
                  <td className="px-6 py-2.5 text-xs font-semibold text-warmgray-500 dark:text-warmgray-400">Total Expenses</td>
                  <td className="px-6 py-2.5 text-right text-xs font-semibold text-warmgray-500 dark:text-warmgray-400">₹{formatINR(totalExpense)}</td>
                </tr>
                <tr className="font-bold border-t-2 border-warmgray-300 dark:border-warmgray-600">
                  <td className="px-6 py-3 text-ink-900 dark:text-ink-50">Net Profit</td>
                  <td className={`px-6 py-3 text-right ${netProfit >= 0 ? "text-sage-700 dark:text-sage-400" : "text-rust-700 dark:text-rust-400"}`}>
                    {netProfit < 0 ? "−" : ""}₹{formatINR(Math.abs(netProfit))}
                  </td>
                </tr>
              </tbody>
            </Table>
          )}
        </Card>
      )}

      <AccountLedgerModal isOpen={showLedgerModal} account={selectedAccount} onClose={() => setShowLedgerModal(false)} />

      <AddAccountModal
        isOpen={showAddAccount}
        onClose={() => setShowAddAccount(false)}
        accounts={accounts}
        createdBy={{ uid: user?.uid || null, email: user?.email || null }}
      />

      <Modal
        isOpen={!!cancelTarget}
        onClose={() => {
          if (cancelling) return;
          setCancelTarget(null);
          setCancelReason("");
          setCancelError("");
        }}
        title="Cancel Voucher"
        panelClassName="max-w-sm"
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="md"
              className="flex-1"
              disabled={cancelling}
              onClick={() => {
                setCancelTarget(null);
                setCancelReason("");
                setCancelError("");
              }}
            >
              Back
            </Button>
            <Button variant="danger" size="md" className="flex-1" disabled={cancelling} onClick={handleCancelVoucher}>
              {cancelling ? "Cancelling..." : "Cancel Voucher"}
            </Button>
          </div>
        }
      >
        <div className="p-5 space-y-3">
          <p className="text-sm text-warmgray-600 dark:text-warmgray-300">
            This posts a reversing voucher against <span className="font-bold">{cancelTarget?.voucherNumber}</span>. The original stays on
            record, marked cancelled.
          </p>
          <Input
            label="Reason (optional)"
            size="sm"
            className="w-full"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          {cancelError && <p className="text-xs font-semibold text-rust-600 dark:text-rust-400">{cancelError}</p>}
        </div>
      </Modal>
    </main>
  );
}
