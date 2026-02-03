// Popup Controller for FocusFlow
const WORK_DURATION = 25 * 60;
const BREAK_DURATION = 5 * 60;

// DOM Elements
const timerValue = document.getElementById('timer-value');
const timerLabel = document.getElementById('timer-label');
const timerProgress = document.getElementById('timer-progress');
const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');
const resetBtn = document.getElementById('reset-btn');
const deepWorkToggle = document.getElementById('deep-work-toggle');
const blockingEnabled = document.getElementById('blocking-enabled');
const urlInput = document.getElementById('url-input');
const addUrlBtn = document.getElementById('add-url-btn');
const blocklist = document.getElementById('blocklist');
const emptyBlocklist = document.getElementById('empty-blocklist');
const statsList = document.getElementById('stats-list');
const emptyStats = document.getElementById('empty-stats');

// State
let timerState = null;
let blocklistData = [];
let deepWorkMode = false;
let blockingEnabledState = true;
let donutChart = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  setupEventListeners();
  setupTabs();
  renderBlocklist();
  renderStats();
  updateTimerUI();
});

// Load state from storage
async function loadState() {
  const result = await chrome.storage.local.get([
    'timerState',
    'blocklist',
    'deepWorkMode',
    'blockingEnabled'
  ]);
  
  timerState = result.timerState || {
    isRunning: false,
    isPaused: false,
    remainingTime: WORK_DURATION,
    mode: 'work'
  };
  
  blocklistData = result.blocklist || [];
  deepWorkMode = result.deepWorkMode || false;
  blockingEnabledState = result.blockingEnabled !== undefined ? result.blockingEnabled : true;
  
  deepWorkToggle.checked = deepWorkMode;
  blockingEnabled.checked = blockingEnabledState;
}

// Setup event listeners
function setupEventListeners() {
  startBtn.addEventListener('click', startTimer);
  pauseBtn.addEventListener('click', pauseTimer);
  resetBtn.addEventListener('click', resetTimer);
  deepWorkToggle.addEventListener('change', toggleDeepWorkMode);
  blockingEnabled.addEventListener('change', toggleBlocking);
  addUrlBtn.addEventListener('click', addUrl);
  urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addUrl();
  });
  
  // Listen for updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TIMER_UPDATE') {
      timerState = message.state;
      updateTimerUI();
    } else if (message.type === 'STATS_UPDATE') {
      renderStats();
    }
  });
}

// Tab switching
function setupTabs() {
  document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
      const tabName = button.getAttribute('data-tab');
      switchTab(tabName);
    });
  });
}

function switchTab(tabName) {
  // Update buttons
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
  
  // Update content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.getElementById(`${tabName}-tab`).classList.add('active');
  
  // If switching to stats, render chart
  if (tabName === 'stats') {
    setTimeout(() => renderStats(), 100);
  }
}

// Timer functions
async function startTimer() {
  chrome.runtime.sendMessage({ type: 'START_TIMER' });
  startBtn.disabled = true;
  pauseBtn.disabled = false;
}

async function pauseTimer() {
  chrome.runtime.sendMessage({ type: 'PAUSE_TIMER' });
  startBtn.disabled = false;
  pauseBtn.disabled = true;
}

async function resetTimer() {
  chrome.runtime.sendMessage({ type: 'RESET_TIMER' });
  startBtn.disabled = false;
  pauseBtn.disabled = true;
}

function updateTimerUI() {
  if (!timerState) return;
  
  // Update time display
  const minutes = Math.floor(timerState.remainingTime / 60);
  const seconds = timerState.remainingTime % 60;
  timerValue.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  
  // Update mode label
  timerLabel.textContent = timerState.mode === 'work' ? 'WORK' : 'BREAK';
  timerLabel.style.color = timerState.mode === 'work' ? '#10b981' : '#3b82f6';
  
  // Update progress ring
  const totalTime = timerState.mode === 'work' ? WORK_DURATION : BREAK_DURATION;
  const progress = 1 - (timerState.remainingTime / totalTime);
  const circumference = 2 * Math.PI * 75;
  const offset = circumference * (1 - progress);
  timerProgress.style.strokeDashoffset = offset;
  
  // Update button states
  if (timerState.isRunning && !timerState.isPaused) {
    startBtn.disabled = true;
    pauseBtn.disabled = false;
  } else {
    startBtn.disabled = false;
    pauseBtn.disabled = true;
  }
}

// Deep Work Mode
async function toggleDeepWorkMode() {
  deepWorkMode = deepWorkToggle.checked;
  await chrome.storage.local.set({ deepWorkMode });
  chrome.runtime.sendMessage({ type: 'DEEP_WORK_TOGGLE', enabled: deepWorkMode });
  renderBlocklist();
}

// Blocking toggle
async function toggleBlocking() {
  blockingEnabledState = blockingEnabled.checked;
  await chrome.storage.local.set({ blockingEnabled: blockingEnabledState });
  chrome.runtime.sendMessage({ 
    type: 'BLOCKING_TOGGLE', 
    enabled: blockingEnabledState,
    blocklist: blocklistData
  });
}

