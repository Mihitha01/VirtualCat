const fs = require("fs");
const path = require("path");

const DEFAULT_SETTINGS = Object.freeze({
  alwaysOnTop: true,
  clickThrough: true,
  startAtLogin: false,
  movementEnabled: true,
  spriteScale: 0.7,
  sleepAfterSeconds: 25,
  showStateLabel: false,
  animationSpeedMultiplier: 1
});

function createSettingsStore(userDataPath) {
  const filePath = path.join(userDataPath, "settings.json");
  let settings = { ...DEFAULT_SETTINGS };

  function load() {
    try {
      settings = sanitizeSettings(JSON.parse(fs.readFileSync(filePath, "utf8")));
    } catch (error) {
      settings = { ...DEFAULT_SETTINGS };
      if (error.code !== "ENOENT") save();
    }
    return get();
  }

  function save() {
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), "utf8");
  }

  function get() {
    return { ...settings };
  }

  function set(key, value) {
    if (!(key in DEFAULT_SETTINGS)) return get();
    settings = sanitizeSettings({ ...settings, [key]: value });
    save();
    return get();
  }

  return { load, get, set };
}

function sanitizeSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const savedSleepDelay = source.sleepAfterSeconds === 60 ? DEFAULT_SETTINGS.sleepAfterSeconds : source.sleepAfterSeconds;
  return {
    alwaysOnTop: booleanOrDefault(source.alwaysOnTop, DEFAULT_SETTINGS.alwaysOnTop),
    clickThrough: booleanOrDefault(source.clickThrough, DEFAULT_SETTINGS.clickThrough),
    startAtLogin: booleanOrDefault(source.startAtLogin, DEFAULT_SETTINGS.startAtLogin),
    movementEnabled: booleanOrDefault(source.movementEnabled, DEFAULT_SETTINGS.movementEnabled),
    spriteScale: positiveNumberOrDefault(source.spriteScale, DEFAULT_SETTINGS.spriteScale),
    sleepAfterSeconds: positiveNumberOrDefault(savedSleepDelay, DEFAULT_SETTINGS.sleepAfterSeconds),
    showStateLabel: booleanOrDefault(source.showStateLabel, DEFAULT_SETTINGS.showStateLabel),
    animationSpeedMultiplier: positiveNumberOrDefault(source.animationSpeedMultiplier, DEFAULT_SETTINGS.animationSpeedMultiplier)
  };
}

function booleanOrDefault(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function positiveNumberOrDefault(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

module.exports = { createSettingsStore, DEFAULT_SETTINGS };
