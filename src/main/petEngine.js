const PET_STATES = Object.freeze({
  IDLE: "idle",
  WALKING: "walking",
  RUNNING: "running",
  SLEEPING: "sleeping",
  LOVING: "loving"
});

const TICK_MS = 16;
const CURSOR_OFFSET = 80;
const TARGET_REACHED_DISTANCE = 20;
const EDGE_MARGIN = 8;
const LOVING_DURATION_MS = 1800;
const DIRECTION_DEAD_ZONE = 8;
const DIRECTION_STABILITY_MS = 140;
const ROAM_CANDIDATE_COUNT = 12;
const FAR_ROAM_CANDIDATE_POOL = 3;
const RUN_ENTER_DISTANCE_FOLLOWING = 700;
const RUN_ENTER_DISTANCE_ROAMING = 900;
const RUN_EXIT_DISTANCE = 420;
const MIN_WALK_BEFORE_RUN_MS = 900;
const MIN_RUN_DURATION_MS = 800;
const SPEED_EASING = 0.12;

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
  let stateChangedAt = Date.now();
  let currentSpeed = 0;
  let lastSentState = null;
  let lastSentDirection = null;
  let pendingDirection = null;
  let pendingDirectionSince = 0;
  let lastInteractionAt = Date.now();
  let lovingUntil = 0;
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

    if (forcedSleep) {
      setState(PET_STATES.SLEEPING);
      return;
    }

    if (now < lovingUntil) {
      setState(PET_STATES.LOVING);
      return;
    }

    const settings = getSettings();
    if (now - lastInteractionAt >= settings.sleepAfterSeconds * 1000) {
      setState(PET_STATES.SLEEPING);
      return;
    }

    if (paused || !settings.movementEnabled) {
      setState(PET_STATES.IDLE);
      return;
    }

    const target = followingCursor
      ? { x: cursor.x - CURSOR_OFFSET, y: cursor.y - CURSOR_OFFSET }
      : getRoamTarget(now);

    if (!target) {
      setState(PET_STATES.IDLE);
      return;
    }

    const distance = Math.hypot(target.x - x, target.y - y);
    if (distance <= TARGET_REACHED_DISTANCE) {
      if (!followingCursor) {
        roamTarget = null;
        restUntil = now + randomBetween(1500, 3500);
      }
      setState(PET_STATES.IDLE);
      return;
    }

    setState(movementState(state, distance, followingCursor, now - stateChangedAt));
    moveToward(target, distance);
  }

  function getRoamTarget(now) {
    if (roamTarget) return roamTarget;
    if (now < restUntil) return null;
    const center = { x: Math.round(x + windowSize / 2), y: Math.round(y + windowSize / 2) };
    const area = safeMovementArea(screen.getDisplayNearestPoint(center).workArea, windowSize);
    const candidates = [];
    for (let attempt = 0; attempt < ROAM_CANDIDATE_COUNT; attempt += 1) {
      const candidate = {
        x: randomBetween(area.minX, area.maxX),
        y: randomBetween(area.minY, area.maxY)
      };
      candidates.push({
        ...candidate,
        distance: Math.hypot(candidate.x - x, candidate.y - y)
      });
    }
    candidates.sort((first, second) => second.distance - first.distance);
    const farPool = candidates.slice(0, FAR_ROAM_CANDIDATE_POOL);
    const selected = farPool[Math.floor(Math.random() * farPool.length)];
    roamTarget = { x: selected.x, y: selected.y };
    return roamTarget;
  }

  function moveToward(target, distance) {
    const desiredSpeed = movementSpeed(state);
    currentSpeed += (desiredSpeed - currentSpeed) * SPEED_EASING;
    const step = Math.min(Math.max(currentSpeed, 0.25), distance);
    const deltaX = ((target.x - x) / distance) * step;
    const deltaY = ((target.y - y) / distance) * step;
    updateDirection(target.x - x, Date.now());

    const nextX = x + deltaX;
    const nextY = y + deltaY;
    const display = screen.getDisplayNearestPoint({ x: Math.round(nextX), y: Math.round(nextY) });
    const area = safeMovementArea(display.workArea, windowSize);
    x = clamp(nextX, area.minX, area.maxX);
    y = clamp(nextY, area.minY, area.maxY);
    placeWindow();
  }

  function keepWindowOnScreen() {
    const center = { x: Math.round(x + windowSize / 2), y: Math.round(y + windowSize / 2) };
    const area = safeMovementArea(screen.getDisplayNearestPoint(center).workArea, windowSize);
    const safeX = clamp(x, area.minX, area.maxX);
    const safeY = clamp(y, area.minY, area.maxY);
    if (safeX !== x || safeY !== y) {
      x = safeX;
      y = safeY;
      placeWindow();
    }
  }

  function ensureActualWindowOnScreen() {
    if (window.isDestroyed()) return;
    const bounds = window.getBounds();
    const center = { x: bounds.x + Math.round(bounds.width / 2), y: bounds.y + Math.round(bounds.height / 2) };
    const area = safeMovementArea(screen.getDisplayNearestPoint(center).workArea, windowSize);
    const safeX = clamp(bounds.x, area.minX, area.maxX);
    const safeY = clamp(bounds.y, area.minY, area.maxY);

    const sizeChanged = bounds.width !== windowSize || bounds.height !== windowSize;
    if (safeX !== bounds.x || safeY !== bounds.y || sizeChanged) {
      x = safeX;
      y = safeY;
      roamTarget = null;
      placeWindow();
      return;
    }

    // Do not synchronize engine coordinates from every OS move event. Native
    // bounds can briefly lag behind our 60 FPS setBounds calls, which used to
    // clear the roaming target and make the cat rapidly choose left/right.
  }

  function bringBack() {
    const cursor = screen.getCursorScreenPoint();
    const area = safeMovementArea(screen.getDisplayNearestPoint(cursor).workArea, windowSize);
    x = clamp(cursor.x - windowSize / 2, area.minX, area.maxX);
    y = clamp(cursor.y - windowSize / 2, area.minY, area.maxY);
    roamTarget = null;
    restUntil = Date.now() + 500;
    placeWindow();
  }

  function placeWindow() {
    window.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: windowSize,
      height: windowSize
    }, false);
  }

  function interact() {
    forcedSleep = false;
    lastInteractionAt = Date.now();
    if (state === PET_STATES.SLEEPING) setState(PET_STATES.IDLE);
  }

  function pet() {
    interact();
    lovingUntil = Date.now() + LOVING_DURATION_MS;
    setState(PET_STATES.LOVING);
  }

  function setState(nextState) {
    if (nextState === PET_STATES.IDLE || nextState === PET_STATES.SLEEPING || nextState === PET_STATES.LOVING) {
      clearPendingDirection();
    }
    const sleepChanged = (state === PET_STATES.SLEEPING) !== (nextState === PET_STATES.SLEEPING);
    const stateChanged = state !== nextState;
    state = nextState;
    if (stateChanged) stateChangedAt = Date.now();
    if (nextState === PET_STATES.IDLE || nextState === PET_STATES.SLEEPING || nextState === PET_STATES.LOVING) {
      currentSpeed = 0;
    }
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
    clearPendingDirection();
    window.webContents.send("pet-direction-changed", direction);
  }

  function updateDirection(horizontalDistance, now) {
    if (Math.abs(horizontalDistance) < DIRECTION_DEAD_ZONE) {
      clearPendingDirection();
      return;
    }

    const candidate = horizontalDistance > 0 ? "right" : "left";
    if (!lastSentDirection) {
      sendDirection(candidate);
      return;
    }

    if (candidate === lastSentDirection) {
      clearPendingDirection();
      return;
    }

    if (pendingDirection !== candidate) {
      pendingDirection = candidate;
      pendingDirectionSince = now;
      return;
    }

    if (now - pendingDirectionSince >= DIRECTION_STABILITY_MS) sendDirection(candidate);
  }

  function clearPendingDirection() {
    pendingDirection = null;
    pendingDirectionSince = 0;
  }

  function sendMode() {
    if (!window.isDestroyed()) window.webContents.send("pet-mode-changed", followingCursor ? "following" : "roaming");
  }

  function syncRenderer() {
    if (window.isDestroyed()) return;
    window.webContents.send("pet-state-changed", state);
    window.webContents.send("pet-direction-changed", lastSentDirection || "right");
    sendMode();
  }

  function toggleFollowMode() {
    interact();
    followingCursor = !followingCursor;
    lovingUntil = 0;
    roamTarget = null;
    restUntil = followingCursor ? 0 : Date.now() + randomBetween(1000, 2000);
    setState(PET_STATES.IDLE);
    sendMode();
    return followingCursor;
  }

  function sleep() {
    forcedSleep = true;
    lovingUntil = 0;
    setState(PET_STATES.SLEEPING);
  }

  function wake() {
    interact();
    lovingUntil = 0;
    setState(PET_STATES.IDLE);
  }

  return {
    start,
    stop,
    sleep,
    wake,
    pet,
    interact,
    bringBack,
    ensureOnScreen: ensureActualWindowOnScreen,
    syncRenderer,
    toggleFollowMode,
    setPaused: (value) => { paused = Boolean(value); },
    isPaused: () => paused,
    isSleeping: () => state === PET_STATES.SLEEPING,
    isFollowingCursor: () => followingCursor
  };
}

function movementState(currentState, distance, isFollowingCursor, timeInState) {
    if (currentState === PET_STATES.RUNNING) {
      if (timeInState < MIN_RUN_DURATION_MS) return PET_STATES.RUNNING;
      return distance <= RUN_EXIT_DISTANCE ? PET_STATES.WALKING : PET_STATES.RUNNING;
    }

    if (currentState === PET_STATES.WALKING) {
      const runDistance = isFollowingCursor ? RUN_ENTER_DISTANCE_FOLLOWING : RUN_ENTER_DISTANCE_ROAMING;
      const walkedLongEnough = timeInState >= MIN_WALK_BEFORE_RUN_MS;
      return distance >= runDistance && walkedLongEnough ? PET_STATES.RUNNING : PET_STATES.WALKING;
    }

    return PET_STATES.WALKING;
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
