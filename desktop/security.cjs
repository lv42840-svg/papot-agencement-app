"use strict";

const DEFAULT_DESKTOP_APP_URL = "http://127.0.0.1:3000";
const ALLOWED_DESKTOP_HOSTS = new Set(["127.0.0.1", "localhost"]);

function normalizeLocalAppUrl(value = DEFAULT_DESKTOP_APP_URL) {
  const parsed = new URL(value);

  if (parsed.protocol !== "http:") {
    throw new Error("DESKTOP_APP_URL_HTTP_REQUIRED");
  }

  if (!ALLOWED_DESKTOP_HOSTS.has(parsed.hostname)) {
    throw new Error("DESKTOP_APP_URL_LOCALHOST_REQUIRED");
  }

  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";

  return parsed.toString().replace(/\/$/, "");
}

function isAllowedDesktopNavigation(targetUrl, appUrl) {
  try {
    return new URL(targetUrl).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

module.exports = {
  DEFAULT_DESKTOP_APP_URL,
  isAllowedDesktopNavigation,
  normalizeLocalAppUrl,
};
