import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// A more robust singleton pattern for Firebase initialization in Next.js
function getFirebaseInstances() {
  if (typeof window === 'undefined') {
    // In a server-side context
    if (!global._firebaseApp) {
      global._firebaseApp = initializeApp(firebaseConfig);
      global._firestore = getFirestore(global._firebaseApp);
      global._auth = getAuth(global._firebaseApp);
    }
    return { app: global._firebaseApp, db: global._firestore, auth: global._auth };
  }
  // In a client-side context. Persistent local cache (IndexedDB) lets
  // already-loaded product/customer/supplier data survive an offline page
  // reload instead of going blank - complementary to, not a replacement
  // for, offlineQueue.js's write-retry handling (runTransaction can't be
  // satisfied from cache regardless of this setting, since it needs a live
  // round-trip to read-then-verify-then-write). Multi-tab manager matters
  // since the register and /dashboard or /accounts are plausibly open in
  // separate tabs on the same till.
  const isFreshApp = getApps().length === 0;
  const app = isFreshApp ? initializeApp(firebaseConfig) : getApp();
  // initializeFirestore may only be called once per app, before any other
  // Firestore usage - capturing isFreshApp above (rather than re-checking
  // getApps().length here) avoids racing against the initializeApp call
  // just above, which would otherwise make this always see a non-empty
  // app list and silently skip persistence.
  const db = isFreshApp
    ? initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })
    : getFirestore(app);
  const auth = getAuth(app);
  return { app, db, auth };
}

export const { db, auth, app } = getFirebaseInstances();