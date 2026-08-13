import { collection, getDocs, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { roundRs } from "@/lib/format";
import { readVoucherPostContext, writeVoucherPost } from "@/lib/accounting";
import { getSystemAccounts } from "@/lib/systemAccounts";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// One-time bootstrap for shops that already had stock on the shelf before
// Inventory became a tracked ledger asset - that stock was expensed under
// the old Purchase Account (or never itemized at all) and was never
// capitalized, so without this, Inventory would start at ₹0 while real
// stock sits on the shelves. Mirrors recordCustomerOpeningBalanceWithVoucher/
// recordSupplierOpeningBalanceWithVoucher (khataVouchers.js) exactly - dr
// the asset, cr Opening Balance Equity - just at Chart-of-Accounts level
// rather than a Khata (customer/supplier) balance, so it lives in its own
// file rather than stretching either khataVouchers.js's or purchases.js's
// stated scope, or accounting.js's "never touches domain collections" one.
//
// Guarded against double-posting two ways: a fast pre-check on Inventory's
// cached currentBalance (fails fast, no reads), and an authoritative
// re-check inside the transaction against the same account doc
// readVoucherPostContext already reads for posting (no extra read) - so a
// double-click or concurrent call can't double-post.
export async function seedOpeningInventoryBalance({ createdBy, date = todayStr() }) {
  const { inventoryAsset, openingBalanceEquity } = await getSystemAccounts();

  if (roundRs(inventoryAsset.currentBalance || 0) !== 0) {
    throw new Error("Inventory already has a balance - opening balance can only be seeded once.");
  }

  const productsSnap = await getDocs(collection(db, "products"));
  let total = 0;
  let missingCostCount = 0;
  for (const productDoc of productsSnap.docs) {
    const { stock_kg, cost_price_per_kg } = productDoc.data();
    if (cost_price_per_kg == null || !Number.isFinite(cost_price_per_kg)) {
      if (stock_kg > 0) missingCostCount += 1;
      continue;
    }
    total = roundRs(total + (stock_kg || 0) * cost_price_per_kg);
  }
  if (!(total > 0)) {
    throw new Error("Nothing to seed - no product has both stock and a cost price.");
  }

  const lines = [
    { accountId: inventoryAsset.id, type: "dr", amount: total, category: inventoryAsset.category },
    { accountId: openingBalanceEquity.id, type: "cr", amount: total, category: openingBalanceEquity.category },
  ];

  let result;
  await runTransaction(db, async (transaction) => {
    const context = await readVoucherPostContext(transaction, { lines, voucherType: "journal", date });
    const freshBalance = context.accountDocsById.get(inventoryAsset.id).data.currentBalance || 0;
    if (roundRs(freshBalance) !== 0) {
      throw new Error("Inventory already has a balance - opening balance can only be seeded once.");
    }
    result = writeVoucherPost(transaction, {
      lines,
      voucherType: "journal",
      date,
      narration: "Opening balance - existing stock on hand",
      createdBy,
      context,
    });
  });

  return { ...result, total, missingCostCount };
}
