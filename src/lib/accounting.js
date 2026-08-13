import { collection, doc, getDoc, getDocs, limit, query, runTransaction, serverTimestamp, setDoc, where, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { roundRs } from "@/lib/format";

// Tally Phase 4 - core double-entry engine. Generalizes lib/ledger.js's
// pattern (read-then-compute-then-write inside one runTransaction, roundRs
// everywhere) from "1 signed delta against 1 account" to "N balanced lines
// against N accounts + a voucher-number counter + the voucher doc itself".
// Deliberately layered underneath the existing Khata system (customers/
// suppliers/entries, POS checkout, returns) - nothing here touches those
// collections or code paths.

// Tally Phase 6 - "sales"/"purchase" added alongside the original 4
// Tally-standard types so POS checkout and supplier purchases can post
// under their own correct semantic voucher type, instead of overloading
// receipt/payment.
export const VOUCHER_TYPES = ["receipt", "payment", "journal", "contra", "sales", "purchase"];
const VOUCHER_PREFIX = { receipt: "RCPT", payment: "PMT", journal: "JRNL", contra: "CTRA", sales: "SALE", purchase: "PUR" };
export const ACCOUNT_CATEGORIES = ["asset", "liability", "equity", "income", "expense"];

// Apr-Mar financial year, matching how Indian bookkeeping (and Tally itself)
// scopes voucher numbering - a fresh sequence per type per FY rather than one
// global counter.
export function getFinancialYearLabel(dateStr) {
  const [year, month] = dateStr.split("-").map(Number);
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

// Exported (Phase 6) so callers with their own runTransaction (POS
// checkout, Khata actions, returns - see src/lib/khataVouchers.js) can
// reuse this exact validation instead of duplicating it.
export function validateLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new Error("A voucher needs at least 2 lines.");
  }
  let sumDr = 0;
  let sumCr = 0;
  for (const line of lines) {
    if (!line.accountId) throw new Error("Every line needs an account.");
    if (line.type !== "dr" && line.type !== "cr") throw new Error("Every line's type must be dr or cr.");
    // Denormalized onto every line (Phase 5) so the monthly P&L rollup
    // Cloud Function can bucket by category with zero extra reads - the
    // frontend already has the account's category loaded for its picker,
    // so this costs nothing to attach at write time.
    if (!ACCOUNT_CATEGORIES.includes(line.category)) throw new Error("Every line needs a valid account category.");
    const amount = roundRs(line.amount);
    if (!(amount > 0)) throw new Error("Every line's amount must be greater than 0.");
    if (line.type === "dr") sumDr = roundRs(sumDr + amount);
    else sumCr = roundRs(sumCr + amount);
  }
  if (sumDr !== sumCr) {
    throw new Error(`Voucher is not balanced: Dr ₹${sumDr} vs Cr ₹${sumCr}.`);
  }
  return sumDr;
}

// Nets a voucher's lines into a per-account signed delta (dr = +, cr = -) so
// an account hit by two lines on the same voucher is only balance-updated
// once, while still writing one ledger entry per original line so the folio
// reads exactly as entered.
export function netDeltasByAccount(lines) {
  const deltas = new Map();
  for (const line of lines) {
    const amount = roundRs(line.amount);
    const delta = line.type === "dr" ? amount : -amount;
    deltas.set(line.accountId, roundRs((deltas.get(line.accountId) || 0) + delta));
  }
  return deltas;
}

// Shared by postVoucher and cancelVoucher: given already-read account docs
// (Map<accountId, {ref, data}>) and a voucher's lines, computes new balances
// and stages the writes (account balance + one entries doc per line) on an
// open transaction. All reads must already be done - this only calls
// transaction.set.
export function applyLinesWithinTransaction(transaction, { lines, accountDocsById, voucherId, voucherType, voucherNumber, narration }) {
  const deltas = netDeltasByAccount(lines);
  for (const [accountId, delta] of deltas) {
    const { ref, data } = accountDocsById.get(accountId);
    const newBalance = roundRs((data.currentBalance || 0) + delta);
    transaction.set(ref, { currentBalance: newBalance }, { merge: true });
  }
  for (const line of lines) {
    const { ref } = accountDocsById.get(line.accountId);
    const entryRef = doc(collection(ref, "entries"));
    transaction.set(entryRef, {
      type: line.type === "dr" ? "debit" : "credit",
      amount: roundRs(line.amount),
      note: narration || voucherNumber,
      voucherId,
      voucherType,
      voucherNumber,
      createdAt: serverTimestamp(),
    });
  }
}

