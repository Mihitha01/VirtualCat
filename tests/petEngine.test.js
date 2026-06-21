const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createPetEngine,
  PET_STATES,
  movementState,
  constrainToVisibleWorkAreas
} = require("../src/main/petEngine");

const WINDOW_SIZE = 200;

function display(x, y, width, height) {
  return { workArea: { x, y, width, height } };
}

function fakeScreen(displays, cursor = { x: 0, y: 0 }) {
  return {
    cursor,
    getAllDisplays: () => displays,
    getCursorScreenPoint() { return { ...this.cursor }; },
    getDisplayNearestPoint(point) {
      return displays.reduce((nearest, candidate) => {
        const distance = distanceToRectangle(point, candidate.workArea);
        return !nearest || distance < nearest.distance ? { display: candidate, distance } : nearest;
      }, null).display;
    }
  };
}

function distanceToRectangle(point, rectangle) {
  const dx = Math.max(rectangle.x - point.x, 0, point.x - (rectangle.x + rectangle.width));
  const dy = Math.max(rectangle.y - point.y, 0, point.y - (rectangle.y + rectangle.height));
  return dx * dx + dy * dy;
}

function fakeWindow(initialBounds) {
  let bounds = { ...initialBounds };
  const placements = [];
  const messages = [];
  return {
    placements,
    messages,
    isDestroyed: () => false,
    getBounds: () => ({ ...bounds }),
    setBounds(nextBounds) {
      bounds = { ...nextBounds };
      placements.push({ ...bounds });
    },
    replaceBounds(nextBounds) { bounds = { ...nextBounds }; },
    webContents: { send: (channel, value) => messages.push({ channel, value, at: Date.now() }) }
  };
}

function withFakeClock(run) {
  const realNow = Date.now;
  const realSetInterval = global.setInterval;
  const realClearInterval = global.clearInterval;
  let now = 1_000_000;
  let nextId = 1;
  const intervals = new Map();
  Date.now = () => now;
  global.setInterval = (callback, delay) => {
    const id = nextId;
    nextId += 1;
    intervals.set(id, { callback, delay });
    return id;
  };
  global.clearInterval = (id) => intervals.delete(id);
  try {
    return run({
      advance(milliseconds) { now += milliseconds; },
      interval(delay) {
        return [...intervals.values()].find((entry) => entry.delay === delay)?.callback;
      }
    });
  } finally {
    Date.now = realNow;
    global.setInterval = realSetInterval;
    global.clearInterval = realClearInterval;
  }
}

test("containment supports normal, negative, stacked, and seam-crossing layouts", () => {
  const layouts = [
    [display(0, 0, 1920, 1080)],
    [display(-1920, 0, 1920, 1080), display(0, 0, 1920, 1080)],
    [display(0, -1080, 1920, 1080), display(0, 0, 1920, 1080)]
  ];
  for (const displays of layouts) {
    const screen = fakeScreen(displays);
    const result = constrainToVisibleWorkAreas(displays[0].workArea.x - 500, displays[0].workArea.y - 500, screen, WINDOW_SIZE);
    assert.ok(Number.isFinite(result.x) && Number.isFinite(result.y));
    assert.deepEqual(constrainToVisibleWorkAreas(result.x, result.y, screen, WINDOW_SIZE), result);
  }

  const sideBySide = fakeScreen([display(0, 0, 1920, 1080), display(1920, 0, 1920, 1080)]);
  assert.deepEqual(constrainToVisibleWorkAreas(1810, 400, sideBySide, WINDOW_SIZE), { x: 1810, y: 400 });

  const lShape = fakeScreen([display(0, 0, 1920, 1080), display(1920, 540, 1920, 1080)]);
  assert.notDeepEqual(constrainToVisibleWorkAreas(1810, 300, lShape, WINDOW_SIZE), { x: 1810, y: 300 });
});

