const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("preload exposes only narrow IPC methods and cleans up subscriptions", () => {
  let exposedName;
  let api;
  const listeners = new Map();
  const removed = [];
  const sent = [];
  const electron = {
    contextBridge: {
      exposeInMainWorld(name, value) {
        exposedName = name;
        api = value;
      }
    },
    ipcRenderer: {
      on(channel, listener) { listeners.set(channel, listener); },
      removeListener(channel, listener) { removed.push({ channel, listener }); },
      send(channel, value) { sent.push({ channel, value }); }
    }
  };
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "preload.js"), "utf8");
  vm.runInNewContext(source, { require: () => electron, Boolean }, { filename: "preload.js" });

  assert.equal(exposedName, "virtualCat");
  assert.deepEqual(Object.keys(api).sort(), [
    "onPetDirectionChanged",
    "onPetModeChanged",
    "onPetStateChanged",
    "onSettingsChanged",
    "reportInteraction",
    "reportPetting",
    "setPetHovering",
    "toggleFollowMode"
  ]);
  assert.throws(() => api.onPetStateChanged(null), /callback/i);

  let received;
  const unsubscribe = api.onPetStateChanged((value) => { received = value; });
  const listener = listeners.get("pet-state-changed");
  listener({}, "sleeping");
  assert.equal(received, "sleeping");
  unsubscribe();
  assert.deepEqual(removed, [{ channel: "pet-state-changed", listener }]);

  api.setPetHovering(1);
  api.toggleFollowMode();
  api.reportInteraction();
  api.reportPetting();
  assert.deepEqual(sent, [
    { channel: "pet-hover-changed", value: true },
    { channel: "toggle-follow-mode", value: undefined },
    { channel: "pet-interaction", value: undefined },
    { channel: "petting-detected", value: undefined }
  ]);
});
