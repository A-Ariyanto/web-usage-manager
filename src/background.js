// FocusFlow Background Service Worker - v3.0
// Firebase-integrated version with real-time sync

import { initAuth, getUserId } from "./firebase-config.js";
import {
  syncStatsToFirestore,
  syncSettingsToFirestore,
  migrateLocalDataToFirestore,
  syncDailySummary,
} from "./firebase-sync.js";
import {
  incrementTaskProgress,
  getTasks,
  createTask,
  deleteTask,
  subscribeToTasks,
} from "./firebase-tasks.js";

// Firebase initialization flag
let firebaseReady = false;

// Initialize Firebase on service worker startup
(async () => {
  try {
    await initAuth();
    console.log("🔥 Firebase initialized");

    // Perform one-time migration
    const localData = await chrome.storage.local.get(null);
    if (!localData.firebaseMigrated) {
      const migrated = await migrateLocalDataToFirestore(localData);
      if (migrated) {
        await chrome.storage.local.set({ firebaseMigrated: true });
      }
    }

    firebaseReady = true;
  } catch (error) {
    console.error("❌ Firebase initialization failed:", error);
  }
})();

const WORK_DURATION = 25 * 60;
const BREAK_DURATION = 5 * 60;

// State management
let timerState = {
  isRunning: false,
  isPaused: false,
  remainingTime: WORK_DURATION,
  mode: "work",
  pendingBreak: false,
  pendingWork: false,
  activeTaskId: null, // Track which task is active for Pomodoro completion
  customDuration: WORK_DURATION, // Allow custom work duration
};

let timerInterval = null;
let deepWorkMode = false;
let blocklist = [];
let blockingEnabled = true;

// Tracking State
let currentTabId = null;
let currentUrl = null;
let trackingStartTime = Date.now();

// Smart Batching State
let pendingUpdates = {
  stats: {},
  lastSync: Date.now(),
  isDirty: false,
};

// Batching Configuration
const SYNC_INTERVAL = 30000;
const MIN_SYNC_INTERVAL = 5000;
const MAX_PENDING_SITES = 5;
const FORCE_SYNC_THRESHOLD = 60000;

// --- INITIALIZATION ---

chrome.runtime.onInstalled.addListener(async () => {
  console.log("FocusFlow v3.0 installed");
  await loadState();
  chrome.alarms.create("tracking-heartbeat", { periodInMinutes: 0.5 });
  // Create daily summary alarm (runs at midnight)
  chrome.alarms.create("daily-summary-sync", {
    when: getNextMidnight(),
    periodInMinutes: 1440, // Daily
  });
  // Set idle detection interval (60 seconds)
  chrome.idle.setDetectionInterval(60);
  await initializeTracking();
});

chrome.runtime.onStartup.addListener(async () => {
  await loadState();
  await initializeTracking();
});

// --- PERMISSION MANAGEMENT ---

async function checkHostPermissions() {
  try {
    const hasPermissions = await chrome.permissions.contains({
      origins: ["<all_urls>"],
    });
    return hasPermissions;
  } catch (error) {
    console.log("Error checking permissions:", error);
    return false;
  }
}

async function requestHostPermissions() {
  try {
    const granted = await chrome.permissions.request({
      origins: ["<all_urls>"],
    });

    if (granted) {
      console.log("Permissions granted, initializing tracking");
      await initializeTracking();
      chrome.runtime
        .sendMessage({
          type: "PERMISSIONS_STATUS",
          hasPermissions: true,
        })
        .catch(() => {});
    }

    return granted;
  } catch (error) {
    console.log("Error requesting permissions:", error);
    return false;
  }
}

async function initializeTracking() {
  try {
    const hasPermissions = await checkHostPermissions();
    if (!hasPermissions) {
      console.log("No tracking permissions, skipping initialization");
      return;
    }

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab && tab.url) {
      console.log("Initializing tracking for:", tab.url);
      startTracking(tab.id, tab.url);
    }
  } catch (error) {
    console.log("Error initializing tracking:", error);
  }
}

// --- TRACKING LOGIC ---

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await saveCurrentTracking();
  await flushPendingUpdates();
  const tab = await chrome.tabs.get(activeInfo.tabId).catch(() => null);
  if (tab && tab.url) {
    startTracking(tab.id, tab.url);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && tabId === currentTabId) {
    await saveCurrentTracking();
    startTracking(tabId, changeInfo.url);
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await saveCurrentTracking();
    await flushPendingUpdates();
    currentUrl = null;
  } else {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab && tab.url) {
      startTracking(tab.id, tab.url);
    }
  }
});

