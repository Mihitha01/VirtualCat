const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("renderer preserves gait, caches frames, uses alpha hit testing, and detects real petting", () => {
  let now = 0;
  let image;
  let animationFrame;
  const documentListeners = {};
  const catListeners = {};
  const subscriptions = {};
  const calls = { hover: [], interaction: 0, petting: 0, toggle: 0 };
  const writeCounts = {};
  const style = new Proxy({}, {
    set(target, key, value) {
      target[key] = value;
      writeCounts[key] = (writeCounts[key] || 0) + 1;
      return true;
    }
  });
  const catFrame = { style };
  const catElement = {
    style: {},
    addEventListener: (name, callback) => { catListeners[name] = callback; },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 7, bottom: 7 })
  };
  const stateLabel = { style: {}, textContent: "" };
  const alphaPixels = new Uint8ClampedArray(80 * 50 * 4);
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      for (let y = 2; y <= 7; y += 1) {
        for (let x = 2; x <= 7; x += 1) {
          alphaPixels[((row * 10 + y) * 80 + column * 10 + x) * 4 + 3] = 255;
        }
      }
    }
  }

  class FakeImage {
    constructor() {
      image = this;
      this.naturalWidth = 80;
      this.naturalHeight = 50;
      this.listeners = {};
    }
    addEventListener(name, callback) { this.listeners[name] = callback; }
  }

  const context = {
    console,
    Uint8Array,
    Image: FakeImage,
    performance: { now: () => now },
    requestAnimationFrame: (callback) => { animationFrame = callback; },
    document: {
      getElementById(id) {
        return { cat: catElement, "cat-frame": catFrame, "state-label": stateLabel }[id];
      },
      addEventListener(name, callback) { documentListeners[name] = callback; },
      createElement(name) {
        assert.equal(name, "canvas");
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage() {},
            getImageData: () => ({ data: alphaPixels })
          })
        };
      }
    },
    window: {
      virtualCat: {
        onPetStateChanged: (callback) => { subscriptions.state = callback; },
        onPetDirectionChanged: (callback) => { subscriptions.direction = callback; },
        onPetModeChanged: (callback) => { subscriptions.mode = callback; },
        onSettingsChanged: (callback) => { subscriptions.settings = callback; },
        setPetHovering: (value) => calls.hover.push(value),
        toggleFollowMode: () => { calls.toggle += 1; },
        reportInteraction: () => { calls.interaction += 1; },
        reportPetting: () => { calls.petting += 1; }
      }
    }
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "renderer.js"), "utf8");
  vm.runInContext(source, context, { filename: "renderer.js" });
  image.listeners.load();

  const move = (clientY, screenY, elapsed = 80) => {
    now += elapsed;
    documentListeners.mousemove({ clientX: 3.5, clientY, screenY });
  };
  move(3.5, 100);
  assert.deepEqual(calls.hover, [true]);
  now += 80;
  documentListeners.mousemove({ clientX: 0.1, clientY: 0.1, screenY: 100 });
  assert.deepEqual(calls.hover, [true, false]);

  move(2.0, 100);
  move(3.0, 100);
  move(4.0, 100);
  move(3.0, 100);
  assert.equal(calls.petting, 0, "window-relative movement must not count as petting");

  documentListeners.mouseleave();
  move(3.5, 100);
  move(3.5, 120);
  move(3.5, 90);
  move(3.5, 120);
  assert.equal(calls.petting, 1);
  assert.ok(calls.interaction >= 1);

  now = 1000;
  subscriptions.state("walking");
  animationFrame(1350);
  const walkingPosition = style.backgroundPosition.split(" ")[0];
  const writesBeforeTransition = writeCounts.backgroundPosition;
  now = 1350;
  subscriptions.state("running");
  const runningPosition = style.backgroundPosition.split(" ")[0];
  assert.equal(runningPosition, walkingPosition, "walk/run transition must preserve gait frame");
  assert.equal(writeCounts.backgroundPosition, writesBeforeTransition + 1);

  const writesBeforeCachedFrames = writeCounts.backgroundPosition;
  animationFrame(1360);
  animationFrame(1370);
  assert.equal(writeCounts.backgroundPosition, writesBeforeCachedFrames, "same animation frame must not repaint");

  catListeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(calls.toggle, 1);
  assert.equal(calls.hover.at(-1), false);
});