export async function readAccountDocsById(transaction, accountIds) {
  const accountDocsById = new Map();
  for (const accountId of accountIds) {
    const ref = doc(db, "accounts", accountId);
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error(`Account ${accountId} does not exist.`);
    const data = snap.data();
    if (data.isGroup) throw new Error(`"${data.name}" is a group, not a postable ledger.`);
    if (data.isActive === false) throw new Error(`"${data.name}" is inactive.`);
    accountDocsById.set(accountId, { ref, data });
  }
  return accountDocsById;
}

export async function readAndBumpCounter(transaction, voucherType, financialYear) {
  const counterRef = doc(db, "counters", `${voucherType}_${financialYear}`);
  const counterSnap = await transaction.get(counterRef);
  const nextSeq = (counterSnap.exists() ? counterSnap.data().seq || 0 : 0) + 1;
  const voucherNumber = `${VOUCHER_PREFIX[voucherType]}/${financialYear}/${String(nextSeq).padStart(4, "0")}`;
  return { counterRef, nextSeq, voucherNumber };
}

// Read-phase half of a voucher post (Phase 6): validates debit === credit
// in plain JS before any Firestore round-trip, then does every read a
// voucher post needs (every unique account doc + the counter doc). Exists
// separately from writeVoucherPost so a caller with its OWN runTransaction
// (POS checkout, Khata actions, returns - see src/lib/khataVouchers.js) can
// interleave these reads with its own reads, then do every write
// (its own + writeVoucherPost) afterward - preserving Firestore's "every
// read before any write in one transaction" rule across both concerns.
export async function readVoucherPostContext(transaction, { lines, voucherType, date }) {
  if (!VOUCHER_TYPES.includes(voucherType)) throw new Error("Invalid voucher type.");
  if (!date) throw new Error("Voucher date is required.");
  const totalAmount = validateLines(lines);
  const financialYear = getFinancialYearLabel(date);
  const uniqueAccountIds = [...new Set(lines.map((line) => line.accountId))];
  const accountDocsById = await readAccountDocsById(transaction, uniqueAccountIds);
  const counterInfo = await readAndBumpCounter(transaction, voucherType, financialYear);
  return { totalAmount, financialYear, accountDocsById, counterInfo };
}

// Write-phase half - call only once every read (this context's AND the
// caller's own) is done. Stages the counter bump, per-account
// balance/entries writes, and the voucher doc itself. Only ever `set()`s a
// brand-new voucher doc - see cancelVoucher for the one place this module
// ever updates an existing one.
export function writeVoucherPost(transaction, { lines, voucherType, date, narration, createdBy, context }) {
  const { totalAmount, financialYear, accountDocsById, counterInfo } = context;
  const voucherRef = doc(collection(db, "vouchers"));

  transaction.set(counterInfo.counterRef, { seq: counterInfo.nextSeq, updatedAt: serverTimestamp() }, { merge: true });
  applyLinesWithinTransaction(transaction, {
    lines,
    accountDocsById,
    voucherId: voucherRef.id,
    voucherType,
    voucherNumber: counterInfo.voucherNumber,
    narration,
  });
  transaction.set(voucherRef, {
    voucherType,
    voucherNumber: counterInfo.voucherNumber,
    financialYear,
    date,
    narration: narration || "",
    lines,
    totalAmount,
    status: "active",
    cancelledAt: null,
    cancelledBy: null,
    reversalVoucherId: null,
    reversesVoucherId: null,
    createdBy,
    createdAt: serverTimestamp(),
  });

  return { voucherId: voucherRef.id, voucherNumber: counterInfo.voucherNumber };
}

// Posts a new voucher standalone (used by VoucherForm.js) - a thin wrapper
// around the read/write pair above, identical external behavior to before
// the Phase 6 split.
export async function postVoucher({ voucherType, date, narration, lines, createdBy }) {
  let result;
  await runTransaction(db, async (transaction) => {
    const context = await readVoucherPostContext(transaction, { lines, voucherType, date });
    result = writeVoucherPost(transaction, { lines, voucherType, date, narration, createdBy, context });
  });
  return result;
}

