const { app, BrowserWindow, screen } = require("electron");
const path = require("path");

let catWindow = null;

const WINDOW_WIDTH = 200;
const WINDOW_HEIGHT = 200;

const CAT_OFFSET_X = 80;
const CAT_OFFSET_Y = 80;

const PET_STATES = {
  IDLE: "idle",
  WALKING: "walking",
  RUNNING: "running"
};

let currentX = 300;
let currentY = 300;

let currentState = PET_STATES.IDLE;
let lastSentState = null;

function createCatWindow() {
  catWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: currentX,
    y: currentY,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  catWindow.loadFile(path.join(__dirname, "index.html"));

  catWindow.setIgnoreMouseEvents(true, { forward: true });

  catWindow.webContents.once("did-finish-load", () => {
    sendPetState(PET_STATES.IDLE);
  });

  startFollowingMouse();
}

function startFollowingMouse() {
  setInterval(() => {
    if (!catWindow || catWindow.isDestroyed()) {
      return;
    }

    const cursor = screen.getCursorScreenPoint();

    const targetX = cursor.x - CAT_OFFSET_X;
    const targetY = cursor.y - CAT_OFFSET_Y;

    const distance = getDistance(currentX, currentY, targetX, targetY);

    currentState = getPetStateFromDistance(distance);

    const speed = getMovementSpeed(currentState);

    currentX = currentX + (targetX - currentX) * speed;
    currentY = currentY + (targetY - currentY) * speed;

    catWindow.setPosition(Math.round(currentX), Math.round(currentY));

    sendPetState(currentState);
  }, 16);
}

function getDistance(x1, y1, x2, y2) {
  const deltaX = x2 - x1;
  const deltaY = y2 - y1;

  return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
}

function getPetStateFromDistance(distance) {
  if (distance > 500) {
    return PET_STATES.RUNNING;
  }

  if (distance > 120) {
    return PET_STATES.WALKING;
  }

  return PET_STATES.IDLE;
}

function getMovementSpeed(state) {
  if (state === PET_STATES.RUNNING) {
    return 0.14;
  }

  if (state === PET_STATES.WALKING) {
    return 0.08;
  }

  return 0.04;
}

function sendPetState(state) {
  if (!catWindow || catWindow.isDestroyed()) {
    return;
  }

  if (state === lastSentState) {
    return;
  }

  lastSentState = state;

  catWindow.webContents.send("pet-state-changed", state);
}

app.whenReady().then(() => {
  createCatWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});