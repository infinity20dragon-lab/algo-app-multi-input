import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
};

// Log Firebase config for debugging (only in browser)
if (typeof window !== 'undefined') {
  console.log('[Firebase Config] Runtime environment check:', {
    hostname: window.location.hostname,
    isVercel: window.location.hostname.includes('vercel.app'),
    isLocalhost: window.location.hostname === 'localhost',
  });

  console.log('[Firebase Config] Raw config object types:', {
    apiKey: typeof firebaseConfig.apiKey,
    authDomain: typeof firebaseConfig.authDomain,
    projectId: typeof firebaseConfig.projectId,
    storageBucket: typeof firebaseConfig.storageBucket,
    messagingSenderId: typeof firebaseConfig.messagingSenderId,
    appId: typeof firebaseConfig.appId,
    measurementId: typeof firebaseConfig.measurementId,
    databaseURL: typeof firebaseConfig.databaseURL,
  });

  console.log('[Firebase Config] Actual config values:', {
    projectId: firebaseConfig.projectId,
    authDomain: firebaseConfig.authDomain,
    databaseURL: firebaseConfig.databaseURL,
    apiKey: firebaseConfig.apiKey ? `${firebaseConfig.apiKey.slice(0, 10)}...` : 'MISSING!',
    storageBucket: firebaseConfig.storageBucket,
    appId: firebaseConfig.appId ? `${firebaseConfig.appId.slice(0, 15)}...` : 'MISSING!',
    hasAllCriticalValues: !!(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.databaseURL && firebaseConfig.appId),
  });

  // Check if any values are undefined
  const missingVars = [];
  if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY) missingVars.push('NEXT_PUBLIC_FIREBASE_API_KEY');
  if (!process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN) missingVars.push('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN');
  if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) missingVars.push('NEXT_PUBLIC_FIREBASE_PROJECT_ID');
  if (!process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL) missingVars.push('NEXT_PUBLIC_FIREBASE_DATABASE_URL');
  if (!process.env.NEXT_PUBLIC_FIREBASE_APP_ID) missingVars.push('NEXT_PUBLIC_FIREBASE_APP_ID');

  if (missingVars.length > 0) {
    console.error('[Firebase Config] ❌ MISSING ENVIRONMENT VARIABLES:', missingVars);
  } else {
    console.log('[Firebase Config] ✅ All critical environment variables present');
  }

  // Log if values are empty strings
  const emptyVars = [];
  if (firebaseConfig.apiKey === '') emptyVars.push('apiKey');
  if (firebaseConfig.authDomain === '') emptyVars.push('authDomain');
  if (firebaseConfig.projectId === '') emptyVars.push('projectId');
  if (firebaseConfig.databaseURL === '') emptyVars.push('databaseURL');
  if (firebaseConfig.appId === '') emptyVars.push('appId');

  if (emptyVars.length > 0) {
    console.error('[Firebase Config] ❌ EMPTY STRING VALUES:', emptyVars);
  }
}

// Initialize Firebase (prevent multiple initializations)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const realtimeDb = getDatabase(app);

// Log Firestore instance for debugging
if (typeof window !== 'undefined') {
  console.log('[Firestore] Instance details:', {
    type: db.type,
    appName: db.app.name,
    projectId: db.app.options.projectId,
  });

  console.log('[Firebase App] Initialization details:', {
    name: app.name,
    projectId: app.options.projectId,
    authDomain: app.options.authDomain,
    hasApiKey: !!app.options.apiKey,
    hasAppId: !!app.options.appId,
  });
}

export default app;
