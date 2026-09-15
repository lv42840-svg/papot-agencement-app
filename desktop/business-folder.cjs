"use strict";

const path = require("node:path");

const WINDOWS_INVALID_SEGMENT = /[<>:"\\|?*\x00-\x1F]/;

function resolveBusinessFolderPath(rootPath, rawInput) {
  if (typeof rootPath !== "string" || !rootPath.trim() || !path.isAbsolute(rootPath)) {
    throw new Error("DESKTOP_BUSINESS_FOLDER_ROOT_INVALID");
  }
  if (!rawInput || typeof rawInput !== "object" || rawInput.kind !== "commercial-case") {
    throw new Error("DESKTOP_BUSINESS_FOLDER_INVALID");
  }

  const storagePath = typeof rawInput.storagePath === "string" ? rawInput.storagePath.trim() : "";
  const segments = storagePath.split("/");
  if (
    segments.length < 6 ||
    segments[0] !== "documents" ||
    segments[1] !== "commercial" ||
    !/^\d{4}$/.test(segments[2] || "") ||
    Number(segments[2]) < 2000 ||
    Number(segments[2]) > 9999 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        WINDOWS_INVALID_SEGMENT.test(segment) ||
        /[. ]$/.test(segment),
    )
  ) {
    throw new Error("DESKTOP_BUSINESS_FOLDER_INVALID");
  }

  const root = path.resolve(rootPath);
  const target = path.resolve(root, ...segments.slice(0, 4));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("DESKTOP_BUSINESS_FOLDER_INVALID");
  }

  return target;
}

module.exports = { resolveBusinessFolderPath };
