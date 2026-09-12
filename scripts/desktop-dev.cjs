"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");

const appUrl = process.env.PAPOT_APP_URL || "http://127.0.0.1:3217/desktop-setup";

async function main() {
  const electronBin = path.join(
    process.cwd(),
    "node_modules",
    "electron",
    "dist",
    process.platform === "win32" ? "electron.exe" : "electron",
  );

  const electron = spawn(electronBin, ["desktop/main.cjs"], {
    stdio: "inherit",
    env: {
      ...process.env,
      PAPOT_APP_URL: appUrl,
      PAPOT_MANAGE_DEV_SERVER: "1",
    },
  });

  const exitCode = await new Promise((resolve) => electron.once("exit", resolve));
  process.exitCode = typeof exitCode === "number" ? exitCode : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
