// Popup Controller for FocusFlow v2.1
const WORK_DURATION = 25 * 60;
const BREAK_DURATION = 5 * 60;

// DOM Elements - Timer
const timerValue = document.getElementById("timer-value");
const timerLabel = document.getElementById("timer-label");
const timerProgress = document.getElementById("timer-progress");
const startBtn = document.getElementById("start-btn");
const pauseBtn = document.getElementById("pause-btn");
const resetBtn = document.getElementById("reset-btn");
const resetBtn2 = document.getElementById("reset-btn-2");
const timerControls = document.getElementById("timer-controls");
const pendingControls = document.getElementById("pending-controls");
const startBreakBtn = document.getElementById("start-break-btn");
const startWorkBtn = document.getElementById("start-work-btn");
const completionMessage = document.getElementById("completion-message");
const completionText = document.getElementById("completion-text");

// DOM Elements - Other
const deepWorkToggle = document.getElementById("deep-work-toggle");
const blockingEnabled = document.getElementById("blocking-enabled");
const urlInput = document.getElementById("url-input");
const addUrlBtn = document.getElementById("add-url-btn");
const blocklist = document.getElementById("blocklist");
const emptyBlocklist = document.getElementById("empty-blocklist");
const statsList = document.getElementById("stats-list");
const emptyStats = document.getElementById("empty-stats");
const permissionPrompt = document.getElementById("permission-prompt");
const grantPermissionsBtn = document.getElementById("grant-permissions-btn");

// DOM Elements - Tasks
const taskNameInput = document.getElementById("task-name-input");
const taskGoalInput = document.getElementById("task-goal-input");
const addTaskBtn = document.getElementById("add-task-btn");
const taskList = document.getElementById("task-list");
const activeTaskDisplay = document.getElementById("active-task-display");
const taskNameDisplay = document.getElementById("task-name");
const taskProgressDisplay = document.getElementById("task-progress");

// DOM Elements - Duration Picker
const durationButtons = document.querySelectorAll(".duration-btn");
const customDurationInput = document.getElementById("custom-duration-input");

// State
let timerState = null;
let blocklistData = [];
let deepWorkMode = false;
let blockingEnabledState = true;
let hasPermissions = false;
let tasks = []; // Store tasks from Firebase
let activeTaskId = null; // Currently selected task
let workDuration = 25 * 60; // Default 25 minutes in seconds

// Initialize
document.addEventListener("DOMContentLoaded", async () => {
  await loadState();
  setupEventListeners();
  setupTabs();
  renderBlocklist();
  renderStats();
  updateTimerUI();
  checkPermissions();
  await loadTasks(); // Load tasks from Firebase
});

// Load state from storage
async function loadState() {
  const result = await chrome.storage.local.get([
    "timerState",
    "blocklist",
    "deepWorkMode",
    "blockingEnabled",
  ]);

  timerState = result.timerState || {
    isRunning: false,
    isPaused: false,
    remainingTime: WORK_DURATION,
    mode: "work",
    pendingBreak: false,
    pendingWork: false,
  };

  blocklistData = result.blocklist || [];
  deepWorkMode = result.deepWorkMode || false;
  blockingEnabledState =
    result.blockingEnabled !== undefined ? result.blockingEnabled : true;

  deepWorkToggle.checked = deepWorkMode;
  blockingEnabled.checked = blockingEnabledState;
}

// Check permissions
async function checkPermissions() {
  const response = await chrome.runtime.sendMessage({
    type: "CHECK_PERMISSIONS",
  });
  hasPermissions = response?.hasPermissions || false;
  updatePermissionUI();
}

function updatePermissionUI() {
  if (!hasPermissions) {
    permissionPrompt.style.display = "flex";
    document.getElementById("donut-chart").style.display = "none";
  } else {
    permissionPrompt.style.display = "none";
    document.getElementById("donut-chart").style.display = "block";
  }
}

