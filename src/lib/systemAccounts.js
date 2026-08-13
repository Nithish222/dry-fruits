import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

// Tally Phase 6 - the exact Chart of Accounts leaf ledger names POS
// checkout, Khata<->voucher wiring (khataVouchers.js), and the returns fix
// all key off by name. "cash", "salesRevenue", "purchaseExpense" reuse
// Phase 4's existing seeded leaves; the other four are added once via the
// Chart of Accounts "+ Add Account" UI. firestore.rules lets an account be
// renamed post-creation (`name` is one of the few mutable fields) -
// renaming any of these seven here will silently break checkout/Khata
// voucher posting/returns until this map is updated to match. Treat this
// list as load-bearing.
export const SYSTEM_LEDGER_NAMES = {
  cash: "Cash",
  gpayClearing: "UPI/GPay Clearing",
  salesRevenue: "Sales Account",
  purchaseExpense: "Purchase Account",
  customerReceivables: "Sundry Debtors (Customers)",
  supplierPayables: "Sundry Creditors (Suppliers)",
  openingBalanceEquity: "Opening Balance Equity",
};

let cache = null;
let inflight = null;

// One getDocs over every leaf account (mirrors VoucherForm.js's account-
// picker query), reshaped into a role-keyed object and cached in-memory
// for the session. Deliberately outside any runTransaction - resolving
// these IDs is a plain read against near-static reference data, exactly
// like VoucherForm.js already fetches its account picker list outside its
// own submit transaction.
export async function getSystemAccounts() {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const snapshot = await getDocs(query(collection(db, "accounts"), where("isGroup", "==", false)));
    const byName = new Map(snapshot.docs.map((d) => [d.data().name, { id: d.id, ...d.data() }]));
    const resolved = {};
    for (const [role, name] of Object.entries(SYSTEM_LEDGER_NAMES)) {
      const account = byName.get(name);
      if (!account) {
        throw new Error(`Required ledger "${name}" not found in Chart of Accounts - add it first (Accounting > Chart of Accounts > + Add Account).`);
      }
      if (account.isActive === false) {
        throw new Error(`Ledger "${name}" is inactive - reactivate it before posting.`);
      }
      resolved[role] = account;
    }
    cache = resolved;
    return resolved;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

// Called after addAccount() succeeds so a newly-added system ledger is
// picked up within the same session instead of waiting for reload.
export function invalidateSystemAccountsCache() {
  cache = null;
}
