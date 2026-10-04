"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, session, shell } = require("electron");
const {
  DEFAULT_DESKTOP_APP_URL,
  isAllowedDesktopNavigation,
  normalizeLocalAppUrl,
} = require("./security.cjs");
const { databasePath, openLocalDatabase } = require("./local-database.cjs");
const { resolveBusinessFilePath, resolveBusinessFolderPath } = require("./business-folder.cjs");
const { openOutlookDraft } = require("./outlook-compose.cjs");
const { startDevelopmentServer, startPackagedServer } = require("./server-manager.cjs");

const appUrl = normalizeLocalAppUrl(process.env.PAPOT_APP_URL || DEFAULT_DESKTOP_APP_URL);
let localDatabase;
let developmentServer;

function isLocalStorageMode() {
  return (process.env.PAPOT_STORAGE_MODE || "local").toLowerCase() === "local";
}

function configureLocalStorageEnvironment() {
  const userDataPath = app.getPath("userData");
  process.env.PAPOT_STORAGE_MODE = "local";
  process.env.PAPOT_LOCAL_DB_PATH = process.env.PAPOT_LOCAL_DB_PATH || databasePath(userDataPath);
  process.env.PAPOT_LOCAL_FILES_PATH =
    process.env.PAPOT_LOCAL_FILES_PATH || path.join(userDataPath, "business-files");
  fs.mkdirSync(process.env.PAPOT_LOCAL_FILES_PATH, { recursive: true });
}

function desktopUrl(pathname) {
  return new URL(pathname, `${new URL(appUrl).origin}/`).toString();
}

function businessFilesRoot() {
  const rootPath =
    process.env.PAPOT_LOCAL_FILES_PATH?.trim() || process.env.PAPOT_SERVER_FILES_ROOT?.trim();
  if (!rootPath) throw new Error("DESKTOP_BUSINESS_FOLDER_ROOT_UNAVAILABLE");
  return rootPath;
}

function publicBusinessFolderError(error) {
  const code = error instanceof Error ? error.message : "DESKTOP_BUSINESS_FOLDER_OPEN_FAILED";
  const known = new Set([
    "DESKTOP_BUSINESS_FOLDER_INVALID",
    "DESKTOP_BUSINESS_FOLDER_ROOT_UNAVAILABLE",
    "DESKTOP_BUSINESS_FOLDER_NOT_FOUND",
    "DESKTOP_BUSINESS_FOLDER_OPEN_FAILED",
  ]);
  if (code === "DESKTOP_BUSINESS_FOLDER_ROOT_INVALID") {
    return "DESKTOP_BUSINESS_FOLDER_ROOT_UNAVAILABLE";
  }
  return known.has(code) ? code : "DESKTOP_BUSINESS_FOLDER_OPEN_FAILED";
}

function publicBusinessFileError(error) {
  const code = error instanceof Error ? error.message : "DESKTOP_BUSINESS_FILE_OPEN_FAILED";
  const known = new Set([
    "DESKTOP_BUSINESS_FILE_INVALID",
    "DESKTOP_BUSINESS_FILE_ROOT_UNAVAILABLE",
    "DESKTOP_BUSINESS_FILE_NOT_FOUND",
    "DESKTOP_BUSINESS_FILE_OPEN_FAILED",
  ]);
  if (
    code === "DESKTOP_BUSINESS_FILE_ROOT_INVALID" ||
    code === "DESKTOP_BUSINESS_FOLDER_ROOT_UNAVAILABLE"
  ) {
    return "DESKTOP_BUSINESS_FILE_ROOT_UNAVAILABLE";
  }
  return known.has(code) ? code : "DESKTOP_BUSINESS_FILE_OPEN_FAILED";
}

function registerBusinessFolderHandler() {
  ipcMain.handle("papot:business-folder:open", async (_event, rawInput) => {
    try {
      const target = resolveBusinessFolderPath(businessFilesRoot(), rawInput);
      let stats;
      try {
        stats = await fs.promises.stat(target);
      } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") {
          throw new Error("DESKTOP_BUSINESS_FOLDER_NOT_FOUND");
        }
        throw error;
      }
      if (!stats.isDirectory()) throw new Error("DESKTOP_BUSINESS_FOLDER_NOT_FOUND");

      const openError = await shell.openPath(target);
      if (openError) throw new Error("DESKTOP_BUSINESS_FOLDER_OPEN_FAILED");
      return { ok: true };
    } catch (error) {
      return { ok: false, error: publicBusinessFolderError(error) };
    }
  });
}

