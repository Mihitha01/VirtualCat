const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createSettingsStore, DEFAULT_SETTINGS, sanitizeSettings } = require("../src/main/settings");

test("settings persist valid values and reject unknown or out-of-range values", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "virtual-cat-settings-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createSettingsStore(directory);
  assert.deepEqual(store.load(), DEFAULT_SETTINGS);
  assert.equal(store.set("sleepAfterSeconds", 25).sleepAfterSeconds, 25);
  assert.equal(store.set("spriteScale", 100).spriteScale, DEFAULT_SETTINGS.spriteScale);
  assert.equal(store.set("unknown", true).unknown, undefined);

  const reloaded = createSettingsStore(directory).load();
  assert.equal(reloaded.sleepAfterSeconds, 25);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "settings.json"), "utf8")).settingsVersion, 1);
});

test("legacy settings migrate once and corrupt JSON recovers to defaults", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "virtual-cat-settings-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "settings.json");
  fs.writeFileSync(file, JSON.stringify({ sleepAfterSeconds: 60, alwaysOnTop: false }));
  const migrated = createSettingsStore(directory).load();
  assert.equal(migrated.sleepAfterSeconds, 20);
  assert.equal(migrated.alwaysOnTop, false);

  fs.writeFileSync(file, "{broken json");
  assert.deepEqual(createSettingsStore(directory).load(), DEFAULT_SETTINGS);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, "utf8")));
});

test("sanitization rejects non-finite numbers and incorrect types", () => {
  const value = sanitizeSettings({
    alwaysOnTop: "yes",
    spriteScale: Number.NaN,
    sleepAfterSeconds: Infinity,
    animationSpeedMultiplier: 0
  });
  assert.deepEqual(value, DEFAULT_SETTINGS);
});
