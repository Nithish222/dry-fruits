import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatINR, roundRs } from "@/lib/format";
import { readVoucherPostContext, writeVoucherPost } from "@/lib/accounting";
import { getSystemAccounts } from "@/lib/systemAccounts";

// Tally Phase 6 - wires the Khata system (customers/suppliers running
// balances) to the double-entry engine. Every function here does one
// Khata-style balance update (matching lib/ledger.js's addLedgerEntry
// exactly, byte-for-byte, so LedgerStatement.js/CustomerLookupModal.js/
// SupplierLookupModal.js need no changes to how they read entries) AND
// posts one matching voucher, atomically in a single runTransaction.

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Pure - the sale/return COGS line-pair is symmetric, just dr/cr flipped: a
// sale moves cost OUT of Inventory INTO COGS (dr COGS / cr Inventory); a
// return reverses that (dr Inventory / cr COGS), since the physical goods
// are back on the shelf. Returns [] rather than a zero-amount pair when
// amount rounds to 0 - validateLines() rejects zero-amount lines, so an
// all-missing-cost-price sale/return simply omits the pair instead of
// posting one.
function buildCogsLinePair({ amount, reversal = false, systemAccounts }) {
  const { cogsExpense, inventoryAsset } = systemAccounts;
  const rounded = roundRs(amount);
  if (!(rounded > 0)) return [];
  const cogsType = reversal ? "cr" : "dr";
  const inventoryType = reversal ? "dr" : "cr";
  return [
    { accountId: cogsExpense.id, type: cogsType, amount: rounded, category: cogsExpense.category },
    { accountId: inventoryAsset.id, type: inventoryType, amount: rounded, category: inventoryAsset.category },
  ];
}

// Pure - builds a POS sale's Sales-voucher lines from the same payment
// payload commitTransactionToFirestore already validates (src/app/page.js).
// "Received now" in credit mode has no cash/gpay sub-method field in the
// schema - treated as cash by convention (documented assumption; a future
// enhancement could let the cashier specify). cogsAmount (missing-cost-price
// items already excluded by the caller, same convention as computeProfit()
// in lib/format.js) adds the Inventory->COGS recognition lines onto the
// same voucher as the revenue-side lines, rather than posting a second one.
export function buildSalesVoucherLines({ payment, grandTotal, cogsAmount, systemAccounts }) {
  const { cash, gpayClearing, salesRevenue, customerReceivables } = systemAccounts;
  const total = roundRs(grandTotal);
  const lines = [];

  if (payment.mode === "cash") {
    lines.push({ accountId: cash.id, type: "dr", amount: total, category: cash.category });
  } else if (payment.mode === "gpay") {
    lines.push({ accountId: gpayClearing.id, type: "dr", amount: total, category: gpayClearing.category });
  } else if (payment.mode === "credit") {
    const receivedNow = roundRs(payment.amountReceived || 0);
    if (receivedNow > 0) lines.push({ accountId: cash.id, type: "dr", amount: receivedNow, category: cash.category });
    const credit = roundRs(payment.creditAmount || 0);
    if (credit > 0) lines.push({ accountId: customerReceivables.id, type: "dr", amount: credit, category: customerReceivables.category });
  } else {
    throw new Error(`Unknown payment mode: ${payment.mode}`);
  }

  lines.push({ accountId: salesRevenue.id, type: "cr", amount: total, category: salesRevenue.category });
  lines.push(...buildCogsLinePair({ amount: cogsAmount, reversal: false, systemAccounts }));
  return lines;
}

// Pure - builds a return's reversing-journal lines. See
// commitReturnToFirestore (src/app/transactions/page.js) for how
// creditReduction/cashOrGpayRefund are computed (credit-first refund split
// against the original sale's credit component). cogsReversalAmount mirrors
// cogsAmount above, computed from the returned items' costPriceAtSale.
export function buildReturnVoucherLines({ refundAmount, creditReduction, cashOrGpayRefund, originalPaymentMode, cogsReversalAmount, systemAccounts }) {
  const { cash, gpayClearing, salesRevenue, customerReceivables } = systemAccounts;
  const lines = [{ accountId: salesRevenue.id, type: "dr", amount: roundRs(refundAmount), category: salesRevenue.category }];

  if (creditReduction > 0) {
    lines.push({ accountId: customerReceivables.id, type: "cr", amount: roundRs(creditReduction), category: customerReceivables.category });
  }
  if (cashOrGpayRefund > 0) {
    // "credit" mode's non-credit portion was received as cash by the same
    // convention buildSalesVoucherLines uses above - never gpay.
    const cashSide = originalPaymentMode === "gpay" ? gpayClearing : cash;
    lines.push({ accountId: cashSide.id, type: "cr", amount: roundRs(cashOrGpayRefund), category: cashSide.category });
  }
  lines.push(...buildCogsLinePair({ amount: cogsReversalAmount, reversal: true, systemAccounts }));
  return lines;
}