// Idle state tracking
let isUserIdle = false;

chrome.idle.onStateChanged.addListener(async (newState) => {
  if (newState === "idle" || newState === "locked") {
    // User became idle - save current tracking and stop
    console.log("User idle detected - pausing tracking");
    isUserIdle = true;
    await saveCurrentTracking();
    await flushPendingUpdates();
    currentUrl = null;
  } else if (newState === "active") {
    // User became active - resume tracking
    console.log("User active - resuming tracking");
    isUserIdle = false;
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab && tab.url) {
      startTracking(tab.id, tab.url);
    }
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "tracking-heartbeat") {
    // Don't track if user is idle
    if (currentUrl && !isUserIdle) {
      await saveCurrentTracking();
      trackingStartTime = Date.now();
    }

    await flushPendingUpdates();

    if (timerState.isRunning && !timerState.isPaused) {
      handleTimerTick();
    }
  } else if (alarm.name === "daily-summary-sync") {
    // Sync daily summary to Firebase
    await syncDailySummaryToFirestore();
    // Schedule next midnight
    chrome.alarms.create("daily-summary-sync", {
      when: getNextMidnight(),
      periodInMinutes: 1440,
    });
  }
});

function startTracking(tabId, url) {
  if (
    !url ||
    url.startsWith("chrome://") ||
    url.startsWith("safari-extension://")
  )
    return;
  currentTabId = tabId;
  currentUrl = extractDomain(url);
  trackingStartTime = Date.now();
  console.log("Started tracking:", currentUrl);
}

async function saveCurrentTracking() {
  if (!currentUrl) return;

  const now = Date.now();
  const duration = Math.floor((now - trackingStartTime) / 1000);
  if (duration <= 0) return;

  if (!pendingUpdates.stats[currentUrl]) {
    pendingUpdates.stats[currentUrl] = 0;
  }
  pendingUpdates.stats[currentUrl] += duration;
  pendingUpdates.isDirty = true;

  console.log(
    `Batched ${duration}s for ${currentUrl} (Total pending: ${pendingUpdates.stats[currentUrl]}s)`,
  );
  trackingStartTime = now;

  const timeSinceLastSync = now - pendingUpdates.lastSync;
  const pendingSiteCount = Object.keys(pendingUpdates.stats).length;

  const shouldSyncTime = timeSinceLastSync >= SYNC_INTERVAL;
  const shouldSyncVolume = pendingSiteCount >= MAX_PENDING_SITES;
  const shouldForceSync = timeSinceLastSync >= FORCE_SYNC_THRESHOLD;
  const minIntervalPassed = timeSinceLastSync >= MIN_SYNC_INTERVAL;

  if (
    (shouldSyncTime || shouldSyncVolume || shouldForceSync) &&
    minIntervalPassed
  ) {
    await flushPendingUpdates();
  }
}

async function flushPendingUpdates() {
  if (
    !pendingUpdates.isDirty ||
    Object.keys(pendingUpdates.stats).length === 0
  ) {
    return;
  }

  const today = new Date().toDateString();
  const result = await chrome.storage.local.get([
    "usageStats",
    "totalFocusedTime",
  ]);
  const usageStats = result.usageStats || {};
  let totalFocusedTime = result.totalFocusedTime || 0;

  if (!usageStats[today]) usageStats[today] = {};

  let totalDuration = 0;
  for (const [domain, seconds] of Object.entries(pendingUpdates.stats)) {
    if (!usageStats[today][domain]) usageStats[today][domain] = 0;
    usageStats[today][domain] += seconds;
    totalDuration += seconds;
  }
  totalFocusedTime += totalDuration;

  await chrome.storage.local.set({ usageStats, totalFocusedTime });

  // Sync to Firestore if ready
  if (firebaseReady && getUserId()) {
    await syncStatsToFirestore(pendingUpdates.stats);
  }

  console.log(
    `✅ Flushed ${Object.keys(pendingUpdates.stats).length} sites, ${totalDuration}s total`,
  );

  chrome.runtime.sendMessage({ type: "STATS_UPDATE" }).catch(() => {});

  pendingUpdates = {
    stats: {},
    lastSync: Date.now(),
    isDirty: false,
  };
}

