import { collection, doc, increment, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { roundKg, roundRs } from "@/lib/format";
import { readVoucherPostContext, writeVoucherPost } from "@/lib/accounting";
import { getSystemAccounts } from "@/lib/systemAccounts";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Receive Stock - the itemized counterpart to khataVouchers.js's
// recordSupplierPurchaseWithVoucher (amount-only, no items, no stock
// movement - that function and its SupplierLookupModal.js caller are
// untouched and still exist for quick/informal entries). This one is used
// when the shop owner is physically receiving and itemizing a real
// delivery: it increases stock_kg and overwrites cost_price_per_kg on
// every purchased product, logs the full itemized receipt to
// purchases/{id}, optionally updates the supplier's Khata balance/entries
// (only if there's a credit component), and posts one matching
// "purchase"-type voucher - all atomically in one runTransaction.
//
// supplierName is passed in by the caller (already known client-side from
// the supplier picker's loaded list) rather than re-read from Firestore,
// so the supplier doc read below can stay conditional on creditAmount > 0
// - mirroring commitReturnToFirestore's conditional customer-doc read in
// src/app/transactions/page.js exactly.
export async function receiveStockWithVoucher({
  supplierId,
  supplierName,
  invoiceNumber,
  items, // [{ id, name, weight_kg, costPerKg }, ...] - one entry per line item row as entered
  amountPaidNow,
  createdBy,
  date = todayStr(),
}) {
  if (!supplierId) throw new Error("Select a supplier.");
  if (!Array.isArray(items) || items.length === 0) throw new Error("Add at least one item.");

  const purchaseRef = doc(collection(db, "purchases"));
  const supplierRef = doc(db, "suppliers", supplierId);
  const supplierEntryRef = doc(collection(db, "suppliers", supplierId, "entries"));
  // Plain reference-data read, outside the transaction - same pattern
  // VoucherForm.js/khataVouchers.js/page.js's checkout already use.
  const { purchaseExpense, supplierPayables, cash } = await getSystemAccounts();

  let grandTotal = 0;
  let paidNow = 0;
  let creditAmount = 0;
  let newSupplierBalance = null;
  let voucherResult;

  await runTransaction(db, async (transaction) => {
    // ---- reads: one per UNIQUE product id (existence check only -
    // increment() below means the current stock value itself is never
    // needed). Firestore forbids more than one write to the same doc
    // within a transaction, so rows are aggregated by product id here even
    // though lineItems below still lists every row separately,
    // unaggregated, since that's the literal invoice as entered.
    const productAggregates = new Map(); // id -> { ref, addedWeight, lastCostPerKg }
    const lineItems = [];

    for (const item of items) {
      if (!(item.weight_kg > 0)) throw new Error(`Weight for ${item.name} must be positive.`);
      if (!(item.costPerKg >= 0)) throw new Error(`Cost/kg for ${item.name} must be zero or more.`);

      const weight = roundKg(item.weight_kg);
      const costPerKg = roundRs(item.costPerKg);
      const subtotal = roundRs(weight * costPerKg);
      grandTotal = roundRs(grandTotal + subtotal);
      lineItems.push({ id: item.id, name: item.name, weight_kg: weight, costPerKg, subtotal });

      if (!productAggregates.has(item.id)) {
        const productRef = doc(db, "products", item.id);
        const productDoc = await transaction.get(productRef);
        if (!productDoc.exists()) throw new Error(`Product ${item.name} not found.`);
        productAggregates.set(item.id, { ref: productRef, addedWeight: 0, lastCostPerKg: costPerKg });
      }
      const agg = productAggregates.get(item.id);
      agg.addedWeight = roundKg(agg.addedWeight + weight);
      agg.lastCostPerKg = costPerKg; // "latest known cost" - last row wins if a product appears twice
    }

    paidNow = roundRs(amountPaidNow || 0);
    if (paidNow < 0) throw new Error("Amount paid cannot be negative.");
    if (paidNow > grandTotal) throw new Error("Amount paid cannot exceed the total.");
    creditAmount = roundRs(grandTotal - paidNow);

    // ---- conditional read: supplier doc, ONLY if there's a credit
    // component - matches commitReturnToFirestore's `if (creditReduction > 0)`
    // conditional customer read exactly.
    let supplierDoc = null;
    if (creditAmount > 0) {
      supplierDoc = await transaction.get(supplierRef);
      if (!supplierDoc.exists()) throw new Error("Supplier not found.");
    }

    // ---- voucher lines: dr Purchase Account = grandTotal, cr Cash =
    // paidNow (if >0), cr Sundry Creditors = creditAmount (if >0).
    const voucherLines = [
      { accountId: purchaseExpense.id, type: "dr", amount: grandTotal, category: purchaseExpense.category },
    ];
    if (paidNow > 0) voucherLines.push({ accountId: cash.id, type: "cr", amount: paidNow, category: cash.category });
    if (creditAmount > 0) {
      voucherLines.push({ accountId: supplierPayables.id, type: "cr", amount: creditAmount, category: supplierPayables.category });
    }

    const voucherContext = await readVoucherPostContext(transaction, { lines: voucherLines, voucherType: "purchase", date });

    // ---- writes from here - every read above (products + conditional
    // supplier + voucher context) is done ----
    for (const { ref, addedWeight, lastCostPerKg } of productAggregates.values()) {
      // increment(), not currentStock + addedWeight - deliberately mirrors
      // EditProductModal.js's "Add stock" mode: no floor/ceiling check
      // applies to a purchase (unlike a sale's stock-availability check),
      // so there's no need to have read the current value at all, and
      // increment() is safe against two concurrent purchases of the same
      // product landing in the same instant. cost_price_per_kg is a plain
      // overwrite (not increment) - the confirmed "latest known cost"
      // convention, same as EditProductModal.js / admin/page.js.
      transaction.update(ref, {
        stock_kg: increment(addedWeight),
        cost_price_per_kg: lastCostPerKg,
        last_updated: serverTimestamp(),
      });
    }

    transaction.set(purchaseRef, {
      supplierId,
      supplierName,
      invoiceNumber: invoiceNumber || "",
      date,
      items: lineItems,
      grandTotal,
      amountPaidNow: paidNow,
      creditAmount,
      createdBy,
      createdAt: serverTimestamp(),
    });

    if (creditAmount > 0) {
      const currentBalance = supplierDoc.data().balance || 0;
      newSupplierBalance = roundRs(currentBalance + creditAmount);
      transaction.set(supplierRef, { balance: newSupplierBalance }, { merge: true });
      // Exactly {type, amount, note, createdAt} - lib/ledger.js's
      // addLedgerEntry shape, byte-for-byte, plus sourcePurchaseId for
      // traceability (same precedent as sourceTxnId/sourceReturnId on the
      // credit entries in page.js/transactions/page.js - LedgerStatement.js
      // only reads the base four fields, so this is additive and safe).
      transaction.set(supplierEntryRef, {
        type: "debit",
        amount: creditAmount,
        note: `Purchase - Invoice ${invoiceNumber || purchaseRef.id}`,
        sourcePurchaseId: purchaseRef.id,
        createdAt: serverTimestamp(),
      });
    }

    voucherResult = writeVoucherPost(transaction, {
      lines: voucherLines,
      voucherType: "purchase",
      date,
      narration: `Purchase from ${supplierName}${invoiceNumber ? ` (Inv# ${invoiceNumber})` : ""}`,
      createdBy,
      context: voucherContext,
    });
  });

  return {
    purchaseId: purchaseRef.id,
    grandTotal,
    amountPaidNow: paidNow,
    creditAmount,
    newSupplierBalance, // null if creditAmount was 0 (balance untouched)
    ...voucherResult, // { voucherId, voucherNumber }
  };
}

// Return to Supplier (Debit Note) - the mirror-opposite of
// receiveStockWithVoucher above: stock decreases, the supplier's Khata
// balance decreases (or goes negative - the supplier now owes the shop a
// credit, if they'd already been paid in full), and a reversing voucher
// posts. Deliberately not tied to a specific original purchases/{id} doc
// (see plan) - purchases can also be recorded via the simple amount-only
// "Record Purchase" Khata note, which has no itemized record to tie back
// to, so the only hard constraint here is the product's current physical
// stock, not a specific invoice's remaining quantity.
export async function returnStockToSupplierWithVoucher({
  supplierId,
  supplierName,
  items, // [{ id, name, weight_kg, costPerKg }, ...]
  reason,
  createdBy,
  date = todayStr(),
}) {
  if (!supplierId) throw new Error("Select a supplier.");
  if (!Array.isArray(items) || items.length === 0) throw new Error("Add at least one item.");

  const returnRef = doc(collection(db, "purchaseReturns"));
  const supplierRef = doc(db, "suppliers", supplierId);
  const supplierEntryRef = doc(collection(db, "suppliers", supplierId, "entries"));
  const { purchaseExpense, supplierPayables } = await getSystemAccounts();

  let totalAmount = 0;
  let newSupplierBalance = 0;
  let voucherResult;

  await runTransaction(db, async (transaction) => {
    // ---- reads ----
    // Unlike receiveStockWithVoucher's increment()-only writes (a purchase
    // has no ceiling to check), a return DOES need the current stock value
    // - you can't physically return more than what's on the shelf right
    // now - so this is a real read-then-validate-then-write, matching
    // commitTransactionToFirestore's exact stock-check pattern in
    // src/app/page.js, not the increment() shortcut used for receiving.
    const productWrites = []; // { ref, newStock }
    const lineItems = [];

    for (const item of items) {
      if (!(item.weight_kg > 0)) throw new Error(`Weight for ${item.name} must be positive.`);
      if (!(item.costPerKg >= 0)) throw new Error(`Cost/kg for ${item.name} must be zero or more.`);

      const productRef = doc(db, "products", item.id);
      const productDoc = await transaction.get(productRef);
      if (!productDoc.exists()) throw new Error(`Product ${item.name} not found.`);
      const currentStock = productDoc.data().stock_kg || 0;
      const weight = roundKg(item.weight_kg);
      if (weight > currentStock) {
        throw new Error(`Cannot return ${weight}kg of ${item.name} - only ${currentStock}kg in stock.`);
      }

      const costPerKg = roundRs(item.costPerKg);
      const subtotal = roundRs(weight * costPerKg);
      totalAmount = roundRs(totalAmount + subtotal);
      lineItems.push({ id: item.id, name: item.name, weight_kg: weight, costPerKg, subtotal });
      productWrites.push({ ref: productRef, newStock: roundKg(currentStock - weight) });
    }

    const supplierDoc = await transaction.get(supplierRef);
    if (!supplierDoc.exists()) throw new Error("Supplier not found.");

    // dr Sundry Creditors (reduces what we owe - or, past zero, creates a
    // receivable the supplier now owes the shop, carried forward as a
    // credit), cr Purchase Account (reverses the expense). No cash line -
    // unlike a customer return, a supplier debit note doesn't hand back
    // physical cash; it's purely a debt adjustment.
    const voucherLines = [
      { accountId: supplierPayables.id, type: "dr", amount: totalAmount, category: supplierPayables.category },
      { accountId: purchaseExpense.id, type: "cr", amount: totalAmount, category: purchaseExpense.category },
    ];
    const voucherContext = await readVoucherPostContext(transaction, { lines: voucherLines, voucherType: "journal", date });

    // ---- writes from here - every read above is done ----
    for (const { ref, newStock } of productWrites) {
      transaction.update(ref, { stock_kg: newStock, last_updated: serverTimestamp() });
    }

    transaction.set(returnRef, {
      supplierId,
      supplierName,
      items: lineItems,
      totalAmount,
      reason: reason || "",
      createdBy,
      createdAt: serverTimestamp(),
    });

    const currentBalance = supplierDoc.data().balance || 0;
    newSupplierBalance = roundRs(currentBalance - totalAmount); // can go negative - shop is owed a credit
    transaction.set(supplierRef, { balance: newSupplierBalance }, { merge: true });
    // "credit" - matches recordSupplierPaymentWithVoucher exactly, since
    // both actions reduce what the shop owes.
    transaction.set(supplierEntryRef, {
      type: "credit",
      amount: totalAmount,
      note: `Return to supplier${reason ? `: ${reason}` : ""}`,
      sourcePurchaseReturnId: returnRef.id,
      createdAt: serverTimestamp(),
    });

    voucherResult = writeVoucherPost(transaction, {
      lines: voucherLines,
      voucherType: "journal",
      date,
      narration: `Return to ${supplierName}${reason ? ` (${reason})` : ""}`,
      createdBy,
      context: voucherContext,
    });
  });

  return { purchaseReturnId: returnRef.id, totalAmount, newSupplierBalance, ...voucherResult };
}