function registerBusinessFileHandler() {
  ipcMain.handle("papot:business-file:open", async (_event, rawInput) => {
    try {
      const target = resolveBusinessFilePath(businessFilesRoot(), rawInput);
      let stats;
      try {
        stats = await fs.promises.stat(target);
      } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") {
          throw new Error("DESKTOP_BUSINESS_FILE_NOT_FOUND");
        }
        throw error;
      }
      if (!stats.isFile()) throw new Error("DESKTOP_BUSINESS_FILE_NOT_FOUND");

      const openError = await shell.openPath(target);
      if (openError) throw new Error("DESKTOP_BUSINESS_FILE_OPEN_FAILED");
      return { ok: true };
    } catch (error) {
      return { ok: false, error: publicBusinessFileError(error) };
    }
  });
}

function publicOutlookError(error) {
  const code = error instanceof Error ? error.message : "OUTLOOK_OPEN_FAILED";
  const known = new Set([
    "OUTLOOK_COMPOSE_INVALID",
    "OUTLOOK_ATTACHMENT_NOT_FOUND",
    "OUTLOOK_OPEN_FAILED",
    "DESKTOP_BUSINESS_FILE_INVALID",
    "DESKTOP_BUSINESS_FILE_ROOT_UNAVAILABLE",
  ]);
  return known.has(code) ? code : "OUTLOOK_OPEN_FAILED";
}

function registerOutlookHandler() {
  ipcMain.handle("papot:outlook:compose", async (_event, rawInput) => {
    try {
      if (!rawInput || typeof rawInput !== "object" || rawInput.kind !== "quote-email") {
        throw new Error("OUTLOOK_COMPOSE_INVALID");
      }

      const attachmentPath = resolveBusinessFilePath(businessFilesRoot(), {
        kind: "commercial-document",
        storagePath: rawInput.storagePath,
      });

      let stats;
      try {
        stats = await fs.promises.stat(attachmentPath);
      } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") {
          throw new Error("OUTLOOK_ATTACHMENT_NOT_FOUND");
        }
        throw error;
      }
      if (!stats.isFile()) throw new Error("OUTLOOK_ATTACHMENT_NOT_FOUND");

      return await openOutlookDraft(
        {
          to: rawInput.to,
          subject: rawInput.subject,
          body: rawInput.body,
          attachmentPath,
        },
        {
          platform: process.platform,
          openExternal: (url) => shell.openExternal(url),
        },
      );
    } catch (error) {
      return { ok: false, error: publicOutlookError(error) };
    }
  });
}

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
      preload: path.join(__dirname, "preload.cjs"),
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
  window.loadURL(desktopUrl("/desktop-ready"));

  return window;
}

app.whenReady().then(async () => {
  if (isLocalStorageMode()) configureLocalStorageEnvironment();

  localDatabase = openLocalDatabase(app.getPath("userData"));

  const parsedAppUrl = new URL(appUrl);
  const serverConfig = {
    host: parsedAppUrl.hostname,
    port: Number(parsedAppUrl.port || 80),
  };

  if (app.isPackaged) {
    await startPackagedServer({
      resourcesPath: process.resourcesPath,
      ...serverConfig,
    });
  } else if (process.env.PAPOT_MANAGE_DEV_SERVER === "1") {
    developmentServer = await startDevelopmentServer({
      projectRoot: path.join(__dirname, ".."),
      ...serverConfig,
    });
  }

  registerBusinessFolderHandler();
  registerBusinessFileHandler();
  registerOutlookHandler();

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

app.on("before-quit", () => {
  if (developmentServer) {
    developmentServer.stop();
    developmentServer = undefined;
  }
  if (localDatabase) {
    localDatabase.close();
    localDatabase = undefined;
  }
});
