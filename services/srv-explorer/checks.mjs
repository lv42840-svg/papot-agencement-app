import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { createExplorer, configFromEnv, seal, unseal } from "./server.mjs";
import { uploadFile, byteRange } from "./files.mjs";

const origin = "https://srv.papot.app";
let root, outside, server, upstream, base, config, sessionCookie, accessRoot;
let active = true,
  unavailable = false,
  loginStatus = 200,
  clientIpSeen;
const tokens = new Map();
const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)),
  );
const close = (server) =>
  new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
async function call(path, options = {}) {
  return fetch(`${base}${path}`, {
    ...options,
    headers: { Origin: origin, Cookie: sessionCookie || "", ...options.headers },
  });
}
async function login(source = "agencement", username = "lucien") {
  const response = await call("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Papot-Client-IP": "192.0.2.15" },
    body: JSON.stringify({ source, username, password: "test-only-password" }),
  });
  if (response.ok) sessionCookie = response.headers.get("set-cookie").split(";")[0];
  return response;
}
before(async () => {
  root = await mkdtemp(`${tmpdir()}/papot-srv-`);
  outside = await mkdtemp(`${tmpdir()}/papot-outside-`);
  accessRoot = await mkdtemp(`${tmpdir()}/papot-access-`);
  await mkdir(`${root}/Chantiers`);
  await mkdir(`${root}/Chantiers/Interdit`);
  await mkdir(`${root}/Chantiers/Interdit/Autorise`);
  await writeFile(`${root}/Chantiers/Interdit/secret.txt`, "confidentiel");
  await writeFile(`${root}/Chantiers/Interdit/Autorise/lire.txt`, "autorise");
  await writeFile(`${root}/Chantiers/plan.pdf`, "%PDF-1.4 test");
  await writeFile(`${root}/photo été.jpg`, "image");
  await writeFile(`${root}/.env`, "secret");
  await writeFile(`${root}/danger.html`, "<script>alert(1)</script>");
  await writeFile(`${outside}/private.txt`, "outside");
  await symlink(outside, `${root}/escape`);
  await symlink(`${outside}/private.txt`, `${root}/link.txt`);
  upstream = createServer(async (req, res) => {
    if (unavailable) {
      res.writeHead(503);
      return res.end("{}");
    }
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/auth/login") {
      clientIpSeen = req.headers["x-papot-client-ip"];
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const { username, password } = JSON.parse(raw);
      if (
        loginStatus !== 200 ||
        !["lucien", "collegue"].includes(username) ||
        password !== "test-only-password"
      ) {
        res.writeHead(loginStatus === 200 ? 401 : loginStatus, { "Retry-After": "900" });
        return res.end("{}");
      }
      const token = randomBytes(32).toString("hex");
      tokens.set(token, username);
      res.setHeader("Set-Cookie", [
        `papot_session=${token}; HttpOnly; Secure; Path=/`,
        `papot_concept_session=${token}; HttpOnly; Secure; Path=/`,
      ]);
      return res.end('{"ok":true}');
    }
    const token = req.headers.cookie?.split("=")[1];
    if (req.url === "/api/auth/logout") {
      tokens.delete(token);
      return res.end('{"ok":true}');
    }
    if (req.url === "/api/auth/identity" && active && tokens.has(token)) {
      const username = tokens.get(token);
      return res.end(
        JSON.stringify({
          id: username === "lucien" ? "user-1" : "user-2",
          username,
          displayName: username === "lucien" ? "Lucien" : "Collègue",
        }),
      );
    }
    res.writeHead(401);
    res.end("{}");
  });
  const upstreamUrl = await listen(upstream);
  config = configFromEnv({
    SRV_SESSION_KEY: randomBytes(32).toString("hex"),
    SRV_ROOT: root,
    SRV_AGENCEMENT_URL: upstreamUrl,
    SRV_CONCEPT_URL: upstreamUrl,
    SRV_MAX_UPLOAD_BYTES: "1024",
    SRV_ADMIN_SOURCE: "agencement",
    SRV_ADMIN_USER_ID: "user-1",
    SRV_ACCESS_FILE: `${accessRoot}/permissions.json`,
  });
  server = createExplorer(config);
  base = await listen(server);
});
after(async () => {
  await close(server);
  await close(upstream);
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
  await rm(accessRoot, { recursive: true, force: true });
});

