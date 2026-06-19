const PET_STATES = Object.freeze({
  IDLE: "idle",
  WALKING: "walking",
  RUNNING: "running",
  SLEEPING: "sleeping"
});

const TICK_MS = 16;
const CURSOR_OFFSET = 80;
const TARGET_REACHED_DISTANCE = 20;
const EDGE_MARGIN = 8;

function createPetEngine({ window, screen, windowSize, getSettings, onSleepChanged }) {
  const initialBounds = window.getBounds();
  let x = initialBounds.x;
  let y = initialBounds.y;
  let timer = null;
  let visibilityTimer = null;
  let paused = false;
  let forcedSleep = false;
  let followingCursor = false;
  let state = PET_STATES.IDLE;
  let lastSentState = null;
  let lastSentDirection = null;
  let activeMovementMs = 0;
  let tiredSleepUntil = 0;
  let roamTarget = null;
  let restUntil = Date.now() + randomBetween(1000, 3000);

  function start() {
    if (timer) return;
    keepWindowOnScreen();
    sendState(PET_STATES.IDLE);
    sendMode();
    timer = setInterval(tick, TICK_MS);
    visibilityTimer = setInterval(ensureActualWindowOnScreen, 250);
  }

  function stop() {
    if (timer) clearInterval(timer);
    if (visibilityTimer) clearInterval(visibilityTimer);
    timer = null;
    visibilityTimer = null;
  }

  function tick() {
    if (window.isDestroyed()) return stop();
    const now = Date.now();
    const cursor = screen.getCursorScreenPoint();
    keepWindowOnScreen();

    const settings = getSettings();
    if (forcedSleep || now < tiredSleepUntil) {
      setState(PET_STATES.SLEEPING);
      return;
    }

    if (tiredSleepUntil > 0) {
      tiredSleepUntil = 0;
      activeMovementMs = 0;
    }

    if (paused || !settings.movementEnabled) {
      setState(PET_STATES.IDLE);
      return;
    }

    const target = followingCursor
      ? { x: cursor.x - CURSOR_OFFSET, y: cursor.y - CURSOR_OFFSET }
      : getRoamTarget(now);

    if (!target) {
      activeMovementMs = Math.max(0, activeMovementMs - TICK_MS * 0.5);
      setState(PET_STATES.IDLE);
      return;
    }

    const distance = Math.hypot(target.x - x, target.y - y);
    if (distance <= TARGET_REACHED_DISTANCE) {
      if (!followingCursor) {
        roamTarget = null;
        restUntil = now + randomBetween(2000, 6000);
      }
      setState(PET_STATES.IDLE);
      return;
    }

    setState(stateFromDistance(distance));
    activeMovementMs += TICK_MS * (state === PET_STATES.RUNNING ? 1.5 : 1);
    if (activeMovementMs >= settings.sleepAfterSeconds * 1000) {
      tiredSleepUntil = now + randomBetween(8000, 15000);
      setState(PET_STATES.SLEEPING);
      return;
    }
    moveToward(target, distance);
  }

  function getRoamTarget(now) {
    if (roamTarget) return roamTarget;
    if (now < restUntil) return null;

    const center = { x: Math.round(x + windowSize / 2), y: Math.round(y + windowSize / 2) };
    const area = safeMovementArea(screen.getDisplayNearestPoint(center).workArea, windowSize);
    roamTarget = {
      x: randomBetween(area.minX, area.maxX),
      y: randomBetween(area.minY, area.maxY)
    };
    return roamTarget;
  }

  function moveToward(target, distance) {
    const step = Math.min(movementSpeed(state), distance);
    const deltaX = ((target.x - x) / distance) * step;
    const deltaY = ((target.y - y) / distance) * step;
    if (Math.abs(deltaX) > 0.05) sendDirection(deltaX > 0 ? "right" : "left");

    const nextX = x + deltaX;
    const nextY = y + deltaY;
    const display = screen.getDisplayNearestPoint({ x: Math.round(nextX), y: Math.round(nextY) });
    const area = safeMovementArea(display.workArea, windowSize);
    x = clamp(nextX, area.minX, area.maxX);
    y = clamp(nextY, area.minY, area.maxY);
    window.setPosition(Math.round(x), Math.round(y));
  }

  function keepWindowOnScreen() {
    const center = { x: Math.round(x + windowSize / 2), y: Math.round(y + windowSize / 2) };
    const area = safeMovementArea(screen.getDisplayNearestPoint(center).workArea, windowSize);
    const safeX = clamp(x, area.minX, area.maxX);
    const safeY = clamp(y, area.minY, area.maxY);
    if (safeX !== x || safeY !== y) {
      x = safeX;
      y = safeY;
      window.setPosition(Math.round(x), Math.round(y));
    }
  }

  function ensureActualWindowOnScreen() {
    if (window.isDestroyed()) return;
    const bounds = window.getBounds();
    const center = {
      x: bounds.x + Math.round(bounds.width / 2),
      y: bounds.y + Math.round(bounds.height / 2)
    };
    const area = safeMovementArea(screen.getDisplayNearestPoint(center).workArea, windowSize);
    const safeX = clamp(bounds.x, area.minX, area.maxX);
    const safeY = clamp(bounds.y, area.minY, area.maxY);

    if (safeX !== bounds.x || safeY !== bounds.y) {
      x = safeX;
      y = safeY;
      roamTarget = null;
      window.setPosition(Math.round(x), Math.round(y));
      return;
    }

    // Keep engine coordinates synchronized if the OS moves the window.
    if (Math.abs(bounds.x - x) > 2 || Math.abs(bounds.y - y) > 2) {
      x = bounds.x;
      y = bounds.y;
      roamTarget = null;
    }
  }

  function bringBack() {
    const cursor = screen.getCursorScreenPoint();
    const area = safeMovementArea(screen.getDisplayNearestPoint(cursor).workArea, windowSize);
    x = clamp(cursor.x - windowSize / 2, area.minX, area.maxX);
    y = clamp(cursor.y - windowSize / 2, area.minY, area.maxY);
    roamTarget = null;
    restUntil = Date.now() + 500;
    window.setPosition(Math.round(x), Math.round(y));
  }

  function setState(nextState) {
    const sleepChanged = (state === PET_STATES.SLEEPING) !== (nextState === PET_STATES.SLEEPING);
    state = nextState;
    sendState(nextState);
    if (sleepChanged) onSleepChanged?.();
  }

  function sendState(nextState) {
    if (lastSentState === nextState || window.isDestroyed()) return;
    lastSentState = nextState;
    window.webContents.send("pet-state-changed", nextState);
  }

  function sendDirection(direction) {
    if (lastSentDirection === direction || window.isDestroyed()) return;
    lastSentDirection = direction;
    window.webContents.send("pet-direction-changed", direction);
  }

  function sendMode() {
    if (!window.isDestroyed()) {
      window.webContents.send("pet-mode-changed", followingCursor ? "following" : "roaming");
    }
  }

  function toggleFollowMode() {
    followingCursor = !followingCursor;
    forcedSleep = false;
    tiredSleepUntil = 0;
    activeMovementMs = 0;
    roamTarget = null;
    restUntil = followingCursor ? 0 : Date.now() + randomBetween(1000, 3000);
    setState(PET_STATES.IDLE);
    sendMode();
    return followingCursor;
  }

  function sleep() {
    forcedSleep = true;
    setState(PET_STATES.SLEEPING);
  }

  function wake() {
    forcedSleep = false;
    tiredSleepUntil = 0;
    activeMovementMs = 0;
    setState(PET_STATES.IDLE);
  }

  return {
    start,
    stop,
    sleep,
    wake,
    bringBack,
    ensureOnScreen: ensureActualWindowOnScreen,
    toggleFollowMode,
    setPaused: (value) => { paused = Boolean(value); },
    isPaused: () => paused,
    isSleeping: () => state === PET_STATES.SLEEPING,
    isFollowingCursor: () => followingCursor
  };
}

function stateFromDistance(distance) {
  if (distance > 550) return PET_STATES.RUNNING;
  if (distance > TARGET_REACHED_DISTANCE) return PET_STATES.WALKING;
  return PET_STATES.IDLE;
}

function movementSpeed(state) {
  if (state === PET_STATES.RUNNING) return 5.5;
  if (state === PET_STATES.WALKING) return 2.5;
  return 0.8;
}

function randomBetween(minimum, maximum) {
  return minimum + Math.random() * Math.max(0, maximum - minimum);
}

function safeMovementArea(workArea, windowSize) {
  const minX = workArea.x + EDGE_MARGIN;
  const minY = workArea.y + EDGE_MARGIN;
  return {
    minX,
    minY,
    maxX: Math.max(minX, workArea.x + workArea.width - windowSize - EDGE_MARGIN),
    maxY: Math.max(minY, workArea.y + workArea.height - windowSize - EDGE_MARGIN)
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

module.exports = { createPetEngine };
