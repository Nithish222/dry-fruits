import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
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
  // In a client-side context
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  const db = getFirestore(app);
  const auth = getAuth(app);
  return { app, db, auth };
}

export const { db, auth, app } = getFirebaseInstances();