test("anonymous clients cannot list, preview or upload files", async () => {
  for (const path of ["/api/files", "/api/file?path=photo%20%C3%A9t%C3%A9.jpg", "/api/me"])
    assert.equal((await call(path)).status, 401);
  assert.equal((await call("/api/upload?name=x", { method: "PUT", body: "x" })).status, 401);
});
test("login reuses both apps, encrypts the session and preserves proxy client IP", async () => {
  for (const source of ["agencement", "concept"]) {
    const response = await login(source);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.source, source);
    const header = response.headers.get("set-cookie");
    for (const value of ["__Host-papot_srv=", "Secure", "HttpOnly", "SameSite=Strict", "Path=/"])
      assert.ok(header.includes(value));
    assert.ok(!header.includes("test-only-password"));
    assert.equal((await call("/api/files")).status, 200);
  }
  assert.equal(clientIpSeen, "192.0.2.15");
  await login("agencement"); // Other tests use the explicitly configured owner.
});
test("CSRF and invalid source are rejected before upstream authentication", async () => {
  assert.equal(
    (
      await call("/api/login", {
        method: "POST",
        headers: { Origin: "https://evil.example" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (await call("/api/folders", { method: "POST", headers: { Origin: "" }, body: "{}" })).status,
    403,
  );
  assert.equal(
    (
      await call("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"source":"https://evil.example","username":"x","password":"x"}',
      })
    ).status,
    400,
  );
});
test("upstream account locks and retry delays are preserved", async () => {
  for (const status of [401, 423, 429]) {
    loginStatus = status;
    const response = await login();
    assert.equal(response.status, status);
    assert.equal(response.headers.get("retry-after"), "900");
  }
  loginStatus = 200;
});
test("listing handles unicode and hides symlinks and technical dotfiles", async () => {
  const data = await (await call("/api/files")).json();
  assert.equal(data.entries[0].name, "Chantiers");
  assert.ok(data.entries.some((item) => item.name === "photo été.jpg"));
  assert.ok(!data.entries.some((item) => ["escape", "link.txt", ".env"].includes(item.name)));
});
test("traversal, symlink escape and dotfiles are refused for reads and writes", async () => {
  for (const path of [
    "../private.txt",
    "Chantiers/../../private.txt",
    "escape/private.txt",
    "link.txt",
    ".env",
    "Chantiers\\..\\.env",
  ]) {
    const result = await call(`/api/file?${new URLSearchParams({ path })}`);
    assert.ok([400, 403].includes(result.status), `${path}: ${result.status}`);
  }
  for (const path of ["../", "escape", ".env"]) {
    const result = await call(`/api/upload?${new URLSearchParams({ path, name: "new.txt" })}`, {
      method: "PUT",
      body: "bad",
    });
    assert.ok([400, 403].includes(result.status));
  }
  assert.deepEqual(await readdir(outside), ["private.txt"]);
});
test("file previews, downloads, HEAD and PDF byte ranges use safe headers", async () => {
  const response = await call("/api/file?path=Chantiers/plan.pdf&preview=1", {
    headers: { Range: "bytes=0-3" },
  });
  assert.equal(response.status, 206);
  assert.equal(await response.text(), "%PDF");
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("content-range"), "bytes 0-3/13");
  assert.ok(response.headers.get("content-security-policy").includes("default-src 'none'"));
  const html = await call("/api/file?path=danger.html&preview=1");
  assert.ok(html.headers.get("content-disposition").startsWith("attachment"));
  assert.equal(html.headers.get("content-type"), "application/octet-stream");
  const head = await call("/api/file?path=Chantiers/plan.pdf", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(
    (await call("/api/file?path=Chantiers/plan.pdf", { headers: { Range: "bytes=99-100" } }))
      .status,
    416,
  );
});
test("folder creation and upload work without overwriting existing app documents", async () => {
  assert.equal(
    (
      await call("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"name":"Nouveau"}',
      })
    ).status,
    201,
  );
  const upload = "/api/upload?path=Nouveau&name=note.txt";
  assert.equal((await call(upload, { method: "PUT", body: "premier" })).status, 201);
  assert.equal((await call(upload, { method: "PUT", body: "second" })).status, 409);
  assert.equal(await readFile(`${root}/Nouveau/note.txt`, "utf8"), "premier");
  assert.equal(
    (await call("/api/upload?name=large", { method: "PUT", body: "x".repeat(1025) })).status,
    413,
  );
  assert.deepEqual(await readdir(`${root}/Nouveau`), ["note.txt"]);
});
test("interrupted/oversized streams never publish partial files", async () => {
  await assert.rejects(
    uploadFile(
      root,
      "",
      "partial.txt",
      Readable.from(
        (async function* () {
          yield "partial";
          throw new Error("interrupted");
        })(),
      ),
      1024,
    ),
  );
  await assert.rejects(
    uploadFile(root, "", "too-big.txt", Readable.from(["x".repeat(1025)]), 1024),
  );
  const names = await readdir(root);
  assert.ok(
    !names.includes("partial.txt") &&
      !names.includes("too-big.txt") &&
      !names.some((name) => name.startsWith(".papot-upload-")),
  );
});

test("unknown users are denied by default, including direct URLs and writes", async () => {
  await login("agencement", "collegue");
  const rootResponse = await call("/api/files");
  assert.equal(rootResponse.status, 200);
  assert.deepEqual((await rootResponse.json()).entries, []);
  assert.equal((await call("/api/file?path=Chantiers/plan.pdf")).status, 403);
  assert.equal((await call("/api/admin/access")).status, 403);
  assert.equal((await call("/api/admin/directories")).status, 403);
  assert.equal(
    (
      await call("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "non" }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/upload?path=Chantiers&name=refus.txt", {
        method: "PUT",
        body: "x",
      })
    ).status,
    403,
  );
  await login("agencement");
});

test("owner grants, inherits, overrides and revokes folder access", async () => {
  await login("agencement");
  const adminData = await (await call("/api/admin/access")).json();
  const key = "agencement:user-2";
  assert.ok(adminData.users.some((u) => u.key === key));
  const save = async (revision, rules) =>
    call("/api/admin/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, revision, rules }),
    });
  let response = await save(adminData.revision, [
    { path: "Chantiers", read: true, write: false },
    { path: "Chantiers/Interdit", read: false, write: false },
    { path: "Chantiers/Interdit/Autorise", read: true, write: false },
  ]);
  assert.equal(response.status, 200);
  let revision = (await response.json()).revision;
  assert.equal((await save(adminData.revision, [])).status, 409);
  assert.equal((await call("/api/admin/directories?path=Chantiers")).status, 200);
  await login("agencement", "collegue");
  let data = await (await call("/api/files")).json();
  assert.deepEqual(
    data.entries.map((e) => e.name),
    ["Chantiers"],
  );
  data = await (await call("/api/files?path=Chantiers")).json();
  assert.equal(data.canWrite, false);
  assert.deepEqual(
    data.entries.map((e) => e.name),
    ["Interdit", "plan.pdf"],
  );
  assert.equal((await call("/api/file?path=Chantiers/plan.pdf")).status, 200);
  assert.equal((await call("/api/file?path=Chantiers/Interdit/secret.txt")).status, 403);
  data = await (await call("/api/files?path=Chantiers/Interdit")).json();
  assert.deepEqual(
    data.entries.map((e) => e.name),
    ["Autorise"],
  );
  assert.equal((await call("/api/file?path=Chantiers/Interdit/Autorise/lire.txt")).status, 200);
  assert.equal(
    (
      await call("/api/upload?path=Chantiers&name=refus.txt", {
        method: "PUT",
        body: "x",
      })
    ).status,
    403,
  );
  await login("agencement");
  response = await save(revision, [{ path: "Chantiers", read: true, write: true }]);
  assert.equal(response.status, 200);
  revision = (await response.json()).revision;
  await login("agencement", "collegue");
  assert.equal(
    (
      await call("/api/folders?path=Chantiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Devis" }),
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await call("/api/upload?path=Chantiers&name=ajout.txt", {
        method: "PUT",
        body: "autorise",
      })
    ).status,
    201,
  );
  assert.equal(await readFile(`${root}/Chantiers/ajout.txt`, "utf8"), "autorise");
  await login("agencement");
  response = await save(revision, [{ path: "Chantiers", read: false, write: false }]);
  assert.equal(response.status, 200);
  await login("agencement", "collegue");
  assert.equal((await call("/api/file?path=Chantiers/ajout.txt")).status, 403);
  assert.equal((await call("/api/files?path=Chantiers")).status, 403);
  await login("agencement");
});