function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, "");
  } catch {
    return "Unknown";
  }
}

// --- POMODORO TIMER LOGIC ---

function startTimer() {
  timerState.isRunning = true;
  timerState.isPaused = false;
  timerState.pendingBreak = false;
  timerState.pendingWork = false;
  saveTimerState();

  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => handleTimerTick(), 1000);

  updateContentScripts();
}

function handleTimerTick() {
  timerState.remainingTime--;

  if (timerState.remainingTime <= 0) {
    if (timerState.mode === "work") {
      completeWorkSession();
    } else {
      completeBreak();
    }
  }

  saveTimerState();
  broadcastTimerUpdate();
}

async function completeWorkSession() {
  timerState.isRunning = false;
  timerState.isPaused = false;
  timerState.pendingBreak = true;
  timerState.remainingTime = BREAK_DURATION;

  // Increment active task progress in Firebase
  if (timerState.activeTaskId && firebaseReady && getUserId()) {
    console.log("Incrementing task:", timerState.activeTaskId);
    await incrementTaskProgress(timerState.activeTaskId);
  }

  stopInterval();
  playNotificationSound();
  showNotification("Work Complete! 🎉", "Ready for a 5-minute break?");

  saveTimerState();
  broadcastTimerUpdate();
  updateContentScripts();
}

function completeBreak() {
  timerState.isRunning = false;
  timerState.isPaused = false;
  timerState.pendingWork = true;
  timerState.remainingTime = WORK_DURATION;

  stopInterval();
  playNotificationSound();
  showNotification("Break Over! 💪", "Ready for another focused session?");

  saveTimerState();
  broadcastTimerUpdate();
  updateContentScripts();
}

function stopInterval() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// --- REST OF THE CODE CONTINUES IDENTICALLY ---
// (Timer controls, message handling, utilities, etc.)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "START_TIMER":
      startTimer();
      break;
    case "START_BREAK":
      timerState.mode = "break";
      timerState.remainingTime = BREAK_DURATION;
      startTimer();
      break;
    case "START_WORK":
      timerState.mode = "work";
      timerState.remainingTime = WORK_DURATION;
      startTimer();
      break;
    case "PAUSE_TIMER":
      timerState.isPaused = true;
      stopInterval();
      saveTimerState();
      broadcastTimerUpdate();
      break;
    case "RESET_TIMER":
      resetTimer();
      break;
    case "GET_BLOCKLIST":
      sendResponse({
        blocklist,
        deepWorkMode,
        timerRunning: timerState.isRunning && !timerState.isPaused,
        blockingEnabled,
      });
      return true;
    case "BLOCKLIST_UPDATE":
      blocklist = message.blocklist;
      blockingEnabled =
        message.blockingEnabled !== undefined
          ? message.blockingEnabled
          : blockingEnabled;
      updateContentScripts();
      // Sync blocklist to Firestore
      if (firebaseReady && getUserId()) {
        syncSettingsToFirestore({ blocklist, blockingEnabled, deepWorkMode });
      }
      break;
    case "DEEP_WORK_TOGGLE":
      deepWorkMode = message.enabled;
      updateContentScripts();
      if (firebaseReady && getUserId()) {
        syncSettingsToFirestore({ blocklist, blockingEnabled, deepWorkMode });
      }
      break;
    case "CHECK_PERMISSIONS":
      (async () => {
        const hasPermissions = await checkHostPermissions();
        sendResponse({ hasPermissions });
      })();
      return true;
    case "REQUEST_PERMISSIONS":
      (async () => {
        const granted = await requestHostPermissions();
        sendResponse({ granted });
      })();
      return true;
    case "GET_TASKS":
      (async () => {
        const tasks = await getTasks();
        sendResponse({ tasks });
      })();
      return true;
    case "CREATE_TASK":
      (async () => {
        const task = await createTask(message.name, message.targetGoal);
        sendResponse({ success: !!task, task });
      })();
      return true;
    case "DELETE_TASK":
      (async () => {
        const success = await deleteTask(message.taskId);
        sendResponse({ success });
      })();
      return true;
    case "SET_ACTIVE_TASK":
      timerState.activeTaskId = message.taskId;
      saveTimerState();
      broadcastTimerUpdate();
      sendResponse({ success: true });
      return true;

    // Set work duration
    case "SET_WORK_DURATION":
      timerState.customDuration = message.duration;
      // If timer is not running, update remaining time
      if (!timerState.isRunning) {
        timerState.remainingTime = message.duration;
        timerState.mode = "work";
        saveTimerState();
        broadcastTimerUpdate();
      }
      sendResponse({ success: true });
      return true;

    default:
      return false;
  }
});

