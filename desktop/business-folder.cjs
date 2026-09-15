"use strict";

const path = require("node:path");

const WINDOWS_INVALID_SEGMENT = /[<>:"\\|?*\x00-\x1F]/;

function invalidSegments(segments) {
  return segments.some(
    (segment) =>
      !segment ||
      segment === "." ||
      segment === ".." ||
      WINDOWS_INVALID_SEGMENT.test(segment) ||
      /[. ]$/.test(segment),
  );
}

function resolveBusinessFolderPath(rootPath, rawInput) {
  if (typeof rootPath !== "string" || !rootPath.trim() || !path.isAbsolute(rootPath)) {
    throw new Error("DESKTOP_BUSINESS_FOLDER_ROOT_INVALID");
  }
  if (!rawInput || typeof rawInput !== "object" || rawInput.kind !== "commercial-case") {
    throw new Error("DESKTOP_BUSINESS_FOLDER_INVALID");
  }

  const storagePath = typeof rawInput.storagePath === "string" ? rawInput.storagePath.trim() : "";
  const segments = storagePath.split("/");
  const current = segments[0] === "Commercial";
  const legacy = segments[0] === "documents" && segments[1] === "commercial";
  const yearIndex = current ? 1 : 2;
  const affairEndIndex = current ? 3 : 4;

  if (
    (!current && !legacy) ||
    segments.length < (current ? 5 : 6) ||
    !/^\d{4}$/.test(segments[yearIndex] || "") ||
    Number(segments[yearIndex]) < 2000 ||
    Number(segments[yearIndex]) > 9999 ||
    invalidSegments(segments)
  ) {
    throw new Error("DESKTOP_BUSINESS_FOLDER_INVALID");
  }

  const root = path.resolve(rootPath);
  const target = path.resolve(root, ...segments.slice(0, affairEndIndex));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("DESKTOP_BUSINESS_FOLDER_INVALID");
  }

  return target;
}

module.exports = { resolveBusinessFolderPath };