// Setup event listeners
function setupEventListeners() {
  startBtn.addEventListener("click", startTimer);
  pauseBtn.addEventListener("click", pauseTimer);
  resetBtn.addEventListener("click", resetTimer);
  document.getElementById("reset-btn-2").addEventListener("click", resetTimer);
  document
    .getElementById("start-break-btn")
    .addEventListener("click", () =>
      chrome.runtime.sendMessage({ type: "ACCEPT_BREAK" }),
    );
  document
    .getElementById("start-work-btn")
    .addEventListener("click", () =>
      chrome.runtime.sendMessage({ type: "ACCEPT_WORK" }),
    );
  deepWorkToggle.addEventListener("change", toggleDeepWorkMode);
  blockingEnabled.addEventListener("change", toggleBlocking);
  addUrlBtn.addEventListener("click", addUrl);
  grantPermissionsBtn.addEventListener("click", requestPermissions);
  addTaskBtn.addEventListener("click", addTask);

  // Duration picker listeners
  durationButtons.forEach((btn) => {
    btn.addEventListener("click", () =>
      changeDuration(parseInt(btn.dataset.duration)),
    );
  });

  customDurationInput.addEventListener("change", () => {
    const customMinutes = parseInt(customDurationInput.value);
    if (customMinutes && customMinutes > 0 && customMinutes <= 120) {
      changeDuration(customMinutes);
    }
  });

  taskNameInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") addTask();
  });

  urlInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") addUrl();
  });

  // Listen for updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "TIMER_UPDATE") {
      timerState = message.state;
      updateTimerUI();
      updateActiveTaskDisplay(); // Update task progress display
    } else if (message.type === "STATS_UPDATE") {
      // Re-render stats in real-time when background saves tracking data
      renderStats();
    } else if (message.type === "PERMISSIONS_STATUS") {
      hasPermissions = message.hasPermissions;
      updatePermissionUI();
      if (hasPermissions) {
        renderStats();
      }
    } else if (message.type === "TASKS_UPDATE") {
      // Real-time tasks update from Firebase
      tasks = message.tasks || [];
      renderTasks();
      updateActiveTaskDisplay();
    }
  });

  // Auto-refresh stats every 5 seconds while popup is open (smart batching handles real-time)
  setInterval(() => {
    const activeTab = document.querySelector(".tab-button.active");
    if (activeTab && activeTab.getAttribute("data-tab") === "stats") {
      renderStats();
    }
  }, 5000);
}

// Permission request
async function requestPermissions() {
  const response = await chrome.runtime.sendMessage({
    type: "REQUEST_PERMISSIONS",
  });
  if (response?.granted) {
    hasPermissions = true;
    updatePermissionUI();
    renderStats();
  }
}

// Tab switching
function setupTabs() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      const tabName = button.getAttribute("data-tab");
      switchTab(tabName);
    });
  });
}

function switchTab(tabName) {
  // Update buttons
  document.querySelectorAll(".tab-button").forEach((btn) => {
    btn.classList.remove("active");
  });
  document.querySelector(`[data-tab="${tabName}"]`).classList.add("active");

  // Update content
  document.querySelectorAll(".tab-content").forEach((content) => {
    content.classList.remove("active");
  });
  document.getElementById(`${tabName}-tab`).classList.add("active");

  // If switching to stats, render chart
  if (tabName === "stats") {
    setTimeout(() => renderStats(), 100);
  }
}

// Timer functions - MANUAL mode
async function startTimer() {
  chrome.runtime.sendMessage({ type: "START_TIMER" });
}

async function startBreak() {
  chrome.runtime.sendMessage({ type: "START_BREAK" });
}

async function startWork() {
  chrome.runtime.sendMessage({ type: "START_WORK" });
}

async function pauseTimer() {
  chrome.runtime.sendMessage({ type: "PAUSE_TIMER" });
}

async function resetTimer() {
  chrome.runtime.sendMessage({ type: "RESET_TIMER" });
}

