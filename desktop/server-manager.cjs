"use strict";

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

async function startPackagedServer({ resourcesPath, host, port, loadServer = require }) {
  const serverPath = path.join(resourcesPath, "server", "server.js");
  process.env.HOSTNAME = host;
  process.env.NODE_ENV = "production";
  process.env.PORT = String(port);
  loadServer(serverPath);
  await waitForLocalServer({ host, port });
}

module.exports = { startPackagedServer, waitForLocalServer };
