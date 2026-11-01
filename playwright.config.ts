import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://127.0.0.1:3109", trace: "retain-on-failure" },
  webServer: {
    command: `node -e "require('node:fs').rmSync('.papot-e2e', { recursive: true, force: true })" && npm run dev -- --hostname 127.0.0.1 --port 3109`,
    url: "http://127.0.0.1:3109/login",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PAPOT_STORAGE_MODE: "local",
      PAPOT_LOCAL_DB_PATH: ".papot-e2e/database.sqlite",
      PAPOT_LOCAL_FILES_PATH: ".papot-e2e/files",
      PAPOT_BOOTSTRAP_TOKEN: "isolated-e2e-bootstrap-token-only",
      PAPOT_SMTP_HOST: "",
      PAPOT_DATABASE_URL: "",
    },
  },
});
