const { app, BrowserWindow, Menu, Tray, nativeImage, screen, ipcMain } = require("electron");
const path = require("path");
const { createSettingsStore } = require("./main/settings");
const { createPetEngine } = require("./main/petEngine");

const WINDOW_SIZE = 200;
let catWindow = null;
let tray = null;
let petEngine = null;
let settingsStore = null;
let isQuitting = false;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function createCatWindow(settings) {
  const cursor = screen.getCursorScreenPoint();
  catWindow = new BrowserWindow({
    width: WINDOW_SIZE,
    height: WINDOW_SIZE,
    x: cursor.x - WINDOW_SIZE / 2,
    y: cursor.y - WINDOW_SIZE / 2,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: settings.alwaysOnTop,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  catWindow.loadFile(path.join(__dirname, "index.html"));
  applyClickThrough(settings.clickThrough);
  catWindow.once("ready-to-show", () => catWindow.showInactive());
  catWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      catWindow.hide();
      rebuildTrayMenu();
    }
  });
}

function createTray() {
  const spritePath = path.join(__dirname, "assets", "cat", "cat-spritesheet.png");
  const trayImage = nativeImage.createFromPath(spritePath).resize({ width: 16, height: 16 });
  tray = new Tray(trayImage);
  tray.setToolTip("Virtual Cat");
  tray.on("double-click", showCat);
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray || !settingsStore || !petEngine) return;
  const settings = settingsStore.get();
  const paused = petEngine.isPaused();
  const sleeping = petEngine.isSleeping();
  const followingCursor = petEngine.isFollowingCursor();

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show Cat", enabled: !catWindow?.isVisible(), click: showCat },
    { label: "Bring Cat Back", click: () => { petEngine.bringBack(); showCat(); } },
    { label: "Hide Cat", enabled: Boolean(catWindow?.isVisible()), click: () => { catWindow?.hide(); rebuildTrayMenu(); } },
    { type: "separator" },
    { label: paused ? "Resume" : "Pause", click: () => { petEngine.setPaused(!paused); rebuildTrayMenu(); } },
    { label: followingCursor ? "Mode: Following Cursor" : "Mode: Roaming Freely", enabled: false },
    { label: "Put to Sleep", enabled: !sleeping, click: () => petEngine.sleep() },
    { label: "Wake Up", enabled: sleeping, click: () => petEngine.wake() },
    { type: "separator" },
    toggleItem("Always On Top", settings.alwaysOnTop, (value) => {
      updateSetting("alwaysOnTop", value);
      catWindow?.setAlwaysOnTop(value);
    }),
    toggleItem("Click Through", settings.clickThrough, (value) => {
      updateSetting("clickThrough", value);
      applyClickThrough(value);
    }),
    toggleItem("Start at Login", settings.startAtLogin, (value) => {
      updateSetting("startAtLogin", value);
      setStartAtLogin(value);
    }),
    { type: "separator" },
    { label: "Quit", click: () => { isQuitting = true; app.quit(); } }
  ]));
}

function toggleItem(label, checked, onChange) {
  return { label, type: "checkbox", checked, click: (item) => { onChange(item.checked); rebuildTrayMenu(); } };
}

function updateSetting(key, value) {
  const settings = settingsStore.set(key, value);
  catWindow?.webContents.send("settings-changed", settings);
}

function applyClickThrough(enabled) {
  if (catWindow && !catWindow.isDestroyed()) {
    catWindow.setIgnoreMouseEvents(enabled, enabled ? { forward: true } : undefined);
  }
}

function setCatHovering(isHovering) {
  if (!catWindow || catWindow.isDestroyed() || !settingsStore.get().clickThrough) return;
  catWindow.setIgnoreMouseEvents(!isHovering, isHovering ? undefined : { forward: true });
}

function setStartAtLogin(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: process.defaultApp ? [path.resolve(process.argv[1])] : []
  });
}

function showCat() {
  if (!catWindow || catWindow.isDestroyed()) return;
  petEngine?.ensureOnScreen();
  catWindow.showInactive();
  rebuildTrayMenu();
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
app.on("second-instance", () => {
  petEngine?.bringBack();
  showCat();
});

app.whenReady().then(() => {
  settingsStore = createSettingsStore(app.getPath("userData"));
  const settings = settingsStore.load();
  setStartAtLogin(settings.startAtLogin);
  createCatWindow(settings);
  petEngine = createPetEngine({
    window: catWindow,
    screen,
    windowSize: WINDOW_SIZE,
    getSettings: () => settingsStore.get(),
    onSleepChanged: rebuildTrayMenu
  });

  ipcMain.on("pet-hover-changed", (event, isHovering) => {
    if (event.sender === catWindow.webContents && typeof isHovering === "boolean") {
      setCatHovering(isHovering);
    }
  });

  ipcMain.on("toggle-follow-mode", (event) => {
    if (event.sender === catWindow.webContents) {
      petEngine.toggleFollowMode();
      setCatHovering(false);
      rebuildTrayMenu();
    }
  });

  catWindow.webContents.once("did-finish-load", () => {
    catWindow.webContents.send("settings-changed", settingsStore.get());
    petEngine.start();
  });
  createTray();

  screen.on("display-removed", () => petEngine?.bringBack());
  screen.on("display-added", () => petEngine?.ensureOnScreen());
  screen.on("display-metrics-changed", () => petEngine?.ensureOnScreen());
});
}

app.on("activate", showCat);
app.on("window-all-closed", () => {});
app.on("before-quit", () => {
  isQuitting = true;
  petEngine?.stop();
});