test("following crosses an adjoining monitor without leaving the work-area union", () => withFakeClock((clock) => {
  const displays = [display(0, 0, 1920, 1080), display(1920, 0, 1920, 1080)];
  const screen = fakeScreen(displays, { x: 3100, y: 500 });
  const window = fakeWindow({ x: 1700, y: 400, width: WINDOW_SIZE, height: WINDOW_SIZE });
  const engine = createPetEngine({
    window,
    screen,
    windowSize: WINDOW_SIZE,
    getSettings: () => ({ sleepAfterSeconds: 3600, movementEnabled: true })
  });
  engine.start();
  engine.toggleFollowMode();
  const tick = clock.interval(16);
  for (let index = 0; index < 500; index += 1) {
    clock.advance(16);
    tick();
  }
  engine.stop();

  assert.ok(Math.max(...window.placements.map((bounds) => bounds.x)) > 1920);
  for (const bounds of window.placements) {
    assert.equal(bounds.width, WINDOW_SIZE);
    assert.equal(bounds.height, WINDOW_SIZE);
    assert.deepEqual(constrainToVisibleWorkAreas(bounds.x, bounds.y, screen, WINDOW_SIZE), { x: bounds.x, y: bounds.y });
  }
  const directions = window.messages.filter((message) => message.channel === "pet-direction-changed");
  assert.deepEqual([...new Set(directions.map((message) => message.value))], ["right"]);
}));

test("free roaming visits distant monitor regions instead of looping locally", () => withFakeClock((clock) => {
  const realRandom = Math.random;
  let seed = 123456;
  Math.random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const screen = fakeScreen([display(0, 0, 1920, 1040)], { x: 960, y: 520 });
  const window = fakeWindow({ x: 800, y: 400, width: WINDOW_SIZE, height: WINDOW_SIZE });
  const engine = createPetEngine({
    window,
    screen,
    windowSize: WINDOW_SIZE,
    getSettings: () => ({ sleepAfterSeconds: 3600, movementEnabled: true })
  });
  try {
    engine.start();
    const tick = clock.interval(16);
    for (let index = 0; index < 1875; index += 1) {
      clock.advance(16);
      tick();
    }
    const xValues = window.placements.map((bounds) => bounds.x);
    const yValues = window.placements.map((bounds) => bounds.y);
    assert.ok(Math.max(...xValues) - Math.min(...xValues) >= 1200);
    assert.ok(Math.max(...yValues) - Math.min(...yValues) >= 400);
  } finally {
    engine.stop();
    Math.random = realRandom;
  }
}));

test("movement-state hysteresis prevents rapid walk/run switching", () => {
  assert.equal(movementState(PET_STATES.IDLE, 1500, false, 0), PET_STATES.WALKING);
  assert.equal(movementState(PET_STATES.WALKING, 1500, false, 899), PET_STATES.WALKING);
  assert.equal(movementState(PET_STATES.WALKING, 1500, false, 900), PET_STATES.RUNNING);
  assert.equal(movementState(PET_STATES.RUNNING, 100, false, 799), PET_STATES.RUNNING);
  assert.equal(movementState(PET_STATES.RUNNING, 421, false, 800), PET_STATES.RUNNING);
  assert.equal(movementState(PET_STATES.RUNNING, 420, false, 800), PET_STATES.WALKING);
});

test("sleep, wake, petting, pause, and fixed-size repair are deterministic", () => withFakeClock((clock) => {
  const screen = fakeScreen([display(0, 0, 1920, 1080)], { x: 900, y: 500 });
  const window = fakeWindow({ x: 400, y: 400, width: WINDOW_SIZE, height: WINDOW_SIZE });
  const engine = createPetEngine({
    window,
    screen,
    windowSize: WINDOW_SIZE,
    getSettings: () => ({ sleepAfterSeconds: 20, movementEnabled: true })
  });
  engine.start();
  const tick = clock.interval(16);
  const watchdog = clock.interval(250);

  clock.advance(20_001);
  tick();
  assert.equal(engine.isSleeping(), true);
  engine.wake();
  assert.equal(engine.isSleeping(), false);
  engine.pet();
  assert.equal(window.messages.at(-1).value, PET_STATES.LOVING);
  engine.setPaused(true);
  clock.advance(1_801);
  tick();
  assert.equal(window.messages.at(-1).value, PET_STATES.IDLE);

  window.replaceBounds({ x: 400, y: 400, width: 260, height: 240 });
  watchdog();
  assert.deepEqual(window.getBounds(), { x: 400, y: 400, width: WINDOW_SIZE, height: WINDOW_SIZE });
  engine.stop();
}));
