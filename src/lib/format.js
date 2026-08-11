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