// Blocklist functions
async function addUrl() {
  const url = urlInput.value.trim().toLowerCase();
  if (!url) return;
  
  const normalized = url.replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/$/, '');
  
  if (blocklistData.includes(normalized)) {
    urlInput.value = '';
    return;
  }
  
  blocklistData.push(normalized);
  await chrome.storage.local.set({ blocklist: blocklistData });
  
  chrome.runtime.sendMessage({ 
    type: 'BLOCKLIST_UPDATE', 
    blocklist: blocklistData,
    blockingEnabled: blockingEnabledState
  });
  
  urlInput.value = '';
  renderBlocklist();
}

async function removeUrl(url) {
  if (deepWorkMode && timerState.isRunning && !timerState.isPaused) {
    alert('Cannot modify blocklist during Deep Work Mode!');
    return;
  }
  
  blocklistData = blocklistData.filter(item => item !== url);
  await chrome.storage.local.set({ blocklist: blocklistData });
  
  chrome.runtime.sendMessage({ 
    type: 'BLOCKLIST_UPDATE', 
    blocklist: blocklistData,
    blockingEnabled: blockingEnabledState
  });
  
  renderBlocklist();
}

function renderBlocklist() {
  blocklist.innerHTML = '';
  
  if (blocklistData.length === 0) {
    blocklist.appendChild(emptyBlocklist);
    return;
  }
  
  const isLocked = deepWorkMode && timerState.isRunning && !timerState.isPaused;
  
  blocklistData.forEach(url => {
    const item = document.createElement('div');
    item.className = `blocklist-item ${isLocked ? 'locked' : ''}`;
    
    const urlSpan = document.createElement('span');
    urlSpan.textContent = url;
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '×';
    removeBtn.onclick = () => removeUrl(url);
    
    if (isLocked) {
      removeBtn.title = 'Locked during Deep Work Mode';
    }
    
    item.appendChild(urlSpan);
    item.appendChild(removeBtn);
    blocklist.appendChild(item);
  });
}

// Stats functions
async function renderStats() {
  const result = await chrome.storage.local.get(['usageStats']);
  const stats = result.usageStats || {};
  
  const today = new Date().toDateString();
  const todayStats = stats[today] || {};
  
  const entries = Object.entries(todayStats);
  
  if (entries.length === 0) {
    statsList.innerHTML = '';
    statsList.appendChild(emptyStats);
    if (donutChart) {
      donutChart.destroy();
      donutChart = null;
    }
    return;
  }
  
  // Calculate total time
  const totalSeconds = entries.reduce((sum, [_, seconds]) => sum + seconds, 0);
  
  // Sort by time
  entries.sort((a, b) => b[1] - a[1]);
  
  // Render donut chart
  renderDonutChart(entries.slice(0, 5), totalSeconds);
  
  // Render list
  statsList.innerHTML = '';
  entries.slice(0, 10).forEach(([url, seconds]) => {
    const item = document.createElement('div');
    item.className = 'stat-item';
    
    const domain = document.createElement('div');
    domain.className = 'stat-domain';
    domain.textContent = url;
    
    const time = document.createElement('div');
    time.className = 'stat-time';
    time.textContent = formatTime(seconds);
    
    item.appendChild(domain);
    item.appendChild(time);
    statsList.appendChild(item);
  });
}

function renderDonutChart(data, totalSeconds) {
  const canvas = document.getElementById('donut-chart');
  const ctx = canvas.getContext('2d');
  
  if (donutChart) {
    donutChart.destroy();
  }
  
  const labels = data.map(([url]) => url);
  const values = data.map(([_, seconds]) => seconds);
  const colors = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'
  ];
  
  donutChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '70%',
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return context.label + ': ' + formatTime(context.parsed);
            }
          }
        }
      }
    },
    plugins: [{
      id: 'centerText',
      beforeDraw: function(chart) {
        const width = chart.width;
        const height = chart.height;
        const ctx = chart.ctx;
        ctx.restore();
        
        const totalTime = formatTime(totalSeconds);
        const fontSize = 28;
        const labelFontSize = 12;
        
        ctx.font = `bold ${fontSize}px -apple-system, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#1e293b';
        
        const text = totalTime;
        const textX = Math.round((width - ctx.measureText(text).width) / 2);
        const textY = height / 2 - 8;
        
        ctx.fillText(text, textX, textY);
        
        ctx.font = `600 ${labelFontSize}px -apple-system, sans-serif`;
        ctx.fillStyle = '#64748b';
        const label = 'Total Time';
        const labelX = Math.round((width - ctx.measureText(label).width) / 2);
        const labelY = height / 2 + 18;
        
        ctx.fillText(label, labelX, labelY);
        ctx.save();
      }
    }]
  });
}

function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}