function updateTimerUI() {
  if (!timerState) return;

  // Update time display
  const minutes = Math.floor(timerState.remainingTime / 60);
  const seconds = timerState.remainingTime % 60;
  timerValue.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  // Update mode label
  timerLabel.textContent = timerState.mode === "work" ? "WORK" : "BREAK";
  timerLabel.style.color = timerState.mode === "work" ? "#10b981" : "#3b82f6";

  // Update progress ring
  const totalTime = timerState.mode === "work" ? WORK_DURATION : BREAK_DURATION;
  const progress = 1 - timerState.remainingTime / totalTime;
  const circumference = 2 * Math.PI * 75;
  const offset = circumference * (1 - progress);
  timerProgress.style.strokeDashoffset = offset;

  // Update buttons based on state
  if (timerState.pendingBreak) {
    // Show "Start Break" button
    timerControls.style.display = "none";
    pendingControls.style.display = "flex";
    startBreakBtn.style.display = "block";
    startWorkBtn.style.display = "none";
    completionMessage.style.display = "block";
    completionText.textContent = "Work session complete! Take a break 🧘";
  } else if (timerState.pendingWork) {
    // Show "Start Focus Session" button
    timerControls.style.display = "none";
    pendingControls.style.display = "flex";
    startBreakBtn.style.display = "none";
    startWorkBtn.style.display = "block";
    completionMessage.style.display = "block";
    completionText.textContent = "Break complete! Ready to focus 💪";
  } else {
    // Normal controls
    timerControls.style.display = "flex";
    pendingControls.style.display = "none";
    completionMessage.style.display = "none";

    if (timerState.isRunning && !timerState.isPaused) {
      startBtn.disabled = true;
      pauseBtn.disabled = false;
    } else {
      startBtn.disabled = false;
      pauseBtn.disabled = true;
    }
  }
}

// Deep Work Mode
async function toggleDeepWorkMode() {
  deepWorkMode = deepWorkToggle.checked;
  await chrome.storage.local.set({ deepWorkMode });
  chrome.runtime.sendMessage({
    type: "DEEP_WORK_TOGGLE",
    enabled: deepWorkMode,
  });
  renderBlocklist();
}

// Blocking toggle
async function toggleBlocking() {
  blockingEnabledState = blockingEnabled.checked;
  await chrome.storage.local.set({ blockingEnabled: blockingEnabledState });
  chrome.runtime.sendMessage({
    type: "BLOCKING_TOGGLE",
    enabled: blockingEnabledState,
    blocklist: blocklistData,
  });
}

// Blocklist functions
async function addUrl() {
  const url = urlInput.value.trim().toLowerCase();
  if (!url) return;

  const normalized = url
    .replace(/^(https?:\/\/)?(www\.)?/, "")
    .replace(/\/$/, "");

  if (blocklistData.includes(normalized)) {
    urlInput.value = "";
    return;
  }

  blocklistData.push(normalized);
  await chrome.storage.local.set({ blocklist: blocklistData });

  chrome.runtime.sendMessage({
    type: "BLOCKLIST_UPDATE",
    blocklist: blocklistData,
    blockingEnabled: blockingEnabledState,
  });

  urlInput.value = "";
  renderBlocklist();
}

async function removeUrl(url) {
  if (deepWorkMode && timerState.isRunning && !timerState.isPaused) {
    alert("Cannot modify blocklist during Deep Work Mode!");
    return;
  }

  blocklistData = blocklistData.filter((item) => item !== url);
  await chrome.storage.local.set({ blocklist: blocklistData });

  chrome.runtime.sendMessage({
    type: "BLOCKLIST_UPDATE",
    blocklist: blocklistData,
    blockingEnabled: blockingEnabledState,
  });

  renderBlocklist();
}

function renderBlocklist() {
  blocklist.innerHTML = "";

  if (blocklistData.length === 0) {
    blocklist.appendChild(emptyBlocklist);
    return;
  }

  const isLocked = deepWorkMode && timerState.isRunning && !timerState.isPaused;

  blocklistData.forEach((url) => {
    const item = document.createElement("div");
    item.className = `blocklist-item ${isLocked ? "locked" : ""}`;

    const urlSpan = document.createElement("span");
    urlSpan.textContent = url;

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.textContent = "×";
    removeBtn.onclick = () => removeUrl(url);

    if (isLocked) {
      removeBtn.title = "Locked during Deep Work Mode";
    }

    item.appendChild(urlSpan);
    item.appendChild(removeBtn);
    blocklist.appendChild(item);
  });
}

