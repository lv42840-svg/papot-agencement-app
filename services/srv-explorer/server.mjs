import { createServer } from "node:http";
import { constants } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { access, readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import {
  HttpError,
  listFiles,
  openFile,
  createFolder,
  uploadFile,
  previewType,
  byteRange,
} from "./files.mjs";
import { directory, segments } from "./files.mjs";
import {
  accountKey,
  owner,
  canRead,
  canWrite,
  canBrowse,
  rulesFor,
  readAccess,
  registerIdentity,
  replaceRules,
  validateRules,
} from "./access.mjs";

const COOKIE = "__Host-papot_srv";
const MAX_AGE = 12 * 60 * 60;
const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
]);

export function configFromEnv(env = process.env) {
  if (!/^[0-9a-f]{64}$/i.test(env.SRV_SESSION_KEY || ""))
    throw new Error("SRV_SESSION_KEY doit contenir 64 caractères hexadécimaux aléatoires.");
  const origin = env.SRV_PUBLIC_ORIGIN || "https://srv.papot.app";
  if (new URL(origin).origin !== origin || !origin.startsWith("https://"))
    throw new Error("SRV_PUBLIC_ORIGIN doit être une origine HTTPS.");
  const sources = {
    agencement: {
      base: env.SRV_AGENCEMENT_URL || "http://127.0.0.1:3002",
      cookie: env.SRV_AGENCEMENT_COOKIE || "papot_agencement_session",
    },
    concept: {
      base: env.SRV_CONCEPT_URL || "http://127.0.0.1:3001",
      cookie: env.SRV_CONCEPT_COOKIE || "papot_concept_session",
    },
  };
  for (const source of Object.values(sources)) {
    const url = new URL(source.base);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
    )
      throw new Error("Serveur de connexion invalide.");
    if (!/^[A-Za-z0-9_-]+$/.test(source.cookie)) throw new Error("Nom de cookie invalide.");
  }
  // Owner is pinned to an immutable account ID, never a freely typed login name.
  const ownerSource = env.SRV_ADMIN_SOURCE || "agencement";
  const ownerId = env.SRV_ADMIN_USER_ID || "";
  if (!["agencement", "concept"].includes(ownerSource) || !/^[A-Za-z0-9._:-]{1,160}$/.test(ownerId))
    throw new Error("Configurer SRV_ADMIN_SOURCE et SRV_ADMIN_USER_ID avant démarrage.");
  const accessFile = env.SRV_ACCESS_FILE || "/state/access.json";
  const root = env.SRV_ROOT || "/data";
  if (
    !isAbsolute(accessFile) ||
    !/\/[a-zA-Z0-9._-]+\.json$/.test(accessFile) ||
    resolve(accessFile).startsWith(resolve(root) + sep)
  )
    throw new Error("Les autorisations doivent être stockées en dehors des documents.");
  const maxUpload = Number(env.SRV_MAX_UPLOAD_BYTES || 536870912);
  if (!Number.isSafeInteger(maxUpload) || maxUpload < 1)
    throw new Error("Limite de dépôt invalide.");
  return {
    root,
    accessFile,
    ownerSource,
    ownerId,
    origin,
    key: Buffer.from(env.SRV_SESSION_KEY, "hex"),
    sources,
    maxUpload,
  };
}

export function seal(payload, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(COOKIE));
  const data = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

export function unseal(value, key) {
  try {
    if (!value || value.length > 4096) return null;
    const data = Buffer.from(value, "base64url");
    const cipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
    cipher.setAAD(Buffer.from(COOKIE));
    cipher.setAuthTag(data.subarray(12, 28));
    const parsed = JSON.parse(
      Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString(),
    );
    if (
      !["agencement", "concept"].includes(parsed.source) ||
      typeof parsed.token !== "string" ||
      !/^[A-Za-z0-9._~%+-]{1,2048}$/.test(parsed.token) ||
      !Number.isFinite(parsed.expires) ||
      parsed.expires <= Date.now()
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function cookie(value, age = MAX_AGE) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
}
function json(response, status, data, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(data));
}
async function readJson(request, limit = 8192) {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new HttpError(415, "Format de requête invalide.");
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > limit) throw new HttpError(413, "Requête trop volumineuse.");
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, "Requête invalide.");
  }
}

