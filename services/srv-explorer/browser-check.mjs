import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { chromium } from "@playwright/test";
import { createExplorer, configFromEnv } from "./server.mjs";

const root = await mkdtemp(`${tmpdir()}/papot-browser-`);
const aclRoot = await mkdtemp(`${tmpdir()}/papot-browser-acl-`);
const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)),
  );
const close = (server) =>
  new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
await mkdir(`${root}/Chantiers`);
await mkdir(`${root}/Documents communs`);
await writeFile(`${root}/Chantiers/notice.txt`, "Document de test PAPOT");
const pdfObjects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
];
const pdfText = "BT /F1 20 Tf 25 100 Td (PAPOT - Plan de test) Tj ET";
pdfObjects.push(`<< /Length ${pdfText.length} >>\nstream\n${pdfText}\nendstream`);
let pdf = "%PDF-1.4\n";
const offsets = [0];
for (const [index, object] of pdfObjects.entries()) {
  offsets.push(pdf.length);
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
}
const xref = pdf.length;
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
  .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await writeFile(`${root}/plan.pdf`, pdf);
await writeFile(
  `${root}/photo.png`,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  ),
);
const identityServer = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/api/auth/login") {
    req.resume();
    res.setHeader("Set-Cookie", [
      "papot_session=browser-test; Path=/; HttpOnly",
      "papot_concept_session=browser-test; Path=/; HttpOnly",
    ]);
    return res.end('{"ok":true}');
  }
  if (req.url === "/api/auth/logout") return res.end('{"ok":true}');
  if (req.headers.cookie?.endsWith("=browser-test"))
    return res.end('{"id":"u1","username":"lucien","displayName":"Lucien"}');
  res.writeHead(401);
  res.end("{}");
});
const upstream = await listen(identityServer);
const server = createExplorer(
  configFromEnv({
    SRV_SESSION_KEY: randomBytes(32).toString("hex"),
    SRV_ROOT: root,
    SRV_ADMIN_SOURCE: "agencement",
    SRV_ADMIN_USER_ID: "u1",
    SRV_ACCESS_FILE: `${aclRoot}/access.json`,
    SRV_AGENCEMENT_URL: upstream,
    SRV_CONCEPT_URL: upstream,
  }),
);
const local = await listen(server);
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  // Browser requests use the real HTTPS origin/cookie policy; all requests are
  // intercepted and sent to the local fixture, never to the production domain.
  await context.route("https://srv.papot.app/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = await request.allHeaders();
    delete headers.host;
    delete headers["content-length"];
    const result = await fetch(`${local}${url.pathname}${url.search}`, {
      method: request.method(),
      headers,
      body: request.postDataBuffer() || undefined,
    });
    const outgoing = Object.fromEntries(result.headers);
    delete outgoing["transfer-encoding"];
    delete outgoing["content-length"];
    await route.fulfill({
      status: result.status,
      headers: outgoing,
      body: Buffer.from(await result.arrayBuffer()),
    });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("https://srv.papot.app/");
  await page.locator("#username").fill("lucien");
  await page.locator("#password").fill("fixture-only");
  await page.getByRole("button", { name: "Ouvrir l’explorateur" }).click();
  await page.getByRole("button", { name: "Chantiers", exact: true }).waitFor();
  await page.getByRole("button", { name: "Paramètres", exact: true }).click();
  await page.getByRole("heading", { name: "Paramètres des accès" }).waitFor();
  await page.getByRole("button", { name: "Explorateur", exact: true }).click();
  await page.getByRole("button", { name: "photo.png", exact: true }).click();
  await page.waitForFunction(() => {
    const image = document.querySelector("#preview-content img");
    return image?.complete && image.naturalWidth > 0;
  });
  await page.getByRole("button", { name: "Fermer l’aperçu" }).click();
  const pdfResponse = page.waitForResponse(
    (response) => response.url().includes("path=plan.pdf") && response.url().includes("preview=1"),
  );
  await page.getByRole("button", { name: "plan.pdf", exact: true }).click();
  assert.equal((await pdfResponse).headers()["content-type"], "application/pdf");
  assert.equal(await page.locator("#preview-content iframe").getAttribute("sandbox"), null);
  // Headless Shell has no native PDF renderer: validate the response and frame.
  await page.locator("#preview-content iframe").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Fermer l’aperçu" }).click();
  await page.getByRole("button", { name: "Chantiers", exact: true }).click();
  await page.getByRole("button", { name: "notice.txt", exact: true }).waitFor();
  await page.locator("#upload").setInputFiles({
    name: "note-équipe.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Dépôt testé dans le navigateur"),
  });
  await page.getByRole("button", { name: "note-équipe.txt", exact: true }).waitFor();
  assert.equal(
    await readFile(`${root}/Chantiers/note-équipe.txt`, "utf8"),
    "Dépôt testé dans le navigateur",
  );
  await page.getByRole("button", { name: "Nouveau dossier", exact: true }).click();
  await page.locator("#folder-name").fill("Plans");
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  await page.getByRole("button", { name: "Plans", exact: true }).waitFor();
  await page.locator("#search").fill("notice");
  assert.equal(await page.locator("#files tr").count(), 1);
  await page.locator("#search").fill("");
  if (process.env.SRV_SCREENSHOT)
    await page.screenshot({ path: process.env.SRV_SCREENSHOT, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.locator("#login").waitFor({ state: "visible" });
  await page.locator("#source").selectOption("concept");
  await page.locator("#password").fill("fixture-only");
  await page.getByRole("button", { name: "Ouvrir l’explorateur" }).click();
  await page.locator("#empty").waitFor({ state: "visible" });
  assert.equal(await page.getByRole("button", { name: "Paramètres", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: both logins, image preview, navigation, upload, folder creation, filtering, logout, mobile layout.",
  );
} finally {
  await browser.close();
  await close(server);
  await close(identityServer);
  await rm(root, { recursive: true, force: true });
  await rm(aclRoot, { recursive: true, force: true });
}