// Stats functions with SVG donut chart
async function renderStats() {
  if (!hasPermissions) {
    statsList.innerHTML = "";
    statsList.appendChild(emptyStats);
    return;
  }

  const result = await chrome.storage.local.get([
    "usageStats",
    "totalFocusedTime",
  ]);
  const stats = result.usageStats || {};
  const totalFocusedTime = result.totalFocusedTime || 0;

  const today = new Date().toDateString();
  const todayStats = stats[today] || {};

  const entries = Object.entries(todayStats);

  if (entries.length === 0) {
    statsList.innerHTML = "";
    statsList.appendChild(emptyStats);
    clearDonutChart();
    return;
  }

  // Calculate total time for today
  const totalSeconds = entries.reduce((sum, [_, seconds]) => sum + seconds, 0);

  // Sort by time
  entries.sort((a, b) => b[1] - a[1]);

  // Render SVG donut chart
  renderSVGDonutChart(entries.slice(0, 5), totalSeconds);

  // Render list
  statsList.innerHTML = "";
  entries.slice(0, 10).forEach(([url, seconds]) => {
    const item = document.createElement("div");
    item.className = "stat-item";

    const domain = document.createElement("div");
    domain.className = "stat-domain";
    domain.textContent = url;

    const time = document.createElement("div");
    time.className = "stat-time";
    time.textContent = formatTime(seconds);

    item.appendChild(domain);
    item.appendChild(time);
    statsList.appendChild(item);
  });
}

// SVG Donut Chart Renderer
function renderSVGDonutChart(data, totalSeconds) {
  const svg = document.getElementById("donut-chart");
  const segmentsGroup = document.getElementById("donut-segments");
  const totalTimeValue = document.getElementById("total-time-value");
  const totalTimeLabel = document.getElementById("total-time-label");

  // Clear previous segments
  segmentsGroup.innerHTML = "";

  // Update center text
  totalTimeValue.textContent = formatTime(totalSeconds);
  totalTimeLabel.textContent = "Total Time";

  if (data.length === 0) return;

  // Chart properties
  const centerX = 140;
  const centerY = 140;
  const radius = 100;
  const strokeWidth = 35;
  const colors = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981"];

  let currentAngle = -90; // Start from top

  data.forEach(([url, seconds], index) => {
    const percentage = seconds / totalSeconds;
    const angleSize = percentage * 360;

    const startAngle = currentAngle;
    const endAngle = currentAngle + angleSize;

    const path = describeArc(centerX, centerY, radius, startAngle, endAngle);

    const pathElement = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    pathElement.setAttribute("d", path);
    pathElement.setAttribute("fill", "none");
    pathElement.setAttribute("stroke", colors[index % colors.length]);
    pathElement.setAttribute("stroke-width", strokeWidth);
    pathElement.setAttribute("class", "donut-segment");

    // Add tooltip
    const title = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "title",
    );
    title.textContent = `${url}: ${formatTime(seconds)}`;
    pathElement.appendChild(title);

    segmentsGroup.appendChild(pathElement);

    currentAngle = endAngle;
  });
}

// Helper function to create SVG arc path
function describeArc(x, y, radius, startAngle, endAngle) {
  const start = polarToCartesian(x, y, radius, endAngle);
  const end = polarToCartesian(x, y, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    "M",
    start.x,
    start.y,
    "A",
    radius,
    radius,
    0,
    largeArcFlag,
    0,
    end.x,
    end.y,
  ].join(" ");
}

function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function clearDonutChart() {
  const segmentsGroup = document.getElementById("donut-segments");
  const totalTimeValue = document.getElementById("total-time-value");

  segmentsGroup.innerHTML = "";
  totalTimeValue.textContent = "0h 0m";
}

function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

// ===== DURATION PICKER FUNCTIONS =====

// Change timer duration
async function changeDuration(minutes) {
  // Don't allow changing duration while timer is running
  if (timerState?.isRunning && !timerState?.isPaused) {
    alert(
      "Cannot change duration while timer is running. Please pause or reset first.",
    );
    return;
  }

  workDuration = minutes * 60;

  // Update active button state
  durationButtons.forEach((btn) => {
    btn.classList.remove("active");
    if (parseInt(btn.dataset.duration) === minutes) {
      btn.classList.add("active");
    }
  });

  // Clear custom input if preset button was clicked
  if ([25, 15, 5].includes(minutes)) {
    customDurationInput.value = "";
  }

  // Send new duration to background
  await chrome.runtime.sendMessage({
    type: "SET_WORK_DURATION",
    duration: workDuration,
  });

  // Update display if timer is reset or not started
  if (!timerState?.isRunning) {
    updateTimerDisplay(workDuration, "WORK");
  }
}

