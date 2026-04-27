// Firebase Sync Manager - Bridge between Chrome Storage and Firestore
import { db, getUserId } from "./firebase-config.js";
import {
  doc,
  setDoc,
  getDoc,
  writeBatch,
  serverTimestamp,
  runTransaction,
  increment,
} from "firebase/firestore";

// Get today's session key
function getTodayKey() {
  return new Date().toISOString().split("T")[0]; // YYYY-MM-DD
}

// Sync pending stats to Firestore (called from flushPendingUpdates)
export async function syncStatsToFirestore(pendingStats) {
  const userId = getUserId();
  if (!userId || Object.keys(pendingStats).length === 0) {
    return false;
  }

  try {
    const todayKey = getTodayKey();
    const sessionRef = doc(db, `users/${userId}/sessions/${todayKey}`);

    // Use transaction for atomic updates
    await runTransaction(db, async (transaction) => {
      const sessionDoc = await transaction.get(sessionRef);
      const currentStats = sessionDoc.exists()
        ? sessionDoc.data().stats || {}
        : {};

      // Merge pending updates
      let totalSeconds = 0;
      for (const [domain, seconds] of Object.entries(pendingStats)) {
        currentStats[domain] = (currentStats[domain] || 0) + seconds;
        totalSeconds += seconds;
      }

      const totalFocusedTime = Object.values(currentStats).reduce(
        (a, b) => a + b,
        0,
      );

      transaction.set(
        sessionRef,
        {
          date: todayKey,
          stats: currentStats,
          totalFocusedTime,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    });

    console.log("🔥 Firestore sync complete");
    return true;
  } catch (error) {
    console.error("❌ Firestore sync failed:", error);
    return false;
  }
}

// Sync settings to Firestore (blocklist, timer state, etc.)
export async function syncSettingsToFirestore(settings) {
  const userId = getUserId();
  if (!userId) return false;

  try {
    const settingsRef = doc(db, `users/${userId}/settings/preferences`);
    await setDoc(
      settingsRef,
      {
        ...settings,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    console.log("🔥 Settings synced to Firestore");
    return true;
  } catch (error) {
    console.error("❌ Settings sync failed:", error);
    return false;
  }
}

// Load settings from Firestore
export async function loadSettingsFromFirestore() {
  const userId = getUserId();
  if (!userId) return null;

  try {
    const settingsRef = doc(db, `users/${userId}/settings/preferences`);
    const settingsDoc = await getDoc(settingsRef);

    if (settingsDoc.exists()) {
      console.log("🔥 Settings loaded from Firestore");
      return settingsDoc.data();
    }
    return null;
  } catch (error) {
    console.error("❌ Failed to load settings:", error);
    return null;
  }
}

// Load today's stats from Firestore
export async function loadStatsFromFirestore() {
  const userId = getUserId();
  if (!userId) return null;

  try {
    const todayKey = getTodayKey();
    const sessionRef = doc(db, `users/${userId}/sessions/${todayKey}`);
    const sessionDoc = await getDoc(sessionRef);

    if (sessionDoc.exists()) {
      console.log("🔥 Stats loaded from Firestore");
      return sessionDoc.data();
    }
    return null;
  } catch (error) {
    console.error("❌ Failed to load stats:", error);
    return null;
  }
}

// Migrate existing local data to Firestore (one-time)
export async function migrateLocalDataToFirestore(localData) {
  const userId = getUserId();
  if (!userId || localData.firebaseMigrated) {
    return false;
  }

  try {
    console.log("🔄 Starting migration to Firestore...");

    // Migrate settings
    if (localData.blocklist || localData.deepWorkMode !== undefined) {
      await syncSettingsToFirestore({
        blocklist: localData.blocklist || [],
        deepWorkMode: localData.deepWorkMode || false,
        blockingEnabled:
          localData.blockingEnabled !== undefined
            ? localData.blockingEnabled
            : true,
        timerState: localData.timerState || null,
      });
    }

    // Migrate today's stats
    if (localData.usageStats) {
      const today = new Date().toDateString();
      const todayStats = localData.usageStats[today];

      if (todayStats && Object.keys(todayStats).length > 0) {
        await syncStatsToFirestore(todayStats);
      }
    }

    console.log("✅ Migration to Firestore complete");
    return true;
  } catch (error) {
    console.error("❌ Migration failed:", error);
    return false;
  }
}

// Sync daily summary to Firestore
export async function syncDailySummary(date, totalTime, topDomains) {
  const userId = getUserId();
  if (!userId) {
    console.error("❌ Cannot sync daily summary: User not authenticated");
    return false;
  }

  try {
    const summaryRef = doc(db, `users/${userId}/dailySummaries/${date}`);

    await setDoc(
      summaryRef,
      {
        date,
        totalTime,
        topDomains,
        syncedAt: serverTimestamp(),
      },
      { merge: true },
    );

    console.log("🔥 Daily summary synced to Firestore:", date);
    return true;
  } catch (error) {
    console.error("❌ Daily summary sync failed:", error);
    return false;
  }
}
