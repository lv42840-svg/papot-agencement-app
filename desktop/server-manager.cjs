"use strict";

const { spawn } = require("node:child_process");
const net = require("node:net");
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

async function startPackagedServer({ resourcesPath, execPath, host, port, spawnProcess = spawn }) {
  const serverPath = path.join(resourcesPath, "server", "server.js");
  const child = spawnProcess(execPath, [serverPath], {
    cwd: path.dirname(serverPath),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      HOSTNAME: host,
      NODE_ENV: "production",
      PORT: String(port),
    },
    stdio: "ignore",
    windowsHide: true,
  });

  try {
    await waitForLocalServer({ host, port });
    return child;
  } catch (error) {
    child.kill();
    throw error;
  }
}

function stopPackagedServer(child) {
  if (child && !child.killed) child.kill();
}

module.exports = { startPackagedServer, stopPackagedServer, waitForLocalServer };
