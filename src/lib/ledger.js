import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { roundRs } from "@/lib/format";

// Shared by every ledger surface that keeps a running balance under a
// top-level account doc - customers/{id} (Tally Phase 1, receivables) and
// suppliers/{id} (Tally Phase 2, payables). One atomic transaction reads
// the account's current balance, applies the signed delta (debit = balance
// up, credit = balance down), and appends the entries-subcollection doc
// that explains it. Returns the new balance so the caller can update local
// state without a second read.
//
// The debit/credit -> up/down direction is fixed across every collection
// this is used with, but what a positive balance *means* is collection-
// specific: for customers it's "customer owes the shop"; for suppliers it's
// "shop owes the supplier". Each caller frames its own UI accordingly.
export async function addLedgerEntry(collectionName, accountId, { type, amount, note }) {
  const accountRef = doc(db, collectionName, accountId);
  const entryRef = doc(collection(db, collectionName, accountId, "entries"));
  const roundedAmount = roundRs(amount);
  let newBalance = 0;

  await runTransaction(db, async (transaction) => {
    const accountDoc = await transaction.get(accountRef);
    const currentBalance = accountDoc.exists() ? accountDoc.data().balance || 0 : 0;
    const delta = type === "debit" ? roundedAmount : -roundedAmount;
    newBalance = roundRs(currentBalance + delta);

    transaction.set(accountRef, { balance: newBalance }, { merge: true });
    transaction.set(entryRef, { type, amount: roundedAmount, note, createdAt: serverTimestamp() });
  });

  return newBalance;
}
