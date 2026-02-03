// Background Service Worker
const WORK_DURATION = 25 * 60;
const BREAK_DURATION = 5 * 60;

let timerState = {
  isRunning: false,
  isPaused: false,
  remainingTime: WORK_DURATION,
  mode: 'work'
};

let timerInterval = null;
let deepWorkMode = false;
let blocklist = [];
let blockingEnabled = true;

// Usage tracking
let currentTabId = null;
let currentUrl = null;
let trackingStartTime = null;

// Initialize
chrome.runtime.onInstalled.addListener(async () => {
  console.log('FocusFlow extension installed');
  await loadState();
});

// Load state
async function loadState() {
  const result = await chrome.storage.local.get([
    'timerState',
    'deepWorkMode',
    'blocklist',
    'blockingEnabled'
  ]);
  
  if (result.timerState) {
    timerState = result.timerState;
  }
  deepWorkMode = result.deepWorkMode || false;
  blocklist = result.blocklist || [];
  blockingEnabled = result.blockingEnabled !== undefined ? result.blockingEnabled : true;
}

// Save timer state
async function saveTimerState() {
  await chrome.storage.local.set({ timerState });
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'START_TIMER':
      startTimer();
      break;
    case 'PAUSE_TIMER':
      pauseTimer();
      break;
    case 'RESET_TIMER':
      resetTimer();
      break;
    case 'DEEP_WORK_TOGGLE':
      deepWorkMode = message.enabled;
      updateContentScripts();
      break;
    case 'BLOCKING_TOGGLE':
      blockingEnabled = message.enabled;
      blocklist = message.blocklist || blocklist;
      updateContentScripts();
      break;
    case 'BLOCKLIST_UPDATE':
      blocklist = message.blocklist;
      blockingEnabled = message.blockingEnabled !== undefined ? message.blockingEnabled : blockingEnabled;
      updateContentScripts();
      break;
    case 'GET_BLOCKLIST':
      sendResponse({ 
        blocklist, 
        deepWorkMode, 
        timerRunning: timerState.isRunning && !timerState.isPaused,
        blockingEnabled
      });
      return true;
  }
});

// Timer functions
function startTimer() {
  timerState.isRunning = true;
  timerState.isPaused = false;
  saveTimerState();
  
  if (timerInterval) clearInterval(timerInterval);
  
  timerInterval = setInterval(() => {
    timerState.remainingTime--;
    
    if (timerState.remainingTime <= 0) {
      // Timer complete
      if (timerState.mode === 'work') {
        timerState.mode = 'break';
        timerState.remainingTime = BREAK_DURATION;
        playNotificationSound();
        showNotification('Work Complete!', 'Great job! Time for a 5-minute break 🎉');
      } else {
        timerState.mode = 'work';
        timerState.remainingTime = WORK_DURATION;
        playNotificationSound();
        showNotification('Break Over!', 'Ready for another focused session? 💪');
        timerState.isRunning = false;
        timerState.isPaused = false;
        if (timerInterval) clearInterval(timerInterval);
      }
    }
    
    saveTimerState();
    broadcastTimerUpdate();
  }, 1000);
  
  updateContentScripts();
}

function pauseTimer() {
  timerState.isPaused = true;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  saveTimerState();
  broadcastTimerUpdate();
  updateContentScripts();
}

function resetTimer() {
  timerState.isRunning = false;
  timerState.isPaused = false;
  timerState.mode = 'work';
  timerState.remainingTime = WORK_DURATION;
  
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  
  saveTimerState();
  broadcastTimerUpdate();
  updateContentScripts();
}

function broadcastTimerUpdate() {
  chrome.runtime.sendMessage({ 
    type: 'TIMER_UPDATE', 
    state: timerState 
  }).catch(() => {});
}

// Notification with sound
function playNotificationSound() {
  // Create audio element with notification sound
  const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGK0fPTgjMGHm7A7+OZURE=');
  audio.play().catch(() => {
    // Audio might fail in some browsers, that's okay
  });
}

function showNotification(title, message) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: title,
      message: message,
      priority: 2
    });
  } catch (err) {
    // Notifications might not be available
    console.log('Notification not available');
  }
}

// Update content scripts
async function updateContentScripts() {
  const tabs = await chrome.tabs.query({});
  const isDeepWorkActive = deepWorkMode && timerState.isRunning && !timerState.isPaused;
  
  tabs.forEach(tab => {
    chrome.tabs.sendMessage(tab.id, {
      type: 'BLOCKLIST_UPDATE',
      blocklist,
      deepWorkActive: isDeepWorkActive,
      blockingEnabled
    }).catch(() => {});
  });
}

// Usage Tracking
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await saveCurrentTracking();
  const tab = await chrome.tabs.get(activeInfo.tabId);
  startTracking(tab.id, tab.url);
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
    currentTabId = null;
    currentUrl = null;
    trackingStartTime = null;
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      startTracking(tab.id, tab.url);
    }
  }
});

function startTracking(tabId, url) {
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
    return;
  }
  
  currentTabId = tabId;
  currentUrl = extractDomain(url);
  trackingStartTime = Date.now();
}

async function saveCurrentTracking() {
  if (!currentUrl || !trackingStartTime) return;
  
  const duration = Math.floor((Date.now() - trackingStartTime) / 1000);
  if (duration < 1) return;
  
  const today = new Date().toDateString();
  const result = await chrome.storage.local.get(['usageStats']);
  const usageStats = result.usageStats || {};
  
  if (!usageStats[today]) {
    usageStats[today] = {};
  }
  
  if (!usageStats[today][currentUrl]) {
    usageStats[today][currentUrl] = 0;
  }
  
  usageStats[today][currentUrl] += duration;
  
  await chrome.storage.local.set({ usageStats });
  
  chrome.runtime.sendMessage({ type: 'STATS_UPDATE' }).catch(() => {});
}

function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return 'Unknown';
  }
}

// Periodic save
setInterval(async () => {
  if (trackingStartTime) {
    await saveCurrentTracking();
    startTracking(currentTabId, currentUrl);
  }
}, 10000);

// Initialize
loadState();
