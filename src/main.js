const { app, BrowserWindow } = require("electron");
const path = require("path");

function createCatWindow() {
  const catWindow = new BrowserWindow({
    width: 200,
    height: 200,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false
  });

  catWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  createCatWindow();
});