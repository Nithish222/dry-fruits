const STORAGE_KEY = "pos_pending_transactions";

// Firestore signals a connectivity problem with error.code === "unavailable".
// We also treat the browser's own offline signal as authoritative, since a
// stale/slow connection can fail in ways Firestore doesn't label that way.
export function isOfflineError(error) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  return error?.code === "unavailable";
}

export function getPendingTransactions() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error("Failed to read pending transactions queue: ", error);
    return [];
  }
}

function savePendingTransactions(queue) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.error("Failed to persist pending transactions queue: ", error);
  }
}

export function queueTransaction(payload) {
  const entry = {
    localId: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    queuedAt: new Date().toISOString(),
    payload,
  };
  const queue = getPendingTransactions();
  queue.push(entry);
  savePendingTransactions(queue);
  return entry;
}

export function removePendingTransaction(localId) {
  savePendingTransactions(getPendingTransactions().filter((entry) => entry.localId !== localId));
}
