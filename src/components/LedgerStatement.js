"use client";

import { formatINR, roundRs, formatDateTime as formatDate } from "@/lib/format";

// The running-balance statement shared by every account-ledger lookup
// modal (customers = Tally Phase 1 receivables, suppliers = Phase 2
// payables) - same entries shape ({type: "debit"|"credit", amount, note,
// createdAt}), same print-to-PDF-via-browser approach (window.print()
// scoped to #<printElementId> through the print stylesheet below), so it's
// one component rather than a copy per account type.
export default function LedgerStatement({
  entries,
  loading,
  printElementId,
  accountName,
  accountSubtitle,
  debitLabel = "Debit",
  creditLabel = "Payment",
}) {
  // Pure prefix sum (via reduce, building a fresh array) rather than a
  // running total mutated across map iterations - see the dashboard pie
  // chart's identical fix for why that pattern trips this project's
  // react-hooks/immutability lint rule.
  const entriesWithRunningBalance = entries.reduce((acc, entry) => {
    const prevBalance = acc.length > 0 ? acc[acc.length - 1].runningBalance : 0;
    const runningBalance = roundRs(prevBalance + (entry.type === "debit" ? entry.amount : -entry.amount));
    acc.push({ ...entry, runningBalance });
    return acc;
  }, []);
  const closingBalance =
    entriesWithRunningBalance.length > 0 ? entriesWithRunningBalance[entriesWithRunningBalance.length - 1].runningBalance : 0;

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold uppercase text-warmgray-500 dark:text-warmgray-400">
          Account Statement {entries.length > 0 ? `(${entries.length})` : ""}
        </p>
        {entries.length > 0 && (
          <button
            onClick={() => window.print()}
            className="text-xs font-bold text-clay-600 dark:text-clay-400 hover:underline print:hidden"
          >
            Print Statement
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-warmgray-400 text-center py-6">Loading statement...</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-warmgray-400 text-center py-6 print:hidden">No ledger activity yet.</p>
      ) : (
        <div id={printElementId} className="space-y-1.5 mb-6">
          <div className="hidden print:block mb-3">
            <p className="font-bold text-black">{accountName} — Account Statement</p>
            {accountSubtitle && <p className="text-xs text-gray-600">{accountSubtitle}</p>}
          </div>
          {entriesWithRunningBalance.map((entry) => (
            <div
              key={entry.id}
              className="flex justify-between items-center px-3 py-2 rounded-lg border border-warmgray-100 dark:border-warmgray-800 text-xs"
            >
              <div className="min-w-0">
                <p className="font-semibold text-ink-900 dark:text-ink-50 truncate">
                  {entry.note || (entry.type === "debit" ? debitLabel : creditLabel)}
                </p>
                <p className="text-warmgray-400">{formatDate(entry.createdAt)}</p>
              </div>
              <div className="text-right flex-shrink-0 pl-2">
                <p
                  className={`font-bold ${
                    entry.type === "debit" ? "text-rust-600 dark:text-rust-400" : "text-sage-600 dark:text-sage-400"
                  }`}
                >
                  {entry.type === "debit" ? "+" : "−"}₹{formatINR(entry.amount)}
                </p>
                <p className="text-warmgray-400">Bal ₹{formatINR(entry.runningBalance)}</p>
              </div>
            </div>
          ))}
          <div className="flex justify-between items-center px-3 py-2.5 mt-2 border-t border-warmgray-200 dark:border-warmgray-700 font-bold text-sm">
            <span className="text-ink-900 dark:text-ink-50">Closing Balance</span>
            <span className={closingBalance >= 0 ? "text-rust-700 dark:text-rust-400" : "text-sage-700 dark:text-sage-400"}>
              ₹{formatINR(Math.abs(closingBalance))}
            </span>
          </div>
        </div>
      )}

      <style>{`
        @page {
          size: A4;
          margin: 16mm;
        }
        @media print {
          body * {
            visibility: hidden;
          }
          #${printElementId},
          #${printElementId} * {
            visibility: visible;
          }
          #${printElementId} {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
          }
        }
      `}</style>
    </>
  );
}
