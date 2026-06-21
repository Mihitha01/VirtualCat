const catElement = document.getElementById("cat");
const catFrame = document.getElementById("cat-frame");
const stateLabel = document.getElementById("state-label");

const STATE_ROWS = { idle: 0, walking: 1, running: 2, sleeping: 3, loving: 4 };
const SPRITE_COLUMNS = 8;
const SPRITE_ROWS = 5;
const FRAME_COUNT = SPRITE_COLUMNS;
const CYCLE_MS = { walking: 875, running: 600, sleeping: 1800, loving: 1400 };
const IDLE_CYCLE_MS = 6000;
const OPEN_EYE_FRAMES = [0, 2, 4, 6, 7];

let state = "idle";
let direction = "right";
let mode = "roaming";
let settings = { spriteScale: 0.7, showStateLabel: false, animationSpeedMultiplier: 1 };
let frameWidth = 0;
let frameHeight = 0;
let spriteAlphaMask = null;
let stateStartedAt = performance.now();
let hoveringCat = false;
let lastFrameIndex = -1;
let lastFrameState = null;
let lastRenderedDirection = null;
let lastRenderedLabel = null;
let lastInteractionReportAt = Number.NEGATIVE_INFINITY;
let lastPetMovementAt = 0;
let lastPetDirection = 0;
let petDirectionChanges = 0;
let petTravel = 0;
let lastPetTriggeredAt = Number.NEGATIVE_INFINITY;
let lastPointerScreenY = null;

const spriteSheet = new Image();
spriteSheet.src = "./assets/cat/cat-spritesheet.png";
spriteSheet.addEventListener("load", () => {
  if (spriteSheet.naturalWidth % SPRITE_COLUMNS !== 0 || spriteSheet.naturalHeight % SPRITE_ROWS !== 0) {
    console.error("Cat sprite sheet dimensions must be divisible by 8 columns and 5 rows.");
    return;
  }
  frameWidth = spriteSheet.naturalWidth / SPRITE_COLUMNS;
  frameHeight = spriteSheet.naturalHeight / SPRITE_ROWS;
  spriteAlphaMask = createSpriteAlphaMask();
  applySize();
  requestAnimationFrame(animate);
});
spriteSheet.addEventListener("error", () => console.error("Could not load the cat sprite sheet."));

function animate(now) {
  drawFrame(now);
  requestAnimationFrame(animate);
}

function drawFrame(now = performance.now(), force = false) {
  if (!frameWidth || !frameHeight) return;
  const frameIndex = state === "idle" ? idleFrameAt(now) : loopingFrameAt(now);
  const scale = settings.spriteScale;

  if (force || frameIndex !== lastFrameIndex || state !== lastFrameState) {
    catFrame.style.backgroundPosition = `${-frameIndex * frameWidth * scale}px ${-STATE_ROWS[state] * frameHeight * scale}px`;
    lastFrameIndex = frameIndex;
    lastFrameState = state;
  }

  if (force || direction !== lastRenderedDirection) {
    catElement.style.transform = `scaleX(${direction === "right" ? 1 : -1})`;
    lastRenderedDirection = direction;
  }

  const label = `${state} - ${mode}`;
  if (force || label !== lastRenderedLabel) {
    stateLabel.textContent = label;
    lastRenderedLabel = label;
  }
}

function idleFrameAt(now) {
  const elapsed = ((now - stateStartedAt) * settings.animationSpeedMultiplier) % IDLE_CYCLE_MS;
  if (elapsed < 5200) {
    const openFrameIndex = Math.floor(elapsed / (5200 / OPEN_EYE_FRAMES.length));
    return OPEN_EYE_FRAMES[Math.min(openFrameIndex, OPEN_EYE_FRAMES.length - 1)];
  }
  if (elapsed < 5280) return 1;
  if (elapsed < 5400) return 3;
  if (elapsed < 5480) return 1;
  return 0;
}

function loopingFrameAt(now) {
  const cycleDuration = CYCLE_MS[state] / settings.animationSpeedMultiplier;
  const progress = ((now - stateStartedAt) % cycleDuration) / cycleDuration;
  return Math.floor(progress * FRAME_COUNT) % FRAME_COUNT;
}

function applySize() {
  if (!frameWidth || !frameHeight) return;
  const scale = settings.spriteScale;
  catElement.style.width = `${frameWidth * scale}px`;
  catElement.style.height = `${frameHeight * scale}px`;
  catFrame.style.backgroundSize = `${spriteSheet.naturalWidth * scale}px ${spriteSheet.naturalHeight * scale}px`;
  stateLabel.style.display = settings.showStateLabel ? "block" : "none";
  drawFrame(performance.now(), true);
}

