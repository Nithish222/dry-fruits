const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

// Tally Phase 5 - a single trigger doing two jobs on every voucher write:
// (1) an append-only audit log entry, always, and (2) a monthly P&L rollup
// update, skipped when the write didn't actually change financial content.
// src/lib/accounting.js's cancelVoucher only ever touches {status,
// cancelledAt, cancelledBy, reversalVoucherId} on an existing voucher - its
// real financial effect lands via a brand-new reversal voucher document
// (its own create event), so re-processing that status-only update here
// would just be wasted increment writes that net to zero.

function linesDeepEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((line, i) => {
    const other = b[i];
    return line.accountId === other.accountId && line.type === other.type && line.amount === other.amount && line.category === other.category;
  });
}

function getYearMonth(dateStr) {
  const [year, month] = dateStr.split("-").map(Number);
  return { year, month };
}

// Accumulates every line's contribution (reversing `before`, applying
// `after`) into one net delta per {accountId, year, month} bucket rather
// than writing each line as its own batch operation. A Firestore
// WriteBatch rejects more than one write targeting the same document, so a
// voucher whose before/after both touch the same account+month (a
// hypothetical future direct edit - no code path in this app produces that
// today, since postVoucher only creates and cancelVoucher's update is
// filtered out above) would otherwise crash the batch instead of netting
// to the correct combined delta.
function accumulateDeltas(deltasByBucket, lines, date, sign) {
  if (!lines || !date) return;
  const { year, month } = getYearMonth(date);
  for (const line of lines) {
    const amount = Number(line.amount) || 0;
    const bucketId = `${line.accountId}_${year}_${month}`;
    const existing = deltasByBucket.get(bucketId) || {
      accountId: line.accountId,
      year,
      month,
      category: line.category,
      debitsDelta: 0,
      creditsDelta: 0,
      netDelta: 0,
    };
    if (line.type === "dr") {
      existing.debitsDelta += sign * amount;
      existing.netDelta += sign * amount;
    } else {
      existing.creditsDelta += sign * amount;
      existing.netDelta -= sign * amount;
    }
    existing.category = line.category;
    deltasByBucket.set(bucketId, existing);
  }
}

exports.onVoucherWritten = onDocumentWritten("vouchers/{voucherId}", async (event) => {
  const voucherId = event.params.voucherId;
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;

  const modifiedBy = after?.cancelledBy || after?.createdBy || before?.createdBy || null;
  // No client can ever delete a voucher (firestore.rules: `allow delete:
  // if false`), so a genuine delete here can only come from a privileged
  // Admin SDK operation outside the app - worth its own distinct label
  // rather than folding it into "update", since that's exactly the kind of
  // out-of-band event an audit trail should flag clearly.
  const operation = !before ? "create" : !after ? "delete" : "update";
  // Keyed by event.id (not an auto-id via .add()) so a redelivery of the
  // same event - Cloud Functions v2 Firestore triggers are at-least-once,
  // not exactly-once - overwrites the same log doc instead of duplicating
  // it. The rollup step below is separately guarded to be a safe no-op on
  // redelivery too; this keeps the audit log equally exact.
  await db.collection("audit_logs").doc(event.id).set({
    entityId: voucherId,
    entityType: "voucher",
    operation,
    before,
    after,
    modifiedBy,
    timestamp: FieldValue.serverTimestamp(),
  });

  const financiallyUnchanged = before && after && before.date === after.date && linesDeepEqual(before.lines, after.lines);
  if (financiallyUnchanged) {
    console.log(`Skipping rollup for ${voucherId} - no financial change (status-only update).`);
    return;
  }

  const deltasByBucket = new Map();
  if (before) accumulateDeltas(deltasByBucket, before.lines, before.date, -1);
  if (after) accumulateDeltas(deltasByBucket, after.lines, after.date, 1);

  if (deltasByBucket.size === 0) return;

  const batch = db.batch();
  for (const [bucketId, delta] of deltasByBucket) {
    if (delta.debitsDelta === 0 && delta.creditsDelta === 0 && delta.netDelta === 0) continue;
    const bucketRef = db.collection("monthly_ledger_balances").doc(bucketId);
    batch.set(
      bucketRef,
      {
        accountId: delta.accountId,
        year: delta.year,
        month: delta.month,
        category: delta.category,
        totalDebits: FieldValue.increment(delta.debitsDelta),
        totalCredits: FieldValue.increment(delta.creditsDelta),
        netChange: FieldValue.increment(delta.netDelta),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  await batch.commit();
  console.log(`Rollup updated for voucher ${voucherId} across ${deltasByBucket.size} bucket(s).`);
});
