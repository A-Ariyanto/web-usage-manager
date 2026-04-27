// FocusFlow Background Service Worker - v2.2
// Incorporates robust Safari tracking patterns and manual Pomodoro transitions

const WORK_DURATION = 25 * 60;
const BREAK_DURATION = 5 * 60;

// State management
let timerState = {
  isRunning: false,
  isPaused: false,
  remainingTime: WORK_DURATION,
  mode: 'work',
  pendingBreak: false,
  pendingWork: false
};

let timerInterval = null; // Used for smooth 1s UI updates while popup is open
let deepWorkMode = false;
let blocklist = [];
let blockingEnabled = true;

// Tracking State
let currentTabId = null;
let currentUrl = null;
let trackingStartTime = Date.now();

// Smart Batching State
let pendingUpdates = {
  stats: {}, // { domain: seconds }
  lastSync: Date.now(),
  isDirty: false
};

// Batching Configuration
const SYNC_INTERVAL = 30000; // 30 seconds - reduce from 6 seconds
const MIN_SYNC_INTERVAL = 5000; // Minimum 5 seconds between syncs
const MAX_PENDING_SITES = 5; // Sync if tracking more than 5 different sites
const FORCE_SYNC_THRESHOLD = 60000; // Force sync after 1 minute max

// --- INITIALIZATION ---

chrome.runtime.onInstalled.addListener(async () => {
  console.log('FocusFlow v2.2 installed');
  await loadState();
  // Create a heartbeat alarm to keep the service worker alive and save data periodically
  chrome.alarms.create('tracking-heartbeat', { periodInMinutes: 0.5 }); // ~Every 30 seconds
  // Initialize tracking for current active tab
  await initializeTracking();
});

chrome.runtime.onStartup.addListener(async () => {
  await loadState();
  // Initialize tracking for current active tab on browser startup
  await initializeTracking();
});

// --- PERMISSION MANAGEMENT ---

async function checkHostPermissions() {
  try {
    const hasPermissions = await chrome.permissions.contains({
      origins: ['<all_urls>']
    });
    return hasPermissions;
  } catch (error) {
    console.log('Error checking permissions:', error);
    return false;
  }
}

async function requestHostPermissions() {
  try {
    const granted = await chrome.permissions.request({
      origins: ['<all_urls>']
    });
    
    if (granted) {
      console.log('Permissions granted, initializing tracking');
      await initializeTracking();
      // Notify all popups about permission change
      chrome.runtime.sendMessage({ 
        type: 'PERMISSIONS_STATUS', 
        hasPermissions: true 
      }).catch(() => {});
    }
    
    return granted;
  } catch (error) {
    console.log('Error requesting permissions:', error);
    return false;
  }
}

async function initializeTracking() {
  try {
    const hasPermissions = await checkHostPermissions();
    if (!hasPermissions) {
      console.log('No tracking permissions, skipping initialization');
      return;
    }
    
    // Get the current active tab and start tracking
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      console.log('Initializing tracking for:', tab.url);
      startTracking(tab.id, tab.url);
    }
  } catch (error) {
    console.log('Error initializing tracking:', error);
  }
}

// --- TRACKING LOGIC (Safari Optimized) ---

// Capture tab activations
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await saveCurrentTracking();
  await flushPendingUpdates(); // Flush when switching tabs
  const tab = await chrome.tabs.get(activeInfo.tabId).catch(() => null);
  if (tab && tab.url) {
    startTracking(tab.id, tab.url);
  }
});

// Capture URL updates within the same tab
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && tabId === currentTabId) {
    await saveCurrentTracking();
    startTracking(tabId, changeInfo.url);
  }
});

// Detect when the browser window loses or gains focus
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await saveCurrentTracking();
    await flushPendingUpdates(); // Flush when losing focus
    currentUrl = null;
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      startTracking(tab.id, tab.url);
    }
  }
});

