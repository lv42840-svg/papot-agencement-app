"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");

const appUrl = process.env.PAPOT_APP_URL || "http://127.0.0.1:3217/desktop-setup";

async function main() {
  // Electron 42+ no longer downloads its native binary during npm install.
  // Its CLI bootstrap downloads the pinned binary on first use, then launches it.
  const electronCli = path.join(process.cwd(), "node_modules", "electron", "cli.js");

  const electron = spawn(process.execPath, [electronCli, "desktop/main.cjs"], {
    stdio: "inherit",
    env: {
      ...process.env,
      PAPOT_APP_URL: appUrl,
      PAPOT_MANAGE_DEV_SERVER: "1",
    },
  });

  const exitCode = await new Promise((resolve, reject) => {
    electron.once("error", reject);
    electron.once("exit", resolve);
  });
  process.exitCode = typeof exitCode === "number" ? exitCode : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
