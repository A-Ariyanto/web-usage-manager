# FocusFlow - Safari Web Extension v2.0

A horizontal-layout Safari Web Extension (600×350px) combining Pomodoro timer, website blocking, and usage analytics with beautiful donut chart visualization.

## 🌟 Features

### ⏱️ Pomodoro Timer

- 25-minute work sessions / 5-minute breaks
- Large circular progress indicator
- **Notification sound** when timer completes
- Start/Pause/Reset controls
- Persistent across browser sessions
- Deep Work Mode integration

### 🚫 Website Blocker

- Add/remove URLs to blocklist
- **Enable/Disable toggle** for quick blocking control
- Full-screen focus overlay on blocked sites
- Motivational quotes
- Deep Work Mode locks blocklist during active timer

### 📊 Usage Statistics

- **Donut chart visualization** with Chart.js
- **Total focused time** displayed in chart center
- Top 10 domains breakdown
- Daily tracking with automatic reset
- Privacy-first: all data stored locally

### 🎯 Deep Work Mode

- Locks blocklist during Pomodoro sessions
- Strict enforcement with visual feedback
- Cannot modify blocklist while timer active

## 📐 Layout

**Dimensions:** 600px × 350px (horizontal orientation)

The extension features a modern glassmorphism design optimized for desktop use:

- Tab navigation at top
- Side-by-side content layout
- Ample white space
- Smooth animations

## 🚀 Installation

### Enable Safari Developer Mode

1. Open Safari → **Preferences** → **Advanced**
2. Check **"Show Develop menu in menu bar"**

### Load Extension

1. **Develop** → **Show Extension Builder**
2. Click **+** → **Add Extension**
3. Select folder: `/Users/abdullahariyanto/Documents/Projects/safari-web-blocker`
4. Click **Run** or **Install**

### Grant Permissions

Allow all requested permissions:

- Storage (settings & data)
- Tabs (usage tracking)
- Notifications (timer alerts)

## 💻 Usage

### Timer Tab

- Click **Start** to begin 25-minute session
- Toggle **Deep Work Mode** before starting
- **Sound notification** plays when complete
- Automatically switches to break mode

### Blocker Tab

- Use **Blocking Enabled** toggle to turn feature on/off
- Enter domain (e.g., `youtube.com`) and click **Add Site**
- Remove sites with **×** button (disabled during Deep Work)

### Stats Tab

- View **donut chart** showing time distribution
- **Total time** displays in chart center
- Scrollable list shows top 10 domains
- Updates in real-time

## 🎵 Notification Sound

Timer completion triggers:

1. System notification
2. **Sound alert** (base64-encoded wav)

Sound plays automatically when work/break sessions complete.

## 📁 File Structure

```
safari-web-blocker/
├── manifest.json         # Manifest V3 config (v2.0.0)
├── popup.html           # Horizontal layout (600×350px)
├── style.css            # Glassmorphism styling
├── popup.js             # Chart.js integration
├── background.js        # Timer, tracking, notifications
├── content.js           # Blocking overlay
├── content.css          # Overlay styles
├── icons/               # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## 🔧 Technical Details

- **Manifest:** V3 (Safari compatible)
- **Chart Library:** Chart.js 4.4.0 (CDN)
- **Storage:** `chrome.storage.local`
- **Notifications:** Chrome Notifications API
- **Sound:** Base64-encoded WAV

## 🎨 Design

- **Theme:** Purple/indigo gradient
- **Style:** Apple-like minimalism with glassmorphism
- **Layout:** Horizontal tab-based navigation
- **Animations:** Smooth fade-in transitions

## 🔐 Privacy

100% local storage. No external servers. No data collection.

- Blocklist saved locally
- Timer state persisted
- Usage stats private

## 🆕 What's New in v2.0

✅ Horizontal 600×350px layout  
✅ Donut chart with total time in center  
✅ Notification sound on timer complete  
✅ Blocking enable/disable toggle  
✅ Improved glassmorphism UI  
✅ Better space utilization

## 📝 License

MIT License - modify and extend freely!

---

**Enjoy focused productivity! 🎯**