// Shared by every "simple Khata action + voucher" function below. Reads
// the Khata account doc, computes its new balance exactly like
// lib/ledger.js's addLedgerEntry, then (still in the reads phase) resolves
// the voucher's account/counter docs via readVoucherPostContext - only
// once BOTH read sets are done does it write: Khata balance + Khata
// entries doc + the voucher itself via writeVoucherPost.
async function postKhataActionWithVoucher({
  khataCollection,
  khataAccountId,
  khataEntryType,
  amount,
  note,
  createdBy,
  voucherType,
  voucherDate,
  buildVoucherLines,
  validateBalance,
}) {
  const khataRef = doc(db, khataCollection, khataAccountId);
  const khataEntryRef = doc(collection(db, khataCollection, khataAccountId, "entries"));
  const roundedAmount = roundRs(amount);
  let newBalance = 0;
  let voucherResult;

  await runTransaction(db, async (transaction) => {
    const khataDoc = await transaction.get(khataRef);
    if (!khataDoc.exists()) throw new Error("Account not found.");
    const currentBalance = khataDoc.data().balance || 0;
    if (validateBalance) validateBalance(currentBalance);
    const delta = khataEntryType === "debit" ? roundedAmount : -roundedAmount;
    newBalance = roundRs(currentBalance + delta);

    const lines = buildVoucherLines(roundedAmount);
    const context = await readVoucherPostContext(transaction, { lines, voucherType, date: voucherDate });

    transaction.set(khataRef, { balance: newBalance }, { merge: true });
    transaction.set(khataEntryRef, { type: khataEntryType, amount: roundedAmount, note, createdAt: serverTimestamp() });
    voucherResult = writeVoucherPost(transaction, { lines, voucherType, date: voucherDate, narration: note, createdBy, context });
  });

  return { newBalance, ...voucherResult };
}

export async function recordCustomerPaymentWithVoucher({ customerId, amount, note, createdBy, date = todayStr() }) {
  const { cash, customerReceivables } = await getSystemAccounts();
  return postKhataActionWithVoucher({
    khataCollection: "customers",
    khataAccountId: customerId,
    khataEntryType: "credit",
    amount,
    note,
    createdBy,
    voucherType: "receipt",
    voucherDate: date,
    buildVoucherLines: (amt) => [
      { accountId: cash.id, type: "dr", amount: amt, category: cash.category },
      { accountId: customerReceivables.id, type: "cr", amount: amt, category: customerReceivables.category },
    ],
  });
}

export async function recordCustomerOpeningBalanceWithVoucher({ customerId, amount, note, createdBy, date = todayStr() }) {
  const { customerReceivables, openingBalanceEquity } = await getSystemAccounts();
  return postKhataActionWithVoucher({
    khataCollection: "customers",
    khataAccountId: customerId,
    khataEntryType: "debit",
    amount,
    note,
    createdBy,
    voucherType: "journal",
    voucherDate: date,
    buildVoucherLines: (amt) => [
      { accountId: customerReceivables.id, type: "dr", amount: amt, category: customerReceivables.category },
      { accountId: openingBalanceEquity.id, type: "cr", amount: amt, category: openingBalanceEquity.category },
    ],
  });
}

// Amount-only, no item/product breakdown - still capitalizes into
// Inventory like receiveStockWithVoucher, since Inventory is one aggregate
// GL balance in this system, not tracked per-SKU. A lump amount with no
// item detail posts just as validly as an itemized receipt.
export async function recordSupplierPurchaseWithVoucher({ supplierId, amount, note, createdBy, date = todayStr() }) {
  const { inventoryAsset, supplierPayables } = await getSystemAccounts();
  return postKhataActionWithVoucher({
    khataCollection: "suppliers",
    khataAccountId: supplierId,
    khataEntryType: "debit",
    amount,
    note,
    createdBy,
    voucherType: "purchase",
    voucherDate: date,
    buildVoucherLines: (amt) => [
      { accountId: inventoryAsset.id, type: "dr", amount: amt, category: inventoryAsset.category },
      { accountId: supplierPayables.id, type: "cr", amount: amt, category: supplierPayables.category },
    ],
  });
}

export async function recordSupplierPaymentWithVoucher({ supplierId, amount, paymentMode, note, createdBy, date = todayStr() }) {
  const { supplierPayables, cash, gpayClearing } = await getSystemAccounts();
  const assetAccount = paymentMode === "gpay" ? gpayClearing : paymentMode === "cash" ? cash : null;
  if (!assetAccount) throw new Error(`Unknown payment mode: ${paymentMode}`);
  const roundedAmount = roundRs(amount);
  return postKhataActionWithVoucher({
    khataCollection: "suppliers",
    khataAccountId: supplierId,
    khataEntryType: "credit",
    amount,
    note,
    createdBy,
    voucherType: "payment",
    voucherDate: date,
    // Defense-in-depth against a manual-entry typo overpaying past what's
    // owed - the UI blocks this too (SupplierLookupModal.js), matching the
    // exact "Amount paid cannot exceed the grand total" guard already used
    // in ReceiveStockForm.js for the same class of mistake. Unlike a
    // supplier return (which can legitimately push the balance negative -
    // physical goods drove that), a typed payment amount has no natural
    // ceiling of its own, so it needs an explicit one.
    validateBalance: (currentBalance) => {
      if (roundedAmount > currentBalance) {
        throw new Error(`Cannot pay ₹${formatINR(roundedAmount)} - you only owe ₹${formatINR(currentBalance)}.`);
      }
    },
    buildVoucherLines: (amt) => [
      { accountId: supplierPayables.id, type: "dr", amount: amt, category: supplierPayables.category },
      { accountId: assetAccount.id, type: "cr", amount: amt, category: assetAccount.category },
    ],
  });
}

export async function recordSupplierOpeningBalanceWithVoucher({ supplierId, amount, note, createdBy, date = todayStr() }) {
  const { openingBalanceEquity, supplierPayables } = await getSystemAccounts();
  return postKhataActionWithVoucher({
    khataCollection: "suppliers",
    khataAccountId: supplierId,
    khataEntryType: "debit",
    amount,
    note,
    createdBy,
    voucherType: "journal",
    voucherDate: date,
    buildVoucherLines: (amt) => [
      { accountId: openingBalanceEquity.id, type: "dr", amount: amt, category: openingBalanceEquity.category },
      { accountId: supplierPayables.id, type: "cr", amount: amt, category: supplierPayables.category },
    ],
  });
}
