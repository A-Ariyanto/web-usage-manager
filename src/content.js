// Content Script - Website Blocking Overlay
let blocklist = [];
let deepWorkActive = false;
let blockingEnabled = true;
let overlayShown = false;

// Initialize
(async function init() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_BLOCKLIST' });
  blocklist = response.blocklist || [];
  deepWorkActive = response.deepWorkMode && response.timerRunning;
  blockingEnabled = response.blockingEnabled !== undefined ? response.blockingEnabled : true;
  
  checkAndBlock();
})();

// Listen for updates
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'BLOCKLIST_UPDATE') {
    blocklist = message.blocklist;
    deepWorkActive = message.deepWorkActive;
    blockingEnabled = message.blockingEnabled !== undefined ? message.blockingEnabled : true;
    checkAndBlock();
  }
});

// Check if current URL should be blocked
function checkAndBlock() {
  const currentUrl = window.location.hostname.replace(/^www\./, '');
  const isInBlocklist = blocklist.some(blocked => currentUrl.includes(blocked));
  const shouldBlock = blockingEnabled && isInBlocklist;
  
  if (shouldBlock && !overlayShown) {
    showBlockOverlay();
  } else if (!shouldBlock && overlayShown) {
    removeBlockOverlay();
  }
}

// Show blocking overlay
function showBlockOverlay() {
  if (document.getElementById('focusflow-overlay')) return;
  
  const overlay = document.createElement('div');
  overlay.id = 'focusflow-overlay';
  overlay.className = 'focusflow-block-overlay';
  
  const content = document.createElement('div');
  content.className = 'focusflow-block-content';
  
  const icon = document.createElement('div');
  icon.className = 'focusflow-block-icon';
  icon.textContent = '🎯';
  
  const title = document.createElement('h1');
  title.className = 'focusflow-block-title';
  title.textContent = 'Focus Mode Active';
  
  const message = document.createElement('p');
  message.className = 'focusflow-block-message';
  message.textContent = deepWorkActive 
    ? 'This site is blocked during Deep Work Mode. Finish your Pomodoro session first!'
    : 'This site is on your blocklist. Time to focus on what matters!';
  
  const quote = document.createElement('p');
  quote.className = 'focusflow-block-quote';
  const quotes = [
    '"The key is not to prioritize what\'s on your schedule, but to schedule your priorities." - Stephen Covey',
    '"Focus is a matter of deciding what things you\'re not going to do." - John Carmack',
    '"Concentration is the secret of strength." - Ralph Waldo Emerson',
    '"The successful warrior is the average man, with laser-like focus." - Bruce Lee'
  ];
  quote.textContent = quotes[Math.floor(Math.random() * quotes.length)];
  
  content.appendChild(icon);
  content.appendChild(title);
  content.appendChild(message);
  content.appendChild(quote);
  overlay.appendChild(content);
  
  document.body.appendChild(overlay);
  overlayShown = true;
  document.body.style.overflow = 'hidden';
}

// Remove blocking overlay
function removeBlockOverlay() {
  const overlay = document.getElementById('focusflow-overlay');
  if (overlay) {
    overlay.remove();
    overlayShown = false;
    document.body.style.overflow = '';
  }
}

// Monitor URL changes for SPAs
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    checkAndBlock();
  }
}).observe(document, { subtree: true, childList: true });
