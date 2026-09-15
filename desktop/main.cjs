"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, safeStorage, session, shell } = require("electron");
const {
  DEFAULT_DESKTOP_APP_URL,
  isAllowedDesktopNavigation,
  normalizeLocalAppUrl,
} = require("./security.cjs");
const {
  DEFAULT_SYNC_ROOT,
  hasDesktopSetup,
  normalizeSetupInput,
  readDesktopSetup,
  saveDesktopSetup,
} = require("./setup-store.cjs");
const { databasePath, openLocalDatabase } = require("./local-database.cjs");
const { resolveBusinessFilePath, resolveBusinessFolderPath } = require("./business-folder.cjs");
const { startDevelopmentServer, startPackagedServer } = require("./server-manager.cjs");

const appUrl = normalizeLocalAppUrl(process.env.PAPOT_APP_URL || DEFAULT_DESKTOP_APP_URL);
let localDatabase;
let developmentServer;

function isLocalStorageMode() {
  return (process.env.PAPOT_STORAGE_MODE || "local").toLowerCase() === "local";
}

function exposeSetupToLocalServer(setup) {
  if (!setup) {
    delete process.env.PAPOT_DESKTOP_CONFIG_JSON;
    delete process.env.PAPOT_NEXTCLOUD_APP_PASSWORD;
    return;
  }
  process.env.PAPOT_DESKTOP_CONFIG_JSON = JSON.stringify(setup.config);
  process.env.PAPOT_NEXTCLOUD_APP_PASSWORD = setup.nextcloudAppPassword;
}

function configureLocalStorageEnvironment() {
  const userDataPath = app.getPath("userData");
  process.env.PAPOT_STORAGE_MODE = "local";
  process.env.PAPOT_LOCAL_DB_PATH = process.env.PAPOT_LOCAL_DB_PATH || databasePath(userDataPath);
  process.env.PAPOT_LOCAL_FILES_PATH =
    process.env.PAPOT_LOCAL_FILES_PATH || path.join(userDataPath, "business-files");
  fs.mkdirSync(process.env.PAPOT_LOCAL_FILES_PATH, { recursive: true });
  exposeSetupToLocalServer(null);
}

function desktopUrl(pathname) {
  return new URL(pathname, `${new URL(appUrl).origin}/`).toString();
}

function authorization(login, password) {
  return `Basic ${Buffer.from(`${login}:${password}`, "utf8").toString("base64")}`;
}

async function verifySharedDataPath(sharedDataPath) {
  try {
    await fs.promises.access(sharedDataPath, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    throw new Error("DESKTOP_SHARED_PATH_UNAVAILABLE");
  }
}

async function discoverAndVerifyNextcloud(input) {
  const headers = {
    Authorization: authorization(input.nextcloudLogin, input.nextcloudAppPassword),
    "OCS-APIRequest": "true",
    Accept: "application/json",
  };

  let response;
  try {
    response = await fetch(`${input.nextcloudBaseUrl}/ocs/v1.php/cloud/user?format=json`, {
      headers,
    });
  } catch {
    throw new Error("DESKTOP_NEXTCLOUD_UNREACHABLE");
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("DESKTOP_NEXTCLOUD_AUTH_FAILED");
  }
  if (!response.ok) throw new Error("DESKTOP_NEXTCLOUD_UNREACHABLE");

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("DESKTOP_NEXTCLOUD_INVALID_RESPONSE");
  }

  const userId = body?.ocs?.data?.id;
  if (typeof userId !== "string" || !userId.trim()) {
    throw new Error("DESKTOP_NEXTCLOUD_INVALID_RESPONSE");
  }

  const davHeaders = {
    Authorization: authorization(input.nextcloudLogin, input.nextcloudAppPassword),
    Depth: "0",
  };
  const filesRoot = `${input.nextcloudBaseUrl}/remote.php/dav/files/${encodeURIComponent(userId)}`;
  const syncRoot = `${filesRoot}/${encodeURIComponent(DEFAULT_SYNC_ROOT)}`;

  let rootResponse;
  try {
    rootResponse = await fetch(`${filesRoot}/`, { method: "PROPFIND", headers: davHeaders });
  } catch {
    throw new Error("DESKTOP_NEXTCLOUD_UNREACHABLE");
  }
  if (rootResponse.status !== 207) throw new Error("DESKTOP_NEXTCLOUD_DAV_FAILED");

  let syncResponse = await fetch(`${syncRoot}/`, { method: "PROPFIND", headers: davHeaders });
  if (syncResponse.status === 404) {
    syncResponse = await fetch(syncRoot, {
      method: "MKCOL",
      headers: { Authorization: davHeaders.Authorization },
    });
    if (syncResponse.status !== 201 && syncResponse.status !== 405) {
      throw new Error("DESKTOP_NEXTCLOUD_SYNC_ROOT_FAILED");
    }
  } else if (syncResponse.status !== 207) {
    throw new Error("DESKTOP_NEXTCLOUD_SYNC_ROOT_FAILED");
  }

  return userId.trim();
}