// ===== TASK MANAGEMENT FUNCTIONS =====

// Load tasks from Firebase via background
async function loadTasks() {
  const response = await chrome.runtime.sendMessage({ type: "GET_TASKS" });
  tasks = response?.tasks || [];
  renderTasks();
  updateActiveTaskDisplay();
}

// Add a new task
async function addTask() {
  const name = taskNameInput.value.trim();
  const goal = parseInt(taskGoalInput.value);

  if (!name || !goal || goal < 1) {
    alert("Please enter a task name and a goal greater than 0");
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "CREATE_TASK",
    name,
    targetGoal: goal,
  });

  if (response?.success) {
    taskNameInput.value = "";
    taskGoalInput.value = "10";
    await loadTasks(); // Reload tasks
  } else {
    alert("Failed to create task. Make sure you are connected to Firebase.");
  }
}

// Select a task as active
async function selectTask(taskId) {
  activeTaskId = taskId;
  await chrome.runtime.sendMessage({
    type: "SET_ACTIVE_TASK",
    taskId,
  });
  renderTasks();
  updateActiveTaskDisplay();
}

// Delete a task
async function deleteTask(taskId) {
  if (!confirm("Delete this task?")) return;

  const response = await chrome.runtime.sendMessage({
    type: "DELETE_TASK",
    taskId,
  });

  if (response?.success) {
    // If deleted task was active, clear active task
    if (activeTaskId === taskId) {
      activeTaskId = null;
      await chrome.runtime.sendMessage({
        type: "SET_ACTIVE_TASK",
        taskId: null,
      });
    }
    await loadTasks();
  }
}

// Render task list
function renderTasks() {
  taskList.innerHTML = "";

  if (tasks.length === 0) {
    const emptyMsg = document.createElement("div");
    emptyMsg.className = "empty-tasks";
    emptyMsg.textContent = "✨ Add a task to track your Pomodoros";
    taskList.appendChild(emptyMsg);
    return;
  }

  tasks.forEach((task) => {
    const taskItem = document.createElement("div");
    taskItem.className = `task-item ${task.id === (timerState?.activeTaskId || activeTaskId) ? "active" : ""}`;

    // Task name and progress
    const taskInfo = document.createElement("div");
    taskInfo.className = "task-info";
    taskInfo.onclick = () => selectTask(task.id);

    const taskName = document.createElement("span");
    taskName.className = "task-item-name";
    taskName.textContent = task.name;

    const taskProgress = document.createElement("span");
    taskProgress.className = "task-item-progress";
    taskProgress.textContent = `${task.completed || 0}/${task.targetGoal}`;

    // Completion indicator
    if (task.completed >= task.targetGoal) {
      taskProgress.textContent += " ✅";
      taskItem.classList.add("completed");
    }

    taskInfo.appendChild(taskName);
    taskInfo.appendChild(taskProgress);

    // Delete button
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "task-delete-btn";
    deleteBtn.textContent = "×";
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      deleteTask(task.id);
    };

    taskItem.appendChild(taskInfo);
    taskItem.appendChild(deleteBtn);
    taskList.appendChild(taskItem);
  });
}

// Update active task display in timer view
function updateActiveTaskDisplay() {
  const currentActiveId = timerState?.activeTaskId || activeTaskId;
  const activeTask = tasks.find((t) => t.id === currentActiveId);

  if (activeTask) {
    taskNameDisplay.textContent = activeTask.name;
    taskProgressDisplay.textContent = `${activeTask.completed || 0}/${activeTask.targetGoal}`;
    activeTaskDisplay.classList.add("has-task");
  } else {
    taskNameDisplay.textContent = "No task selected";
    taskProgressDisplay.textContent = "0/0";
    activeTaskDisplay.classList.remove("has-task");
  }
}
