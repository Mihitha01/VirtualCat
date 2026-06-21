const fs = require("fs");
const path = require("path");
const SETTINGS_VERSION = 1;

const DEFAULT_SETTINGS = Object.freeze({
  alwaysOnTop: true,
  clickThrough: true,
  startAtLogin: false,
  movementEnabled: true,
  spriteScale: 0.7,
  sleepAfterSeconds: 20,
  showStateLabel: false,
  animationSpeedMultiplier: 1
});

const NUMBER_LIMITS = Object.freeze({
  spriteScale: { minimum: 0.25, maximum: 0.85 },
  sleepAfterSeconds: { minimum: 5, maximum: 3600 },
  animationSpeedMultiplier: { minimum: 0.25, maximum: 3 }
});

function createSettingsStore(userDataPath) {
  const filePath = path.join(userDataPath, "settings.json");
  let settings = { ...DEFAULT_SETTINGS };

  function load() {
    try {
      const savedValue = JSON.parse(fs.readFileSync(filePath, "utf8"));
      settings = sanitizeSettings(migrateSettings(savedValue));
      if (savedValue.settingsVersion !== SETTINGS_VERSION) save();
    } catch (error) {
      settings = { ...DEFAULT_SETTINGS };
      if (error.code !== "ENOENT") save();
    }
    return get();
  }

  function save() {
    try {
      fs.mkdirSync(userDataPath, { recursive: true });
      fs.writeFileSync(
        filePath,
        JSON.stringify({ settingsVersion: SETTINGS_VERSION, ...settings }, null, 2),
        "utf8"
      );
      return true;
    } catch (error) {
      console.error("Could not save Virtual Cat settings.", error.message);
      return false;
    }
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
  return {
    alwaysOnTop: booleanOrDefault(source.alwaysOnTop, DEFAULT_SETTINGS.alwaysOnTop),
    clickThrough: booleanOrDefault(source.clickThrough, DEFAULT_SETTINGS.clickThrough),
    startAtLogin: booleanOrDefault(source.startAtLogin, DEFAULT_SETTINGS.startAtLogin),
    movementEnabled: booleanOrDefault(source.movementEnabled, DEFAULT_SETTINGS.movementEnabled),
    spriteScale: boundedNumberOrDefault(source.spriteScale, DEFAULT_SETTINGS.spriteScale, NUMBER_LIMITS.spriteScale),
    sleepAfterSeconds: boundedNumberOrDefault(source.sleepAfterSeconds, DEFAULT_SETTINGS.sleepAfterSeconds, NUMBER_LIMITS.sleepAfterSeconds),
    showStateLabel: booleanOrDefault(source.showStateLabel, DEFAULT_SETTINGS.showStateLabel),
    animationSpeedMultiplier: boundedNumberOrDefault(source.animationSpeedMultiplier, DEFAULT_SETTINGS.animationSpeedMultiplier, NUMBER_LIMITS.animationSpeedMultiplier)
  };
}

function migrateSettings(value) {
  const source = value && typeof value === "object" ? { ...value } : {};
  if (
    source.settingsVersion === undefined
    && [25, 60].includes(source.sleepAfterSeconds)
  ) {
    source.sleepAfterSeconds = DEFAULT_SETTINGS.sleepAfterSeconds;
  }
  return source;
}

function booleanOrDefault(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function boundedNumberOrDefault(value, fallback, limits) {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= limits.minimum
    && value <= limits.maximum
    ? value
    : fallback;
}

module.exports = { createSettingsStore, DEFAULT_SETTINGS, sanitizeSettings };