function publicSetupError(error) {
  const code = error instanceof Error ? error.message : "DESKTOP_SETUP_FAILED";
  const known = new Set([
    "DESKTOP_SETUP_INVALID",
    "DESKTOP_SHARED_PATH_REQUIRED",
    "DESKTOP_SHARED_PATH_INVALID",
    "DESKTOP_SHARED_PATH_UNAVAILABLE",
    "DESKTOP_NEXTCLOUD_URL_REQUIRED",
    "DESKTOP_NEXTCLOUD_URL_INVALID",
    "DESKTOP_NEXTCLOUD_HTTPS_REQUIRED",
    "DESKTOP_NEXTCLOUD_LOGIN_REQUIRED",
    "DESKTOP_NEXTCLOUD_PASSWORD_REQUIRED",
    "DESKTOP_DEVICE_LABEL_REQUIRED",
    "DESKTOP_NEXTCLOUD_AUTH_FAILED",
    "DESKTOP_NEXTCLOUD_UNREACHABLE",
    "DESKTOP_NEXTCLOUD_INVALID_RESPONSE",
    "DESKTOP_NEXTCLOUD_DAV_FAILED",
    "DESKTOP_NEXTCLOUD_SYNC_ROOT_FAILED",
    "DESKTOP_SECRET_STORE_UNAVAILABLE",
    "DESKTOP_SECRET_ENCRYPTION_FAILED",
  ]);
  return known.has(code) ? code : "DESKTOP_SETUP_FAILED";
}

function registerDesktopSetupHandler() {
  ipcMain.handle("papot:desktop-setup:save", async (_event, rawInput) => {
    try {
      const input = normalizeSetupInput(rawInput);
      const [, nextcloudUserId] = await Promise.all([
        verifySharedDataPath(input.sharedDataPath),
        discoverAndVerifyNextcloud(input),
      ]);
      const config = saveDesktopSetup({
        userDataPath: app.getPath("userData"),
        input,
        nextcloudUserId,
        safeStorage,
      });
      exposeSetupToLocalServer(
        readDesktopSetup({ userDataPath: app.getPath("userData"), safeStorage }),
      );
      if (developmentServer) {
        await developmentServer.restart();
      }
      return {
        ok: true,
        config: {
          deviceId: config.device_id,
          deviceLabel: config.device_label,
          nextcloudUserId: config.nextcloud_user_id,
          sharedDataPath: config.shared_data_path,
        },
      };
    } catch (error) {
      return { ok: false, error: publicSetupError(error) };
    }
  });

  ipcMain.handle("papot:desktop-setup:finish", (event) => {
    if (!hasDesktopSetup({ userDataPath: app.getPath("userData"), safeStorage })) {
      return { ok: false };
    }
    event.sender.loadURL(desktopUrl("/first-admin"));
    return { ok: true };
  });
}

function businessFilesRoot() {
  if (isLocalStorageMode()) {
    const rootPath = process.env.PAPOT_LOCAL_FILES_PATH;
    if (!rootPath) throw new Error("DESKTOP_BUSINESS_FOLDER_ROOT_UNAVAILABLE");
    return rootPath;
  }

  const setup = readDesktopSetup({ userDataPath: app.getPath("userData"), safeStorage });
  const rootPath = setup?.config?.shared_data_path;
  if (typeof rootPath !== "string" || !rootPath.trim()) {
    throw new Error("DESKTOP_BUSINESS_FOLDER_ROOT_UNAVAILABLE");
  }
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
  const setupComplete = hasDesktopSetup({ userDataPath: app.getPath("userData"), safeStorage });
  window.loadURL(
    isLocalStorageMode() || setupComplete
      ? desktopUrl("/desktop-ready")
      : desktopUrl("/desktop-setup"),
  );

  return window;
}

app.whenReady().then(async () => {
  if (isLocalStorageMode()) {
    configureLocalStorageEnvironment();
  } else {
    const setup = readDesktopSetup({ userDataPath: app.getPath("userData"), safeStorage });
    exposeSetupToLocalServer(setup);
  }

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

  registerDesktopSetupHandler();
  registerBusinessFolderHandler();
  registerBusinessFileHandler();

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