// Cancels a voucher by posting a brand-new reversing voucher (flipped dr/cr
// on the same accounts) rather than deleting or editing the original -
// both remain permanently visible, which is the actual substance of an
// audit trail. The only update() this module ever issues against an
// existing voucher doc is the narrow {status, cancelledAt, cancelledBy,
// reversalVoucherId} write at the end of this function.
export async function cancelVoucher({ voucherId, cancelledBy, reason }) {
  const voucherRef = doc(db, "vouchers", voucherId);
  const todayStr = new Date().toISOString().slice(0, 10);

  let reversalVoucherNumber;
  await runTransaction(db, async (transaction) => {
    const voucherSnap = await transaction.get(voucherRef);
    if (!voucherSnap.exists()) throw new Error("Voucher not found.");
    const original = voucherSnap.data();
    if (original.status !== "active") throw new Error("Voucher is already cancelled.");

    const reversedLines = original.lines.map((line) => ({ ...line, type: line.type === "dr" ? "cr" : "dr" }));
    const uniqueAccountIds = [...new Set(reversedLines.map((line) => line.accountId))];
    const accountDocsById = await readAccountDocsById(transaction, uniqueAccountIds);
    const financialYear = getFinancialYearLabel(todayStr);
    const counterInfo = await readAndBumpCounter(transaction, original.voucherType, financialYear);
    reversalVoucherNumber = counterInfo.voucherNumber;

    const reversalRef = doc(collection(db, "vouchers"));
    const narration = `Cancellation of ${original.voucherNumber}${reason ? `: ${reason}` : ""}`;

    transaction.set(counterInfo.counterRef, { seq: counterInfo.nextSeq, updatedAt: serverTimestamp() }, { merge: true });
    applyLinesWithinTransaction(transaction, {
      lines: reversedLines,
      accountDocsById,
      voucherId: reversalRef.id,
      voucherType: original.voucherType,
      voucherNumber: reversalVoucherNumber,
      narration,
    });
    transaction.set(reversalRef, {
      voucherType: original.voucherType,
      voucherNumber: reversalVoucherNumber,
      financialYear,
      date: todayStr,
      narration,
      lines: reversedLines,
      totalAmount: original.totalAmount,
      status: "active",
      cancelledAt: null,
      cancelledBy: null,
      reversalVoucherId: null,
      reversesVoucherId: voucherId,
      createdBy: cancelledBy,
      createdAt: serverTimestamp(),
    });
    transaction.update(voucherRef, {
      status: "cancelled",
      cancelledAt: serverTimestamp(),
      cancelledBy,
      reversalVoucherId: reversalRef.id,
    });
  });

  return { reversalVoucherNumber };
}

// key = a local id used only to wire up parent/child relationships before
// real Firestore doc IDs exist; never written to Firestore itself.
const DEFAULT_CHART_OF_ACCOUNTS = [
  { key: "capital", name: "Capital Account", isGroup: true, category: "equity", normalBalance: "cr", parent: null },
  { key: "owners_capital", name: "Owner's Capital", isGroup: false, category: "equity", normalBalance: "cr", parent: "capital" },

  { key: "curr_liab", name: "Current Liabilities", isGroup: true, category: "liability", normalBalance: "cr", parent: null },
  { key: "creditors", name: "Sundry Creditors", isGroup: true, category: "liability", normalBalance: "cr", parent: "curr_liab", isSystemAccount: true },
  { key: "duties_taxes", name: "Duties & Taxes", isGroup: true, category: "liability", normalBalance: "cr", parent: "curr_liab" },

  { key: "curr_assets", name: "Current Assets", isGroup: true, category: "asset", normalBalance: "dr", parent: null },
  { key: "cash_group", name: "Cash-in-Hand", isGroup: true, category: "asset", normalBalance: "dr", parent: "curr_assets" },
  { key: "cash", name: "Cash", isGroup: false, category: "asset", normalBalance: "dr", parent: "cash_group", isSystemAccount: true },
  { key: "bank_group", name: "Bank Accounts", isGroup: true, category: "asset", normalBalance: "dr", parent: "curr_assets" },
  { key: "bank", name: "Bank Account", isGroup: false, category: "asset", normalBalance: "dr", parent: "bank_group" },
  { key: "debtors", name: "Sundry Debtors", isGroup: true, category: "asset", normalBalance: "dr", parent: "curr_assets", isSystemAccount: true },

  { key: "fixed_assets", name: "Fixed Assets", isGroup: true, category: "asset", normalBalance: "dr", parent: null },

  { key: "sales_group", name: "Sales Accounts", isGroup: true, category: "income", normalBalance: "cr", parent: null },
  { key: "sales", name: "Sales Account", isGroup: false, category: "income", normalBalance: "cr", parent: "sales_group" },

  { key: "purchase_group", name: "Purchase Accounts", isGroup: true, category: "expense", normalBalance: "dr", parent: null },
  { key: "purchase", name: "Purchase Account", isGroup: false, category: "expense", normalBalance: "dr", parent: "purchase_group" },

  { key: "direct_exp", name: "Direct Expenses", isGroup: true, category: "expense", normalBalance: "dr", parent: null },
  { key: "carriage_inward", name: "Carriage Inward", isGroup: false, category: "expense", normalBalance: "dr", parent: "direct_exp" },

  { key: "indirect_exp", name: "Indirect Expenses", isGroup: true, category: "expense", normalBalance: "dr", parent: null },
  { key: "rent", name: "Rent", isGroup: false, category: "expense", normalBalance: "dr", parent: "indirect_exp" },
  { key: "salaries", name: "Salaries", isGroup: false, category: "expense", normalBalance: "dr", parent: "indirect_exp" },
  { key: "electricity", name: "Electricity Expenses", isGroup: false, category: "expense", normalBalance: "dr", parent: "indirect_exp" },
  { key: "stationery", name: "Printing & Stationery", isGroup: false, category: "expense", normalBalance: "dr", parent: "indirect_exp" },
  { key: "misc_exp", name: "Miscellaneous Expenses", isGroup: false, category: "expense", normalBalance: "dr", parent: "indirect_exp" },

  { key: "indirect_inc", name: "Indirect Income", isGroup: true, category: "income", normalBalance: "cr", parent: null },
  { key: "discount_recd", name: "Discount Received", isGroup: false, category: "income", normalBalance: "cr", parent: "indirect_inc" },
];

