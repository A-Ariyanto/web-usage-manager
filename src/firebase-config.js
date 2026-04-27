// Firebase Configuration and Initialization
import { initializeApp } from "firebase/app";
import { getFirestore, initializeFirestore } from "firebase/firestore";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";

// Firebase configuration
const firebaseConfig = {
  apiKey: "[FIREBASE_API_KEY]",
  authDomain: "[FIREBASE_AUTH_DOMAIN]",
  projectId: "[FIREBASE_PROJECT_ID]",
  storageBucket: "[FIREBASE_STORAGE_BUCKET]",
  messagingSenderId: "[FIREBASE_MESSAGING_SENDER_ID]",
  appId: "[FIREBASE_APP_ID]",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore with settings compatible with service workers
// Service workers require memory cache (no IndexedDB) and long-polling
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true, // Required: Use fetch instead of XHR/WebSocket
});

const auth = getAuth(app);

// Authentication state
let currentUser = null;

// Initialize authentication
export async function initAuth() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        currentUser = user;
        console.log("✅ User authenticated:", user.uid);
        resolve(user);
      } else {
        // Sign in anonymously
        try {
          const userCredential = await signInAnonymously(auth);
          currentUser = userCredential.user;
          console.log("✅ Anonymous sign-in successful:", currentUser.uid);
          resolve(currentUser);
        } catch (error) {
          console.error("❌ Authentication failed:", error);
          resolve(null);
        }
      }
    });
  });
}

// Get current user ID
export function getUserId() {
  return currentUser?.uid || null;
}

// Export instances
export { app, db, auth };
