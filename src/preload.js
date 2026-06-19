const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("virtualCat", {
  onPetStateChanged: (callback) => subscribe("pet-state-changed", callback),
  onPetDirectionChanged: (callback) => subscribe("pet-direction-changed", callback),
  onPetModeChanged: (callback) => subscribe("pet-mode-changed", callback),
  onSettingsChanged: (callback) => subscribe("settings-changed", callback),
  setPetHovering: (isHovering) => ipcRenderer.send("pet-hover-changed", Boolean(isHovering)),
  toggleFollowMode: () => ipcRenderer.send("toggle-follow-mode"),
  reportInteraction: () => ipcRenderer.send("pet-interaction"),
  reportPetting: () => ipcRenderer.send("petting-detected")
});