// One-time bootstrap, triggered from the Chart of Accounts tab's empty
// state - not a seed.py-style admin script, since this milestone stays
// entirely inside the client-SDK code path (no serviceAccountKey.json
// dependency). No-ops if any account already exists so it can't be run
// twice by accident.
export async function seedChartOfAccounts({ createdBy }) {
  const existing = await getDocs(query(collection(db, "accounts"), limit(1)));
  if (!existing.empty) throw new Error("Chart of Accounts already exists.");

  const today = new Date().toISOString().slice(0, 10);
  const batch = writeBatch(db);
  const idByKey = new Map();

  for (const entry of DEFAULT_CHART_OF_ACCOUNTS) {
    const ref = doc(collection(db, "accounts"));
    idByKey.set(entry.key, ref.id);
    batch.set(ref, {
      name: entry.name,
      isGroup: entry.isGroup,
      parentGroupId: entry.parent ? idByKey.get(entry.parent) : null,
      category: entry.category,
      normalBalance: entry.normalBalance,
      openingBalance: 0,
      openingBalanceDate: today,
      currentBalance: 0,
      isSystemAccount: !!entry.isSystemAccount,
      isActive: true,
      createdAt: serverTimestamp(),
      createdBy,
    });
  }

  await batch.commit();
}

// Adds one new leaf ledger to an already-seeded Chart of Accounts (Phase 6
// - e.g. the control accounts checkout/Khata wiring needs). Unlike
// seedChartOfAccounts this is a single-doc write with no reseed guard,
// since it's meant to be called repeatedly, one account at a time, from
// the Chart of Accounts tab's "+ Add Account" button.
export async function addAccount({ name, parentGroupId, category, normalBalance, isSystemAccount = false, createdBy }) {
  const trimmedName = (name || "").trim();
  if (!trimmedName) throw new Error("Account name is required.");
  if (!parentGroupId) throw new Error("Parent group is required.");
  if (!ACCOUNT_CATEGORIES.includes(category)) throw new Error("Invalid account category.");
  if (normalBalance !== "dr" && normalBalance !== "cr") throw new Error("Normal balance must be dr or cr.");

  const parentSnap = await getDoc(doc(db, "accounts", parentGroupId));
  if (!parentSnap.exists()) throw new Error("Parent group not found.");
  if (!parentSnap.data().isGroup) throw new Error(`"${parentSnap.data().name}" is not a group.`);

  // Not transactional (mirrors seedChartOfAccounts' plain getDocs guard
  // above) - a soft duplicate-name check, since src/lib/systemAccounts.js
  // resolves well-known ledgers strictly by exact name.
  const dupes = await getDocs(query(collection(db, "accounts"), where("name", "==", trimmedName)));
  if (!dupes.empty) throw new Error(`An account named "${trimmedName}" already exists.`);

  const today = new Date().toISOString().slice(0, 10);
  const ref = doc(collection(db, "accounts"));
  await setDoc(ref, {
    name: trimmedName,
    isGroup: false,
    parentGroupId,
    category,
    normalBalance,
    openingBalance: 0,
    openingBalanceDate: today,
    currentBalance: 0,
    isSystemAccount: !!isSystemAccount,
    isActive: true,
    createdAt: serverTimestamp(),
    createdBy,
  });
  return { accountId: ref.id };
}