function clientIp(request) {
  const remote = request.socket.remoteAddress;
  const header = request.headers["x-papot-client-ip"];
  if (
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote) &&
    typeof header === "string" &&
    isIP(header)
  )
    return header;
  return remote || "unknown";
}

export function createExplorer(config) {
  const attempts = new Map();
  async function upstream(source, path, options = {}) {
    try {
      return await fetch(`${config.sources[source].base}${path}`, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new HttpError(
        503,
        "L’application de connexion est indisponible. Réessayez dans un instant.",
      );
    }
  }
  async function identity(session) {
    const result = await upstream(session.source, "/api/auth/identity", {
      headers: { Cookie: `${config.sources[session.source].cookie}=${session.token}` },
    });
    if (result.status === 401 || result.status === 403)
      throw new HttpError(401, "Votre session a expiré. Reconnectez-vous.");
    if (!result.ok) throw new HttpError(503, "La vérification du compte est indisponible.");
    const user = await result.json();
    if (typeof user.id !== "string" || typeof user.username !== "string")
      throw new HttpError(503, "Réponse de connexion invalide.");
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName || user.username,
      source: session.source,
    };
  }

  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "SAMEORIGIN");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
    );
    try {
      const url = new URL(request.url, config.origin);
      const method = request.method;
      if (!["GET", "HEAD", "POST", "PUT"].includes(method))
        throw new HttpError(405, "Méthode non autorisée.");
      if (["POST", "PUT"].includes(method) && request.headers.origin !== config.origin)
        throw new HttpError(403, "Origine de requête refusée.");
      if (url.pathname === "/health" && method === "GET") {
        // A live HTTP process is not enough: the document mount and ACL storage
        // must be available before the explorer can serve users safely.
        try {
          const rootHandle = await directory(config.root, []);
          await rootHandle.close();
          await access(dirname(config.accessFile), constants.R_OK | constants.W_OK);
          await readAccess(config.accessFile);
        } catch {
          return json(response, 503, { ok: false });
        }
        return json(response, 200, { ok: true });
      }
      if (staticFiles.has(url.pathname) && ["GET", "HEAD"].includes(method)) {
        const [file, mime] = staticFiles.get(url.pathname);
        const contents = await readFile(new URL(`public/${file}`, import.meta.url));
        response.writeHead(200, { "Content-Type": mime, "Content-Length": contents.length });
        return response.end(method === "HEAD" ? undefined : contents);
      }
      if (url.pathname === "/api/login" && method === "POST") {
        const ip = clientIp(request);
        const now = Date.now();
        for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
        if (!attempts.has(ip) && attempts.size >= 10000)
          throw new HttpError(429, "Réessayez dans quelques minutes.");
        const bucket = attempts.get(ip) || { count: 0, until: now + 15 * 60000 };
        bucket.count++;
        attempts.set(ip, bucket);
        if (bucket.count > 30)
          return json(
            response,
            429,
            { error: "Trop de tentatives. Réessayez dans quelques minutes." },
            { "Retry-After": Math.ceil((bucket.until - now) / 1000) },
          );
        const data = await readJson(request);
        if (
          !data ||
          !["agencement", "concept"].includes(data.source) ||
          typeof data.username !== "string" ||
          !data.username.trim() ||
          data.username.length > 80 ||
          typeof data.password !== "string" ||
          !data.password ||
          data.password.length > 512
        )
          throw new HttpError(400, "Identifiants invalides.");
        const result = await upstream(data.source, "/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Papot-Client-IP": ip },
          body: JSON.stringify({ username: data.username, password: data.password }),
        });
        if (!result.ok) {
          const status = [400, 401, 423, 429].includes(result.status) ? result.status : 503;
          const messages = {
            400: "Identifiants invalides.",
            401: "Identifiant ou mot de passe incorrect.",
            423: "Compte verrouillé. Contactez votre administrateur.",
            429: "Trop de tentatives. Réessayez dans quelques minutes.",
            503: "L’application de connexion est indisponible.",
          };
          const retry = result.headers.get("retry-after");
          return json(
            response,
            status,
            { error: messages[status] },
            /^\d+$/.test(retry || "") ? { "Retry-After": retry } : {},
          );
        }
        const prefix = `${config.sources[data.source].cookie}=`;
        const setCookie = result.headers.getSetCookie().find((value) => value.startsWith(prefix));
        const token = setCookie?.slice(prefix.length).split(";")[0];
        const session = { source: data.source, token, expires: now + MAX_AGE * 1000 };
        if (!token || !/^[A-Za-z0-9._~%+-]{1,2048}$/.test(token))
          throw new HttpError(
            503,
            "Cookie de connexion absent ou invalide. Vérifiez la configuration.",
          );
        const user = await identity(session);
        await registerIdentity(config.accessFile, user);
        response.setHeader("Set-Cookie", cookie(seal(session, config.key)));
        return json(response, 200, {
          user: { ...user, isAdmin: owner(config, user) },
          maxUpload: config.maxUpload,
        });
      }
      const rawCookie = (request.headers.cookie || "")
        .split(";")
        .map((item) => item.trim())
        .find((item) => item.startsWith(`${COOKIE}=`))
        ?.slice(COOKIE.length + 1);
      const session = unseal(rawCookie, config.key);
      if (url.pathname === "/api/logout" && method === "POST") {
        if (session) {
          const result = await upstream(session.source, "/api/auth/logout", {
            method: "POST",
            headers: { Cookie: `${config.sources[session.source].cookie}=${session.token}` },
          });
          if (!result.ok) throw new HttpError(503, "Déconnexion indisponible. Réessayez.");
        }
        response.setHeader("Set-Cookie", cookie("", 0));
        return json(response, 200, { ok: true });
      }
      if (!session) throw new HttpError(401, "Connectez-vous avec votre compte PAPOT.");
      const user = await identity(session); // Every request re-checks revocation.
      await registerIdentity(config.accessFile, user);
      const isAdmin = owner(config, user);
      if (url.pathname === "/api/me" && method === "GET")
        return json(response, 200, { user: { ...user, isAdmin }, maxUpload: config.maxUpload });

      if (url.pathname.startsWith("/api/admin/")) {
        if (!isAdmin) throw new HttpError(403, "Accès administrateur uniquement.");
        if (url.pathname === "/api/admin/access" && method === "GET") {
          const acl = await readAccess(config.accessFile);
          return json(response, 200, {
            revision: acl.revision,
            users: Object.entries(acl.users)
              .filter(([key]) => key !== accountKey(user))
              .map(([key, value]) => ({ key, ...value }))
              .sort((a, b) => a.displayName.localeCompare(b.displayName, "fr")),
            grants: acl.grants,
          });
        }
        if (url.pathname === "/api/admin/directories" && method === "GET") {
          const path = url.searchParams.get("path") || "";
          const data = await listFiles(config.root, path);
          return json(response, 200, {
            path,
            entries: data.entries.filter((item) => item.directory),
            truncated: data.truncated,
          });
        }
        if (url.pathname === "/api/admin/access" && method === "POST") {
          const data = await readJson(request, 131072);
          if (!data || typeof data.key !== "string" || !data.key || !Array.isArray(data.rules))
            throw new HttpError(400, "Autorisations invalides.");
          const rules = validateRules(data.rules);
          // Only actual, accessible directories can be granted.
          for (const rule of rules) {
            const handle = await directory(config.root, segments(rule.path));
            await handle.close();
          }
          const result = await replaceRules(config.accessFile, data.key, data.revision, rules);
          return json(response, 200, result);
        }
        throw new HttpError(404, "Page introuvable.");
      }

      const acl = isAdmin ? null : await readAccess(config.accessFile);
      const rules = acl ? rulesFor(acl, user) : [];
      const path = url.searchParams.get("path") || "";
      if (url.pathname === "/api/files" && method === "GET") {
        if (!isAdmin && !canBrowse(rules, path))
          throw new HttpError(403, "Accès à ce dossier non autorisé.");
        const data = await listFiles(config.root, path);
        if (!isAdmin)
          data.entries = data.entries.filter((item) => {
            const child = [path, item.name].filter(Boolean).join("/");
            return item.directory ? canBrowse(rules, child) : canRead(rules, child);
          });
        data.canWrite = isAdmin || canWrite(rules, path);
        return json(response, 200, data);
      }
      if (url.pathname === "/api/folders" && method === "POST") {
        if (!isAdmin && !canWrite(rules, path))
          throw new HttpError(403, "Création de dossier non autorisée.");
        const data = await readJson(request);
        if (!data || typeof data.name !== "string") throw new HttpError(400, "Nom invalide.");
        await createFolder(config.root, path, data.name);
        return json(response, 201, { ok: true });
      }
      if (url.pathname === "/api/upload" && method === "PUT") {
        if (!isAdmin && !canWrite(rules, path)) throw new HttpError(403, "Dépôt non autorisé.");
        const length = Number(request.headers["content-length"]);
        if (!Number.isSafeInteger(length) || length < 0)
          throw new HttpError(411, "Taille du fichier requise.");
        if (length > config.maxUpload) throw new HttpError(413, "Fichier trop volumineux.");
        await uploadFile(
          config.root,
          path,
          url.searchParams.get("name") || "",
          request,
          config.maxUpload,
        );
        return json(response, 201, { ok: true });
      }
      if (url.pathname === "/api/file" && ["GET", "HEAD"].includes(method)) {
        if (!isAdmin && !canRead(rules, path))
          throw new HttpError(403, "Lecture du document non autorisée.");
        const { handle, stat, name } = await openFile(config.root, path);
        try {
          const type = previewType(name);
          const inline = url.searchParams.get("preview") === "1" && type;
          let range;
          try {
            range = byteRange(request.headers.range, stat.size);
          } catch (error) {
            response.setHeader("Content-Range", `bytes */${stat.size}`);
            throw error;
          }
          const safeName = encodeURIComponent(name).replace(
            /['()*]/g,
            (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
          );
          response.setHeader(
            "Content-Security-Policy",
            `${inline && type === "application/pdf" ? "" : "sandbox; "}default-src 'none'; frame-ancestors 'self'`,
          );
          response.writeHead(range ? 206 : 200, {
            "Content-Type": inline ? type : "application/octet-stream",
            "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${safeName}`,
            "Content-Length": range ? range.end - range.start + 1 : stat.size,
            "Accept-Ranges": "bytes",
            ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}` } : {}),
          });
          if (method === "HEAD" || stat.size === 0) response.end();
          else await pipeline(handle.createReadStream({ ...range, autoClose: false }), response);
        } finally {
          await handle.close();
        }
        return;
      }
      throw new HttpError(404, "Page introuvable.");
    } catch (error) {
      if (response.headersSent || response.destroyed) {
        response.destroy();
        return;
      }
      const mapped = {
        ENOENT: [404, "Dossier ou fichier introuvable."],
        EEXIST: [409, "Ce nom existe déjà. Aucun fichier n’a été remplacé."],
        EACCES: [403, "Le serveur ne permet pas cet accès."],
        EPERM: [403, "Le serveur ne permet pas cet accès."],
        ELOOP: [403, "Les liens symboliques ne sont pas accessibles."],
        ENOTDIR: [400, "Chemin de dossier invalide."],
        ENOSPC: [507, "Espace disque insuffisant."],
      }[error.code];
      const status = error instanceof HttpError ? error.status : mapped?.[0] || 500;
      if (status === 401) response.setHeader("Set-Cookie", cookie("", 0));
      // Never log credentials, cookies, paths or upstream response bodies.
      if (status === 500) console.error("srv-explorer: request failed", error.code || error.name);
      json(response, status, {
        error: error instanceof HttpError ? error.message : mapped?.[1] || "Erreur du serveur.",
      });
    }
  });
  server.requestTimeout = 15 * 60 * 1000;
  server.headersTimeout = 30000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createExplorer(configFromEnv());
  const port = Number(process.env.PORT || 3003);
  server.listen(port, "127.0.0.1", () =>
    console.log(`srv-explorer listening on 127.0.0.1:${port}`),
  );
  const shutdown = () => {
    server.close();
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
