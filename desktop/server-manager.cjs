"use strict";

const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const Module = require("node:module");
const path = require("node:path");

function waitForLocalServer({ host, port, timeoutMs = 30000 }) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error("DESKTOP_LOCAL_SERVER_TIMEOUT"));
          return;
        }
        setTimeout(tryConnect, 200);
      });
    };

    tryConnect();
  });
}

function stopChildProcess(child) {
  if (!child || child.exitCode !== null || child.killed || !child.pid) return;

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }

  child.kill("SIGTERM");
}

async function startDevelopmentServer({
  projectRoot,
  host,
  port,
  spawnProcess = spawn,
  waitForServer = waitForLocalServer,
}) {
  let child;

  async function start() {
    const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
    child = spawnProcess(process.execPath, [nextBin, "dev", "-H", host, "-p", String(port)], {
      cwd: projectRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
    });

    await waitForServer({ host, port });
  }

  await start();

  return {
    async restart() {
      stopChildProcess(child);
      child = undefined;
      await start();
    },
    stop() {
      stopChildProcess(child);
      child = undefined;
    },
  };
}

async function startPackagedServer({ resourcesPath, host, port, loadServer = require }) {
  const serverPath = path.join(resourcesPath, "server", "server.js");
  process.env.HOSTNAME = host;
  process.env.NODE_ENV = "production";
  process.env.NODE_PATH = path.join(resourcesPath, "server", "vendor_node_modules");
  process.env.PORT = String(port);
  Module._initPaths();
  loadServer(serverPath);
  await waitForLocalServer({ host, port });
}

module.exports = {
  startDevelopmentServer,
  startPackagedServer,
  waitForLocalServer,
};
