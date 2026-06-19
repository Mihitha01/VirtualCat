const catElement = document.getElementById("cat");
const catFrame = document.getElementById("cat-frame");
const stateLabel = document.getElementById("state-label");

const STATE_ROWS = { idle: 0, walking: 1, running: 2, sleeping: 3 };
const FRAME_COUNT = 8;
const CYCLE_MS = { walking: 700, running: 480, sleeping: 1800 };
const IDLE_CYCLE_MS = 6000;
const OPEN_EYE_FRAMES = [0, 2, 4, 6, 7];

let state = "idle";
let direction = "right";
let mode = "roaming";
let settings = { spriteScale: 0.7, showStateLabel: false, animationSpeedMultiplier: 1 };
let frameWidth = 0;
let frameHeight = 0;
let stateStartedAt = performance.now();
let hoveringCat = false;

const spriteSheet = new Image();
spriteSheet.src = "./assets/cat/cat-spritesheet.png";
spriteSheet.addEventListener("load", () => {
  frameWidth = spriteSheet.naturalWidth / FRAME_COUNT;
  frameHeight = spriteSheet.naturalHeight / 4;
  applySize();
  requestAnimationFrame(animate);
});

function animate(now) {
  drawFrame(now);
  requestAnimationFrame(animate);
}

function drawFrame(now = performance.now()) {
  if (!frameWidth || !frameHeight) return;
  const frameIndex = state === "idle" ? idleFrameAt(now) : loopingFrameAt(now);
  const scale = settings.spriteScale;
  catFrame.style.backgroundPosition = `${-frameIndex * frameWidth * scale}px ${-STATE_ROWS[state] * frameHeight * scale}px`;
  catElement.style.transform = `scaleX(${direction === "right" ? 1 : -1})`;
  stateLabel.textContent = `${state} - ${mode}`;
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
  drawFrame();
}

window.virtualCat.onPetStateChanged((nextState) => {
  if (!(nextState in STATE_ROWS)) return;
  state = nextState;
  stateStartedAt = performance.now();
  drawFrame();
});

window.virtualCat.onPetDirectionChanged((nextDirection) => {
  if (nextDirection !== "left" && nextDirection !== "right") return;
  direction = nextDirection;
  drawFrame();
});

window.virtualCat.onPetModeChanged((nextMode) => {
  if (nextMode !== "roaming" && nextMode !== "following") return;
  mode = nextMode;
  drawFrame();
});

window.virtualCat.onSettingsChanged((nextSettings) => {
  settings = { ...settings, ...nextSettings };
  applySize();
});

document.addEventListener("mousemove", (event) => {
  const bounds = catElement.getBoundingClientRect();
  const isOverCat = event.clientX >= bounds.left && event.clientX <= bounds.right
    && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
  if (isOverCat !== hoveringCat) {
    hoveringCat = isOverCat;
    window.virtualCat.setPetHovering(isOverCat);
  }
});

document.addEventListener("mouseleave", () => {
  hoveringCat = false;
  window.virtualCat.setPetHovering(false);
});

catElement.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  hoveringCat = false;
  window.virtualCat.toggleFollowMode();
  window.virtualCat.setPetHovering(false);
});
