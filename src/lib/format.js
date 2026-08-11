// Shared between the Register catalog (stock caption color) and Admin
// (Low Stock / In Stock badge) so both surfaces agree on the same cutoff.
export const LOW_STOCK_THRESHOLD_KG = 5;

export function formatINR(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
