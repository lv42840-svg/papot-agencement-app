"use strict";

const path = require("node:path");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveBusinessFolderPath(rootPath, rawInput) {
  if (typeof rootPath !== "string" || !rootPath.trim() || !path.isAbsolute(rootPath)) {
    throw new Error("DESKTOP_BUSINESS_FOLDER_ROOT_INVALID");
  }
  if (!rawInput || typeof rawInput !== "object" || rawInput.kind !== "commercial-case") {
    throw new Error("DESKTOP_BUSINESS_FOLDER_INVALID");
  }

  const caseId = typeof rawInput.caseId === "string" ? rawInput.caseId.trim() : "";
  const creationYear = rawInput.creationYear;
  if (!UUID_PATTERN.test(caseId)) throw new Error("DESKTOP_BUSINESS_FOLDER_INVALID");
  if (!Number.isInteger(creationYear) || creationYear < 2000 || creationYear > 9999) {
    throw new Error("DESKTOP_BUSINESS_FOLDER_INVALID");
  }

  const root = path.resolve(rootPath);
  const target = path.resolve(root, "documents", "commercial", String(creationYear), caseId);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("DESKTOP_BUSINESS_FOLDER_INVALID");
  }

  return target;
}

module.exports = { resolveBusinessFolderPath };
