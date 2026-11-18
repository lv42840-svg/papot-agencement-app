import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { HttpError, segments } from "./files.mjs";

// The ACL file must be on a dedicated persistent mount OUTSIDE the explorer's /srv tree.
const emptyState = () => ({ format: 1, revision: 0, users: {}, grants: {} });
const queues = new Map();

export function accountKey(user) {
  if (
    !["agencement", "concept"].includes(user?.source) ||
    typeof user.id !== "string" ||
    !/^[A-Za-z0-9._:-]{1,160}$/.test(user.id)
  ) throw new HttpError(503, "Identité utilisateur invalide.");
  return `${user.source}:${user.id}`;
}

export function owner(config, user) {
  return !!config.ownerId && config.ownerSource === user.source && config.ownerId === user.id;
}

export function validateRules(input) {
  if (!Array.isArray(input) || input.length > 600)
    throw new HttpError(400, "Liste des autorisations invalide.");
  const seen = new Set();
  return input.map((item) => {
    if (
      !item || typeof item.path !== "string" ||
      typeof item.read !== "boolean" || typeof item.write !== "boolean" ||
      (item.write && !item.read)
    ) throw new HttpError(400, "Autorisation invalide.");
    const path = segments(item.path).join("/");
    if (path !== item.path || seen.has(path))
      throw new HttpError(400, "Dossier dupliqué ou chemin invalide.");
    seen.add(path);
    return { path, read: item.read, write: item.write };
  }).sort((a, b) => a.path.localeCompare(b.path));
}

function closestRule(rules, path) {
  const value = segments(path).join("/");
  let result = { read: false, write: false };
  let longest = -1;
  for (const rule of rules) {
    if (
      (rule.path === "" || value === rule.path || value.startsWith(`${rule.path}/`)) &&
      rule.path.length > longest
    ) {
      result = rule;
      longest = rule.path.length;
    }
  }
  return result;
}

export function canRead(rules, path) {
  return closestRule(rules, path).read;
}

export function canWrite(rules, path) {
  const result = closestRule(rules, path);
  return result.read && result.write;
}

// Let users traverse ancestors of explicitly allowed subfolders, never sibling data.
export function canBrowse(rules, path) {
  const value = segments(path).join("/");
  // Everyone can open the root, but only permitted children are ever listed.
  if (value === "") return true;
  if (canRead(rules, value)) return true;
  const prefix = value ? `${value}/` : "";
  return rules.some((rule) =>
    rule.read && rule.path.startsWith(prefix) && canRead(rules, rule.path)
  );
}

export function rulesFor(state, user) {
  return state.grants[accountKey(user)] || [];
}

function validState(state) {
  if (
    !state || state.format !== 1 || !Number.isSafeInteger(state.revision) ||
    state.revision < 0 || !state.users || Array.isArray(state.users) ||
    typeof state.users !== "object" || !state.grants ||
    Array.isArray(state.grants) || typeof state.grants !== "object"
  ) throw new Error("Invalid ACL state");
  for (const [key, user] of Object.entries(state.users)) {
    if (
      !/^(agencement|concept):[A-Za-z0-9._:-]{1,160}$/.test(key) ||
      !user || typeof user.username !== "string" ||
      typeof user.displayName !== "string" || !user.source ||
      !user.id || key !== accountKey(user)
    ) throw new Error("Invalid ACL account");
  }
  for (const [key, rules] of Object.entries(state.grants)) {
    if (!/^(agencement|concept):[A-Za-z0-9._:-]{1,160}$/.test(key))
      throw new Error("Invalid ACL rule key");
    validateRules(rules);
  }
  return state;
}

export async function readAccess(file) {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = await handle.stat();
    if (stats.size > 1048576) throw new Error("ACL too large");
    return validState(JSON.parse(await handle.readFile("utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return emptyState();
    throw new HttpError(503, "Les autorisations sont momentanément indisponibles.");
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function atomicWrite(file, state) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(JSON.stringify(state, null, 2) + "\n", "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, file);
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

function mutateAccess(file, action) {
  const last = queues.get(file) || Promise.resolve();
  const next = last.catch(() => {}).then(async () => {
    const state = await readAccess(file);
    const result = await action(state);
    if (result.changed) {
      try {
        await atomicWrite(file, state);
      } catch {
        throw new HttpError(503, "Impossible d'enregistrer les autorisations.");
      }
    }
    return result.value;
  });
  queues.set(file, next.catch(() => {}));
  return next;
}

export async function registerIdentity(file, user) {
  const key = accountKey(user);
  return mutateAccess(file, async (state) => {
    const previous = state.users[key];
    if (
      previous && previous.username === user.username &&
      previous.displayName === user.displayName
    ) return { changed: false, value: undefined };
    state.users[key] = {
      id: user.id, source: user.source,
      username: user.username, displayName: user.displayName,
    };
    return { changed: true, value: undefined };
  });
}

export async function replaceRules(file, key, revision, input) {
  const rules = validateRules(input);
  return mutateAccess(file, async (state) => {
    if (!state.users[key])
      throw new HttpError(400, "Compte inconnu.");
    if (!Number.isSafeInteger(revision) || state.revision !== revision)
      throw new HttpError(409, "Les autorisations ont changé. Actualisez avant d'enregistrer.");
    state.grants[key] = rules;
    state.revision++;
    return { changed: true, value: { revision: state.revision, rules } };
  });
}
