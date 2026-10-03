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

function commercialStorageSegments(rawInput, expectedKind) {
  if (!rawInput || typeof rawInput !== "object" || rawInput.kind !== expectedKind) {
    throw new Error(
      expectedKind === "commercial-document"
        ? "DESKTOP_BUSINESS_FILE_INVALID"
        : "DESKTOP_BUSINESS_FOLDER_INVALID",
    );
  }

  const storagePath = typeof rawInput.storagePath === "string" ? rawInput.storagePath.trim() : "";
  const segments = storagePath.split("/");
  const errorCode =
    expectedKind === "commercial-document"
      ? "DESKTOP_BUSINESS_FILE_INVALID"
      : "DESKTOP_BUSINESS_FOLDER_INVALID";

  if (
    segments.length < 5 ||
    segments[0] !== "Commercial" ||
    !/^\d{4}$/.test(segments[1] || "") ||
    Number(segments[1]) < 2000 ||
    Number(segments[1]) > 9999 ||
    invalidSegments(segments)
  ) {
    throw new Error(errorCode);
  }

  return segments;
}

function resolveRoot(rootPath, errorCode) {
  if (typeof rootPath !== "string" || !rootPath.trim() || !path.isAbsolute(rootPath)) {
    throw new Error(errorCode);
  }
  return path.resolve(rootPath);
}

function assertInsideRoot(root, target, errorCode) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(errorCode);
  }
}

function resolveBusinessFolderPath(rootPath, rawInput) {
  const root = resolveRoot(rootPath, "DESKTOP_BUSINESS_FOLDER_ROOT_INVALID");
  const segments = commercialStorageSegments(rawInput, "commercial-case");
  const target = path.resolve(root, ...segments.slice(0, 3));
  assertInsideRoot(root, target, "DESKTOP_BUSINESS_FOLDER_INVALID");
  return target;
}

function resolveBusinessFilePath(rootPath, rawInput) {
  const root = resolveRoot(rootPath, "DESKTOP_BUSINESS_FILE_ROOT_INVALID");
  const segments = commercialStorageSegments(rawInput, "commercial-document");
  const target = path.resolve(root, ...segments);
  assertInsideRoot(root, target, "DESKTOP_BUSINESS_FILE_INVALID");
  return target;
}

module.exports = { resolveBusinessFilePath, resolveBusinessFolderPath };
