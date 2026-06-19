const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("virtualCat", {
  onPetStateChanged: (callback) => {
    ipcRenderer.on("pet-state-changed", (_event, state) => {
      callback(state);
    });
  }
});