// Heartbeat for persistence and background timer ticking
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'tracking-heartbeat') {
    // Save current tracking session (will batch)
    if (currentUrl) {
      await saveCurrentTracking();
      trackingStartTime = Date.now();
    }
    
    // Flush pending updates on heartbeat (every 30s)
    await flushPendingUpdates();
    
    // Handle background timer decrement if running
    if (timerState.isRunning && !timerState.isPaused) {
      handleTimerTick();
    }
  }
});

function startTracking(tabId, url) {
  if (!url || url.startsWith('chrome://') || url.startsWith('safari-extension://')) return;
  currentTabId = tabId;
  currentUrl = extractDomain(url);
  trackingStartTime = Date.now();
  console.log('Started tracking:', currentUrl);
}

async function saveCurrentTracking() {
  if (!currentUrl) return;
  
  const now = Date.now();
  const duration = Math.floor((now - trackingStartTime) / 1000);
  if (duration <= 0) return;

  // Accumulate in memory (smart batching)
  if (!pendingUpdates.stats[currentUrl]) {
    pendingUpdates.stats[currentUrl] = 0;
  }
  pendingUpdates.stats[currentUrl] += duration;
  pendingUpdates.isDirty = true;
  
  console.log(`Batched ${duration}s for ${currentUrl} (Total pending: ${pendingUpdates.stats[currentUrl]}s)`);
  trackingStartTime = now;

  // Determine if we should sync now based on smart triggers
  const timeSinceLastSync = now - pendingUpdates.lastSync;
  const pendingSiteCount = Object.keys(pendingUpdates.stats).length;
  
  const shouldSyncTime = timeSinceLastSync >= SYNC_INTERVAL;
  const shouldSyncVolume = pendingSiteCount >= MAX_PENDING_SITES;
  const shouldForceSync = timeSinceLastSync >= FORCE_SYNC_THRESHOLD;
  const minIntervalPassed = timeSinceLastSync >= MIN_SYNC_INTERVAL;
  
  if ((shouldSyncTime || shouldSyncVolume || shouldForceSync) && minIntervalPassed) {
    await flushPendingUpdates();
  }
}

async function flushPendingUpdates() {
  if (!pendingUpdates.isDirty || Object.keys(pendingUpdates.stats).length === 0) {
    return;
  }

  const today = new Date().toDateString();
  const result = await chrome.storage.local.get(['usageStats', 'totalFocusedTime']);
  const usageStats = result.usageStats || {};
  let totalFocusedTime = result.totalFocusedTime || 0;

  if (!usageStats[today]) usageStats[today] = {};

  // Merge all pending updates
  let totalDuration = 0;
  for (const [domain, seconds] of Object.entries(pendingUpdates.stats)) {
    if (!usageStats[today][domain]) usageStats[today][domain] = 0;
    usageStats[today][domain] += seconds;
    totalDuration += seconds;
  }
  totalFocusedTime += totalDuration;

  await chrome.storage.local.set({ usageStats, totalFocusedTime });
  
  console.log(`✅ Flushed ${Object.keys(pendingUpdates.stats).length} sites, ${totalDuration}s total`);
  
  // Notify UI of update
  chrome.runtime.sendMessage({ type: 'STATS_UPDATE' }).catch(() => {});
  
  // Reset batching state
  pendingUpdates = {
    stats: {},
    lastSync: Date.now(),
    isDirty: false
  };
}

function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return 'Unknown';
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
    if (timerState.mode === 'work') {
      completeWorkSession();
    } else {
      completeBreak();
    }
  }
  
  saveTimerState();
  broadcastTimerUpdate();
}

function completeWorkSession() {
  timerState.isRunning = false;
  timerState.isPaused = false;
  timerState.pendingBreak = true; // Wait for manual "Start Break"
  timerState.remainingTime = BREAK_DURATION;
  
  stopInterval();
  playNotificationSound(); // Plays local ring.mp3
  showNotification('Work Complete! 🎉', 'Ready for a 5-minute break?');
  
  saveTimerState();
  broadcastTimerUpdate();
  updateContentScripts();
}

