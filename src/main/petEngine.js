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
const ROAM_GRID_COLUMNS = 3;
const ROAM_GRID_ROWS = 2;
const RECENT_ROAM_ZONE_COUNT = 2;
const FAR_ROAM_CANDIDATE_POOL = 3;
const MIN_ROAM_DISTANCE_RATIO = 0.42;
const RUN_ENTER_DISTANCE_FOLLOWING = 700;
const RUN_ENTER_DISTANCE_ROAMING = 900;
const RUN_EXIT_DISTANCE = 420;
const MIN_WALK_BEFORE_RUN_MS = 900;
const MIN_RUN_DURATION_MS = 800;
const SPEED_EASING = 0.12;
const MOVEMENT_SPEED_SCALE = 0.8;

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
  let lastPlacedX = null;
  let lastPlacedY = null;
  let lastSentState = null;
  let lastSentDirection = null;
  let pendingDirection = null;
  let pendingDirectionSince = 0;
  let lastInteractionAt = Date.now();
  let lovingUntil = 0;
  let roamTarget = null;
  let recentRoamZoneIds = [];
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
    const currentZoneId = roamZoneIdForPoint(x, y, area);
    let availableZones = createRoamZones(area).filter((zone) => (
      zone.id !== currentZoneId && !recentRoamZoneIds.includes(zone.id)
    ));
    if (availableZones.length === 0) {
      availableZones = createRoamZones(area).filter((zone) => zone.id !== currentZoneId);
    }

    const candidates = availableZones.map((zone) => {
      const candidate = randomPointInRoamZone(zone);
      return {
        ...candidate,
        zoneId: zone.id,
        distance: Math.hypot(candidate.x - x, candidate.y - y)
      };
    });
    const areaDiagonal = Math.hypot(area.maxX - area.minX, area.maxY - area.minY);
    const distantCandidates = candidates.filter((candidate) => (
      candidate.distance >= areaDiagonal * MIN_ROAM_DISTANCE_RATIO
    ));
    const eligibleCandidates = distantCandidates.length > 0 ? distantCandidates : candidates;
    eligibleCandidates.sort((first, second) => second.distance - first.distance);
    const farPool = eligibleCandidates.slice(0, FAR_ROAM_CANDIDATE_POOL);
    const selected = farPool[Math.floor(Math.random() * farPool.length)];
    roamTarget = { x: selected.x, y: selected.y };
    recentRoamZoneIds = [selected.zoneId, ...recentRoamZoneIds]
      .filter((zoneId, index, values) => values.indexOf(zoneId) === index)
      .slice(0, RECENT_ROAM_ZONE_COUNT);
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
    const constrained = constrainToVisibleWorkAreas(nextX, nextY, screen, windowSize);
    x = constrained.x;
    y = constrained.y;
    placeWindow();
  }

  function keepWindowOnScreen() {
    const constrained = constrainToVisibleWorkAreas(x, y, screen, windowSize);
    const safeX = constrained.x;
    const safeY = constrained.y;
    if (safeX !== x || safeY !== y) {
      x = safeX;
      y = safeY;
      placeWindow(true);
    }
  }

  function ensureActualWindowOnScreen() {
    if (window.isDestroyed()) return;
    const bounds = window.getBounds();
    const constrained = constrainToVisibleWorkAreas(bounds.x, bounds.y, screen, windowSize);
    const safeX = constrained.x;
    const safeY = constrained.y;

    const sizeChanged = bounds.width !== windowSize || bounds.height !== windowSize;
    if (safeX !== bounds.x || safeY !== bounds.y || sizeChanged) {
      x = safeX;
      y = safeY;
      roamTarget = null;
      placeWindow(true);
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
    placeWindow(true);
  }

  function placeWindow(force = false) {
    const roundedX = Math.round(x);
    const roundedY = Math.round(y);
    if (!force && roundedX === lastPlacedX && roundedY === lastPlacedY) return;
    window.setBounds({
      x: roundedX,
      y: roundedY,
      width: windowSize,
      height: windowSize
    }, false);
    lastPlacedX = roundedX;
    lastPlacedY = roundedY;
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
  if (state === PET_STATES.RUNNING) return 5.5 * MOVEMENT_SPEED_SCALE;
  if (state === PET_STATES.WALKING) return 2.5 * MOVEMENT_SPEED_SCALE;
  return 0.8 * MOVEMENT_SPEED_SCALE;
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

function createRoamZones(area) {
  const zones = [];
  const totalWidth = area.maxX - area.minX;
  const totalHeight = area.maxY - area.minY;
  for (let row = 0; row < ROAM_GRID_ROWS; row += 1) {
    for (let column = 0; column < ROAM_GRID_COLUMNS; column += 1) {
      zones.push({
        id: row * ROAM_GRID_COLUMNS + column,
        minX: area.minX + totalWidth * column / ROAM_GRID_COLUMNS,
        maxX: area.minX + totalWidth * (column + 1) / ROAM_GRID_COLUMNS,
        minY: area.minY + totalHeight * row / ROAM_GRID_ROWS,
        maxY: area.minY + totalHeight * (row + 1) / ROAM_GRID_ROWS
      });
    }
  }
  return zones;
}

function roamZoneIdForPoint(x, y, area) {
  const width = Math.max(1, area.maxX - area.minX);
  const height = Math.max(1, area.maxY - area.minY);
  const column = clamp(Math.floor((x - area.minX) / width * ROAM_GRID_COLUMNS), 0, ROAM_GRID_COLUMNS - 1);
  const row = clamp(Math.floor((y - area.minY) / height * ROAM_GRID_ROWS), 0, ROAM_GRID_ROWS - 1);
  return row * ROAM_GRID_COLUMNS + column;
}

function randomPointInRoamZone(zone) {
  const horizontalPadding = (zone.maxX - zone.minX) * 0.12;
  const verticalPadding = (zone.maxY - zone.minY) * 0.12;
  return {
    x: randomBetween(zone.minX + horizontalPadding, zone.maxX - horizontalPadding),
    y: randomBetween(zone.minY + verticalPadding, zone.maxY - verticalPadding)
  };
}

function constrainToVisibleWorkAreas(x, y, screen, windowSize) {
  const workAreas = typeof screen.getAllDisplays === "function"
    ? screen.getAllDisplays().map((display) => display.workArea)
    : [screen.getDisplayNearestPoint({ x, y }).workArea];

  if (isWindowFullyVisible(x, y, windowSize, workAreas)) return { x, y };

  const center = { x: Math.round(x + windowSize / 2), y: Math.round(y + windowSize / 2) };
  const nearestArea = safeMovementArea(screen.getDisplayNearestPoint(center).workArea, windowSize);
  return {
    x: clamp(x, nearestArea.minX, nearestArea.maxX),
    y: clamp(y, nearestArea.minY, nearestArea.maxY)
  };
}

function isWindowFullyVisible(x, y, windowSize, workAreas) {
  let uncovered = [{
    x: x - EDGE_MARGIN,
    y: y - EDGE_MARGIN,
    width: windowSize + EDGE_MARGIN * 2,
    height: windowSize + EDGE_MARGIN * 2
  }];

  for (const area of workAreas) {
    uncovered = uncovered.flatMap((rectangle) => subtractRectangle(rectangle, area));
    if (uncovered.length === 0) return true;
  }
  return false;
}

function subtractRectangle(rectangle, coveringArea) {
  const left = Math.max(rectangle.x, coveringArea.x);
  const top = Math.max(rectangle.y, coveringArea.y);
  const right = Math.min(
    rectangle.x + rectangle.width,
    coveringArea.x + coveringArea.width
  );
  const bottom = Math.min(
    rectangle.y + rectangle.height,
    coveringArea.y + coveringArea.height
  );

  if (left >= right || top >= bottom) return [rectangle];

  const pieces = [];
  if (top > rectangle.y) {
    pieces.push({ x: rectangle.x, y: rectangle.y, width: rectangle.width, height: top - rectangle.y });
  }
  if (bottom < rectangle.y + rectangle.height) {
    pieces.push({
      x: rectangle.x,
      y: bottom,
      width: rectangle.width,
      height: rectangle.y + rectangle.height - bottom
    });
  }
  if (left > rectangle.x) {
    pieces.push({ x: rectangle.x, y: top, width: left - rectangle.x, height: bottom - top });
  }
  if (right < rectangle.x + rectangle.width) {
    pieces.push({
      x: right,
      y: top,
      width: rectangle.x + rectangle.width - right,
      height: bottom - top
    });
  }
  return pieces;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

module.exports = {
  createPetEngine,
  PET_STATES,
  movementState,
  constrainToVisibleWorkAreas
};
