// Shared between the Register catalog (stock caption color) and Admin
// (Low Stock / In Stock badge) so both surfaces agree on the same cutoff.
export const LOW_STOCK_THRESHOLD_KG = 5;

// Shared between the Register checkout (credit-sale confirm dialog) and
// PaymentModal (projected-balance display) so a credit sale that would push
// a customer's balance past this is flagged before it's committed. One
// global placeholder, not a per-customer setting yet - adjust freely.
export const CREDIT_LIMIT_WARNING_THRESHOLD = 5000;

// Rounds to paise precision so repeated addition/subtraction (a running
// customer balance, credit amounts split off a total) doesn't accumulate
// floating-point noise the way unrounded rupee math does.
export function roundRs(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function formatINR(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Display label only - the stored payment.mode value stays "gpay" (it's
// the accounting ledger key too, see systemAccounts.js's gpayClearing and
// khataVouchers.js's routing), so renaming what's shown to a customer/
// cashier doesn't touch historical transactions or account routing.
export function formatPaymentMode(mode) {
  if (mode === "gpay") return "UPI";
  if (mode === "cash") return "Cash";
  if (mode === "credit") return "Credit";
  return mode || "";
}

// Accepts a Firestore Timestamp ({seconds}), a JS Date, or a "YYYY-MM-DD"
// string. The string form is parsed as plain calendar-date parts, not
// through Date's own string parsing (which reads "YYYY-MM-DD" as UTC
// midnight and can render a day off depending on the reader's timezone) -
// same defensive parsing DatePicker.js already uses for the same reason.
function toJsDate(value) {
  if (value instanceof Date) return value;
  if (value?.seconds != null) return new Date(value.seconds * 1000);
  if (typeof value === "string") {
    const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (isoDateOnly) {
      const [, y, m, d] = isoDateOnly;
      return new Date(Number(y), Number(m) - 1, Number(d));
    }
    return new Date(value);
  }
  return null;
}

// This app's one date-display convention: DD/MM/YYYY.
export function formatDate(value) {
  const date = toJsDate(value);
  if (!date || Number.isNaN(date.getTime())) return "N/A";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

// DD/MM/YYYY plus a time, for values that carry one (Firestore Timestamps,
// mainly) - the date half always matches formatDate exactly.
export function formatDateTime(value) {
  const date = toJsDate(value);
  if (!date || Number.isNaN(date.getTime())) return "N/A";
  const time = date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  return `${formatDate(date)}, ${time}`;
}

// Weights are tracked in kg but entered/adjusted in gram increments, so plain
// float arithmetic (e.g. repeated subtraction/addition) drifts into values
// like 98.35000000000001. Round to gram precision (3 decimals) on every
// write so stock_kg never accumulates floating-point noise in Firestore.
export function roundKg(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

// Returns null when cost isn't set (distinct from a genuine ₹0 cost) so
// callers can render "—" instead of a misleading 100% margin.
export function computeMargin(retailPrice, costPrice) {
  if (costPrice === null || costPrice === undefined || !Number.isFinite(Number(costPrice))) {
    return null;
  }
  const marginRs = Number(retailPrice || 0) - Number(costPrice);
  const marginPct = retailPrice > 0 ? (marginRs / retailPrice) * 100 : null;
  return { marginRs, marginPct };
}

// Sums revenue-minus-cost profit across a set of documents that each carry
// an `items` array (transactions and returns share that shape, so this
// works for both - a return's profit, subtracted from a sale's, is how
// callers net a refunded item back out of the day's margin). Items without
// a costPriceAtSale snapshot (sold before cost tracking existed, or the
// product never had a cost price set) are treated as ₹0 cost rather than
// dropped, so revenue is still counted - missingCostCount says how many
// items took that fallback, so callers can flag the total as an
// overestimate instead of presenting it as exact.
export function computeProfit(docs) {
  let profit = 0;
  let missingCostCount = 0;
  for (const doc of docs) {
    for (const item of doc.items || []) {
      const weight = item.weight_kg || 0;
      const revenue = item.subtotal ?? (item.billedPrice || 0) * weight;
      if (item.costPriceAtSale != null && Number.isFinite(item.costPriceAtSale)) {
        profit += revenue - item.costPriceAtSale * weight;
      } else {
        profit += revenue;
        missingCostCount += 1;
      }
    }
  }
  return { profit, missingCostCount };
}