function completeBreak() {
  timerState.isRunning = false;
  timerState.isPaused = false;
  timerState.pendingWork = true; // Wait for manual "Start Focus Session"
  timerState.remainingTime = WORK_DURATION;
  
  stopInterval();
  playNotificationSound();
  showNotification('Break Over! 💪', 'Ready for another focused session?');
  
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

// --- MESSAGE HANDLING ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'START_TIMER':
      startTimer();
      break;
    case 'START_BREAK':
      timerState.mode = 'break';
      timerState.remainingTime = BREAK_DURATION;
      startTimer();
      break;
    case 'START_WORK':
      timerState.mode = 'work';
      timerState.remainingTime = WORK_DURATION;
      startTimer();
      break;
    case 'PAUSE_TIMER':
      timerState.isPaused = true;
      stopInterval();
      saveTimerState();
      broadcastTimerUpdate();
      break;
    case 'RESET_TIMER':
      resetTimer();
      break;
    case 'GET_BLOCKLIST':
      sendResponse({ 
        blocklist, 
        deepWorkMode, 
        timerRunning: timerState.isRunning && !timerState.isPaused,
        blockingEnabled
      });
      return true;
    case 'BLOCKLIST_UPDATE':
      blocklist = message.blocklist;
      blockingEnabled = message.blockingEnabled !== undefined ? message.blockingEnabled : blockingEnabled;
      updateContentScripts();
      break;
    case 'DEEP_WORK_TOGGLE':
      deepWorkMode = message.enabled;
      updateContentScripts();
      break;
    case 'CHECK_PERMISSIONS':
      (async () => {
        const hasPermissions = await checkHostPermissions();
        sendResponse({ hasPermissions });
      })();
      return true; // Keep message channel open for async response
    case 'REQUEST_PERMISSIONS':
      (async () => {
        const granted = await requestHostPermissions();
        sendResponse({ granted });
      })();
      return true; // Keep message channel open for async response
  }
});

function resetTimer() {
  timerState = {
    isRunning: false,
    isPaused: false,
    remainingTime: WORK_DURATION,
    mode: 'work',
    pendingBreak: false,
    pendingWork: false
  };
  stopInterval();
  saveTimerState();
  broadcastTimerUpdate();
  updateContentScripts();
}

function broadcastTimerUpdate() {
  chrome.runtime.sendMessage({ type: 'TIMER_UPDATE', state: timerState }).catch(() => {});
}

// --- UTILITIES ---

function playNotificationSound() {
  try {
    const audio = new Audio(chrome.runtime.getURL('ring.mp3')); // References local file
    audio.play().catch(err => console.log('Audio playback failed:', err));
  } catch (err) {
    console.log('Audio creation failed:', err);
  }
}

function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: title,
    message: message,
    priority: 2
  });
}

async function updateContentScripts() {
  const isDeepWorkActive = deepWorkMode && timerState.isRunning && !timerState.isPaused;
  const tabs = await chrome.tabs.query({});
  tabs.forEach(tab => {
    chrome.tabs.sendMessage(tab.id, {
      type: 'BLOCKLIST_UPDATE',
      blocklist,
      deepWorkActive: isDeepWorkActive,
      blockingEnabled
    }).catch(() => {});
  });
}

async function loadState() {
  const result = await chrome.storage.local.get(['timerState', 'deepWorkMode', 'blocklist', 'blockingEnabled']);
  if (result.timerState) {
    timerState = result.timerState;
    if (timerState.isRunning && !timerState.isPaused) {
      startTimer(); // Resume if it was running
    }
  }
  deepWorkMode = result.deepWorkMode || false;
  blocklist = result.blocklist || [];
  blockingEnabled = result.blockingEnabled !== undefined ? result.blockingEnabled : true;
}

async function saveTimerState() {
  await chrome.storage.local.set({ timerState });
}
