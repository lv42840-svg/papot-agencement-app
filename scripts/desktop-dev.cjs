"use strict";

const { spawn } = require("node:child_process");
const net = require("node:net");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const appUrl = process.env.PAPOT_APP_URL || "http://127.0.0.1:3000";
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
  const next = spawn(npmCommand, ["run", "dev", "--", "-H", "127.0.0.1"], {
    stdio: "inherit",
    env: process.env,
  });

  let electron;

  const stopNext = () => {
    if (!next.killed) next.kill();
  };

  process.once("SIGINT", stopNext);
  process.once("SIGTERM", stopNext);

  try {
    await waitForPort();

    electron = spawn(npmCommand, ["exec", "--", "electron", "desktop/main.cjs"], {
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
