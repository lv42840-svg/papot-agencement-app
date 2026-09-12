"use strict";

const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const appUrl = process.env.PAPOT_APP_URL || "http://127.0.0.1:3217/desktop-setup";
const parsed = new URL(appUrl);
const host = parsed.hostname;
const port = Number(parsed.port || 80);

function waitForPort(timeoutMs = 30000) {
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host, port });

      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) {
          reject(new Error("DESKTOP_DEV_SERVER_TIMEOUT"));
          return;
        }
        setTimeout(tryConnect, 250);
      });
    };

    tryConnect();
  });
}

async function main() {
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const electronBin = path.join(
    process.cwd(),
    "node_modules",
    "electron",
    "dist",
    process.platform === "win32" ? "electron.exe" : "electron",
  );

  const next = spawn(process.execPath, [nextBin, "dev", "-H", host, "-p", String(port)], {
    stdio: "inherit",
    env: process.env,
  });

  let electron;
  let nextStopped = false;

  const stopNext = () => {
    if (nextStopped || !next.pid) return;
    nextStopped = true;

    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(next.pid), "/t", "/f"], { stdio: "ignore" });
      return;
    }

    next.kill("SIGTERM");
  };

  process.once("SIGINT", stopNext);
  process.once("SIGTERM", stopNext);

  try {
    await waitForPort();

    electron = spawn(electronBin, ["desktop/main.cjs"], {
      stdio: "inherit",
      env: { ...process.env, PAPOT_APP_URL: appUrl },
    });

    const exitCode = await new Promise((resolve) => electron.once("exit", resolve));
    process.exitCode = typeof exitCode === "number" ? exitCode : 0;
  } finally {
    if (electron && !electron.killed) electron.kill();
    stopNext();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
