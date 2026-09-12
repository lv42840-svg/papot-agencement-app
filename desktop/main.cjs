"use strict";

const { app, BrowserWindow, session } = require("electron");
const {
  DEFAULT_DESKTOP_APP_URL,
  isAllowedDesktopNavigation,
  normalizeLocalAppUrl,
} = require("./security.cjs");

const appUrl = normalizeLocalAppUrl(process.env.PAPOT_APP_URL || DEFAULT_DESKTOP_APP_URL);

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f6f4fc",
    title: "PAPOT AGENCEMENT",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isAllowedDesktopNavigation(targetUrl, appUrl)) {
      event.preventDefault();
    }
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());

  window.once("ready-to-show", () => window.show());
  window.loadURL(appUrl);

  return window;
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