window.virtualCat.onPetStateChanged((nextState) => {
  if (!(nextState in STATE_ROWS)) return;
  const now = performance.now();
  const changingLocomotionSpeed = (state === "walking" || state === "running")
    && (nextState === "walking" || nextState === "running");
  let gaitProgress = 0;
  if (changingLocomotionSpeed) {
    const oldCycleDuration = CYCLE_MS[state] / settings.animationSpeedMultiplier;
    gaitProgress = ((now - stateStartedAt) % oldCycleDuration) / oldCycleDuration;
  }
  state = nextState;
  stateStartedAt = changingLocomotionSpeed
    ? now - gaitProgress * (CYCLE_MS[nextState] / settings.animationSpeedMultiplier)
    : now;
  drawFrame(now, true);
});

window.virtualCat.onPetDirectionChanged((nextDirection) => {
  if (nextDirection !== "left" && nextDirection !== "right") return;
  direction = nextDirection;
  drawFrame(performance.now(), true);
});

window.virtualCat.onPetModeChanged((nextMode) => {
  if (nextMode !== "roaming" && nextMode !== "following") return;
  mode = nextMode;
  drawFrame(performance.now(), true);
});

window.virtualCat.onSettingsChanged((nextSettings) => {
  settings = { ...settings, ...nextSettings };
  applySize();
});

document.addEventListener("mousemove", (event) => {
  const isOverCat = isPointOverVisibleCat(event.clientX, event.clientY);
  if (isOverCat !== hoveringCat) {
    hoveringCat = isOverCat;
    window.virtualCat.setPetHovering(isOverCat);
  }

  if (isOverCat) detectPetting(event);
  else resetPettingGesture();
});

function createSpriteAlphaMask() {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = spriteSheet.naturalWidth;
    canvas.height = spriteSheet.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(spriteSheet, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const alphaMask = new Uint8Array(canvas.width * canvas.height);
    for (let sourceIndex = 3, alphaIndex = 0; sourceIndex < pixels.length; sourceIndex += 4, alphaIndex += 1) {
      alphaMask[alphaIndex] = pixels[sourceIndex];
    }
    return alphaMask;
  } catch (error) {
    console.warn("Per-pixel cat hit testing is unavailable; using its rectangular bounds.", error.message);
    return null;
  }
}

function isPointOverVisibleCat(clientX, clientY) {
  const bounds = catElement.getBoundingClientRect();
  if (
    clientX < bounds.left
    || clientX >= bounds.right
    || clientY < bounds.top
    || clientY >= bounds.bottom
  ) {
    return false;
  }
  if (!spriteAlphaMask || lastFrameIndex < 0) return true;

  let sourceX = Math.floor((clientX - bounds.left) / settings.spriteScale);
  const sourceY = Math.floor((clientY - bounds.top) / settings.spriteScale);
  if (direction === "left") sourceX = frameWidth - sourceX - 1;
  const sheetX = lastFrameIndex * frameWidth + sourceX;
  const sheetY = STATE_ROWS[state] * frameHeight + sourceY;
  const alpha = spriteAlphaMask[sheetY * spriteSheet.naturalWidth + sheetX];
  return alpha >= 24;
}

document.addEventListener("mouseleave", () => {
  hoveringCat = false;
  resetPettingGesture();
  window.virtualCat.setPetHovering(false);
});

catElement.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  hoveringCat = false;
  window.virtualCat.toggleFollowMode();
  window.virtualCat.setPetHovering(false);
});

function detectPetting(event) {
  const now = performance.now();
  if (now - lastInteractionReportAt >= 400) {
    lastInteractionReportAt = now;
    window.virtualCat.reportInteraction();
  }

  if (lastPetMovementAt > 0 && now - lastPetMovementAt > 300) resetPettingGesture();
  const currentScreenY = Number.isFinite(event.screenY) ? event.screenY : null;
  const verticalMovement = currentScreenY === null || lastPointerScreenY === null
    ? 0
    : currentScreenY - lastPointerScreenY;
  lastPointerScreenY = currentScreenY;
  if (Math.abs(verticalMovement) >= 2) {
    const direction = Math.sign(verticalMovement);
    petTravel += Math.abs(verticalMovement);
    if (lastPetDirection && direction !== lastPetDirection) petDirectionChanges += 1;
    lastPetDirection = direction;
    lastPetMovementAt = now;
  }

  if (petTravel >= 45 && petDirectionChanges >= 2 && now - lastPetTriggeredAt >= 1200) {
    lastPetTriggeredAt = now;
    window.virtualCat.reportPetting();
    resetPettingGesture();
  }
}

function resetPettingGesture() {
  lastPetMovementAt = 0;
  lastPetDirection = 0;
  petDirectionChanges = 0;
  petTravel = 0;
  lastPointerScreenY = null;
}