test("the source and user id both matter for owner privileges", async () => {
  await login("concept");
  assert.equal((await call("/api/admin/access")).status, 403);
  assert.equal((await call("/api/files")).status, 200);
  assert.deepEqual((await (await call("/api/files")).json()).entries, []);
  await login("agencement");
});

test("disabled accounts and unavailable identity provider fail closed", async () => {
  active = false;
  assert.equal((await call("/api/files")).status, 401);
  active = true;
  unavailable = true;
  assert.equal((await call("/api/files")).status, 503);
  unavailable = false;
});
test("logout revokes the source session, including replay of the previous cookie", async () => {
  await login();
  const stolen = sessionCookie;
  assert.equal((await call("/api/logout", { method: "POST" })).status, 200);
  assert.equal((await call("/api/files", { headers: { Cookie: stolen } })).status, 401);
});
test("tampering and expired cookies are rejected", () => {
  const session = { source: "concept", token: "abc", expires: Date.now() + 10000 };
  const encoded = seal(session, config.key);
  assert.deepEqual(unseal(encoded, config.key), session);
  const changed = Buffer.from(encoded, "base64url");
  changed[changed.length - 1] ^= 1;
  assert.equal(unseal(changed.toString("base64url"), config.key), null);
  assert.equal(unseal(seal({ ...session, expires: 0 }, config.key), config.key), null);
  assert.equal(unseal("garbage", config.key), null);
});
test("range parser and configuration reject invalid inputs", () => {
  assert.deepEqual(byteRange("bytes=-3", 10), { start: 7, end: 9 });
  for (const value of ["bytes=-0", "bytes=2-1", "bytes=0-1,3-4"])
    assert.throws(() => byteRange(value, 10));
  assert.throws(() => configFromEnv({ SRV_SESSION_KEY: "weak" }));
  assert.throws(() =>
    configFromEnv({
      SRV_SESSION_KEY: randomBytes(32).toString("hex"),
      SRV_CONCEPT_URL: "http://external.example",
    }),
  );
});