function resetTimer() {
  timerState = {
    isRunning: false,
    isPaused: false,
    remainingTime: WORK_DURATION,
    mode: "work",
    pendingBreak: false,
    pendingWork: false,
    activeTaskId: timerState.activeTaskId, // Preserve active task
  };
  stopInterval();
  saveTimerState();
  broadcastTimerUpdate();
  updateContentScripts();
}

function broadcastTimerUpdate() {
  chrome.runtime
    .sendMessage({ type: "TIMER_UPDATE", state: timerState })
    .catch(() => {});
}

function playNotificationSound() {
  try {
    const audio = new Audio(chrome.runtime.getURL("ring.mp3"));
    audio.play().catch((err) => console.log("Audio playback failed:", err));
  } catch (err) {
    console.log("Audio creation failed:", err);
  }
}

function showNotification(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: title,
    message: message,
    priority: 2,
  });
}

async function updateContentScripts() {
  const isDeepWorkActive =
    deepWorkMode && timerState.isRunning && !timerState.isPaused;
  const tabs = await chrome.tabs.query({});
  tabs.forEach((tab) => {
    chrome.tabs
      .sendMessage(tab.id, {
        type: "BLOCKLIST_UPDATE",
        blocklist,
        deepWorkActive: isDeepWorkActive,
        blockingEnabled,
      })
      .catch(() => {});
  });
}

async function loadState() {
  const result = await chrome.storage.local.get([
    "timerState",
    "deepWorkMode",
    "blocklist",
    "blockingEnabled",
  ]);
  if (result.timerState) {
    timerState = result.timerState;
    if (timerState.isRunning && !timerState.isPaused) {
      startTimer();
    }
  }
  deepWorkMode = result.deepWorkMode || false;
  blocklist = result.blocklist || [];
  blockingEnabled =
    result.blockingEnabled !== undefined ? result.blockingEnabled : true;
}

async function saveTimerState() {
  await chrome.storage.local.set({ timerState });
  // Optionally sync timer state to Firebase
  if (firebaseReady && getUserId()) {
    syncSettingsToFirestore({ timerState });
  }
}

// Helper: Get next midnight timestamp
function getNextMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime();
}

// Sync daily summary to Firestore
async function syncDailySummaryToFirestore() {
  if (!firebaseReady || !getUserId()) {
    console.log("Skipping daily summary sync - Firebase not ready");
    return;
  }

  try {
    const result = await chrome.storage.local.get(["usageStats"]);
    const usageStats = result.usageStats || {};
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const yesterdayStats = usageStats[yesterday];

    if (!yesterdayStats || Object.keys(yesterdayStats).length === 0) {
      console.log("No data to sync for yesterday");
      return;
    }

    // Calculate total time
    const totalTime = Object.values(yesterdayStats).reduce(
      (sum, seconds) => sum + seconds,
      0,
    );

    // Get top 10 domains
    const topDomains = Object.entries(yesterdayStats)
      .map(([domain, seconds]) => ({ domain, seconds }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 10);

    // Format date as YYYY-MM-DD
    const dateKey = new Date(yesterday).toISOString().split("T")[0];

    // Sync to Firestore
    await syncDailySummary(dateKey, totalTime, topDomains);
    console.log("✅ Daily summary synced successfully");

    // Clean up old local data (keep last 7 days)
    const cutoffDate = new Date(Date.now() - 7 * 86400000).toDateString();
    const updatedStats = {};
    for (const [date, stats] of Object.entries(usageStats)) {
      if (new Date(date) >= new Date(cutoffDate)) {
        updatedStats[date] = stats;
      }
    }
    await chrome.storage.local.set({ usageStats: updatedStats });
    console.log("🧹 Cleaned up old local tracking data");
  } catch (error) {
    console.error("❌ Failed to sync daily summary:", error);
  }
}
