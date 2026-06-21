const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("main process enforces secure window, tray lifecycle, trusted IPC, and recovery", async () => {
  const appEvents = {};
  const screenEvents = {};
  const ipcListeners = {};
  const removedChannels = [];
  const engineCalls = [];
  let browserWindow;
  let tray;
  let quitCalls = 0;
  const commandLineSwitches = [];
  let settings = {
    alwaysOnTop: true,
    clickThrough: true,
    startAtLogin: false,
    movementEnabled: true,
    spriteScale: 0.7,
    sleepAfterSeconds: 20,
    showStateLabel: false,
    animationSpeedMultiplier: 1
  };

  const engine = {
    start: () => engineCalls.push("start"),
    stop: () => engineCalls.push("stop"),
    sleep: () => engineCalls.push("sleep"),
    wake: () => engineCalls.push("wake"),
    pet: () => engineCalls.push("pet"),
    interact: () => engineCalls.push("interact"),
    bringBack: () => engineCalls.push("bringBack"),
    ensureOnScreen: () => engineCalls.push("ensure"),
    syncRenderer: () => engineCalls.push("sync"),
    toggleFollowMode: () => engineCalls.push("toggle"),
    setPaused: (value) => engineCalls.push(`paused:${value}`),
    isPaused: () => false,
    isSleeping: () => false,
    isFollowingCursor: () => false
  };

  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.visible = false;
      this.destroyed = false;
      this.events = {};
      this.ignoreMouseCalls = [];
      this.reloadCalls = 0;
      this.webContents = {
        events: {},
        sent: [],
        on: (name, callback) => { this.webContents.events[name] = callback; },
        once: (name, callback) => { this.webContents.events[name] = callback; },
        send: (channel, value) => this.webContents.sent.push({ channel, value })
      };
      browserWindow = this;
    }
    loadFile() { return Promise.resolve(); }
    on(name, callback) { this.events[name] = callback; }
    once(name, callback) { this.events[name] = callback; }
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
    isVisible() { return this.visible; }
    isDestroyed() { return this.destroyed; }
    setAlwaysOnTop(value) { this.alwaysOnTop = value; }
    setIgnoreMouseEvents(...args) { this.ignoreMouseCalls.push(args); }
    reload() { this.reloadCalls += 1; }
  }

  class FakeTray {
    constructor() {
      this.events = {};
      tray = this;
    }
    setToolTip(value) { this.tooltip = value; }
    on(name, callback) { this.events[name] = callback; }
    setContextMenu(value) { this.menu = value; }
  }

  const electron = {
    app: {
      commandLine: {
        appendSwitch: (name, value) => commandLineSwitches.push({ name, value })
      },
      requestSingleInstanceLock: () => true,
      on: (name, callback) => { appEvents[name] = callback; },
      whenReady: () => Promise.resolve(),
      getPath: () => "unused",
      setLoginItemSettings: (value) => { electron.app.loginSettings = value; },
      quit: () => { quitCalls += 1; }
    },
    BrowserWindow: FakeBrowserWindow,
    Menu: { buildFromTemplate: (template) => template },
    Tray: FakeTray,
    nativeImage: {
      createFromPath: () => ({ resize: () => ({}) })
    },
    screen: {
      getCursorScreenPoint: () => ({ x: 500, y: 500 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      on: (name, callback) => { screenEvents[name] = callback; }
    },
    ipcMain: {
      on: (channel, callback) => { ipcListeners[channel] = callback; },
      removeAllListeners: (channel) => removedChannels.push(channel)
    }
  };

  const context = {
    console,
    __dirname: path.join(__dirname, "..", "src"),
    process: { execPath: "Virtual Cat.exe", defaultApp: false, argv: ["Virtual Cat.exe"] },
    require(request) {
      if (request === "electron") return electron;
      if (request === "path") return path;
      if (request === "./main/settings") {
        return {
          createSettingsStore: () => ({
            load: () => ({ ...settings }),
            get: () => ({ ...settings }),
            set: (key, value) => {
              settings = { ...settings, [key]: value };
              return { ...settings };
            }
          })
        };
      }
      if (request === "./main/petEngine") return { createPetEngine: () => engine };
      throw new Error(`Unexpected require: ${request}`);
    }
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8"),
    context,
    { filename: "main.js" }
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(browserWindow.options.width, 200);
  assert.equal(browserWindow.options.height, 200);
  assert.equal(browserWindow.options.transparent, true);
  assert.equal(browserWindow.options.frame, false);
  assert.equal(browserWindow.options.resizable, false);
  assert.equal(browserWindow.options.skipTaskbar, true);
  assert.deepEqual(
    {
      contextIsolation: browserWindow.options.webPreferences.contextIsolation,
      nodeIntegration: browserWindow.options.webPreferences.nodeIntegration,
      sandbox: browserWindow.options.webPreferences.sandbox
    },
    { contextIsolation: true, nodeIntegration: false, sandbox: true }
  );
  assert.deepEqual(commandLineSwitches, [
    { name: "force-device-scale-factor", value: "1" }
  ]);

  browserWindow.webContents.events["did-finish-load"]();
  assert.ok(engineCalls.includes("start"));
  browserWindow.events["ready-to-show"]();
  assert.equal(browserWindow.visible, true);
  let prevented = false;
  browserWindow.events.close({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(browserWindow.visible, false);

  const item = (label) => tray.menu.find((entry) => entry.label === label);
  item("Show Cat").click();
  assert.equal(browserWindow.visible, true);
  item("Bring Cat Back").click();
  item("Pause").click();
  item("Put to Sleep").click();
  item("Wake Up").click();
  assert.ok(engineCalls.includes("bringBack"));
  assert.ok(engineCalls.includes("paused:true"));
  assert.ok(engineCalls.includes("sleep"));
  assert.ok(engineCalls.includes("wake"));

  ipcListeners["pet-interaction"]({ sender: {} });
  assert.equal(engineCalls.filter((value) => value === "interact").length, 0);
  ipcListeners["pet-interaction"]({ sender: browserWindow.webContents });
  ipcListeners["petting-detected"]({ sender: browserWindow.webContents });
  ipcListeners["toggle-follow-mode"]({ sender: browserWindow.webContents });
  assert.ok(engineCalls.includes("interact"));
  assert.ok(engineCalls.includes("pet"));
  assert.ok(engineCalls.includes("toggle"));

  browserWindow.webContents.events["render-process-gone"]({}, { reason: "crashed" });
  assert.equal(browserWindow.reloadCalls, 1);
  browserWindow.webContents.events["did-finish-load"]();
  assert.ok(engineCalls.includes("sync"));
  assert.ok(engineCalls.includes("ensure"));

  appEvents["second-instance"]();
  assert.equal(browserWindow.visible, true);
  screenEvents["display-removed"]();
  assert.ok(engineCalls.filter((value) => value === "bringBack").length >= 2);

  item("Quit").click();
  assert.equal(quitCalls, 1);
  appEvents["before-quit"]();
  assert.ok(engineCalls.includes("stop"));
  assert.deepEqual(removedChannels.sort(), [
    "pet-hover-changed",
    "pet-interaction",
    "petting-detected",
    "toggle-follow-mode"
  ]);
});
