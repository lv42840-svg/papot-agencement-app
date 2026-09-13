import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const setupStore = require("../desktop/setup-store.cjs") as {
  CONFIG_FILE_NAME: string;
  DATABASE_SECRET_FILE_NAME: string;
  SECRET_FILE_NAME: string;
  normalizeSetupInput: (input: Record<string, unknown>) => Record<string, string>;
  readDesktopSetupConfig: (userDataPath: string) => Record<string, unknown> | null;
  readDesktopSetup: (params: {
    userDataPath: string;
    safeStorage: {
      isEncryptionAvailable: () => boolean;
      decryptString: (value: Buffer) => string;
    };
  }) => {
    config: Record<string, unknown>;
    nextcloudAppPassword: string;
    databaseUrl: string;
  } | null;
  hasDesktopSetup: (params: {
    userDataPath: string;
    safeStorage: {
      isEncryptionAvailable: () => boolean;
      decryptString: (value: Buffer) => string;
    };
  }) => boolean;
  saveDesktopSetup: (params: {
    userDataPath: string;
    input: Record<string, unknown>;
    nextcloudUserId: string;
    safeStorage: {
      isEncryptionAvailable: () => boolean;
      encryptString: (value: string) => Buffer;
    };
  }) => Record<string, unknown>;
};

const temporaryDirectories: string[] = [];

function makeTempDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "papot-desktop-setup-"));
  temporaryDirectories.push(directory);
  return directory;
}

function validInput() {
  return {
    sharedDataPath: "\\\\SERVEUR\\PAPOT",
    databaseUrl: "postgresql://papot:db-secret@serveur-papot:5432/papot",
    nextcloudBaseUrl: "https://cloud.ideo-solutions.com/",
    nextcloudLogin: " Papot_Appli ",
    nextcloudAppPassword: " secret-app-password ",
    deviceLabel: " PC Lucien ",
  };
}

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
};

const fakeSafeStorageReader = {
  isEncryptionAvailable: () => true,
  decryptString: (value: Buffer) => value.toString("utf8").replace(/^encrypted:/, ""),
};

afterEach(() => {
  while (temporaryDirectories.length) {
    const directory = temporaryDirectories.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("desktop setup encrypted storage", () => {
  it("writes public configuration without plaintext technical secrets", () => {
    const userDataPath = makeTempDirectory();
    const config = setupStore.saveDesktopSetup({
      userDataPath,
      input: validInput(),
      nextcloudUserId: "Papot_Appli",
      safeStorage: fakeSafeStorage,
    });

    const rawConfig = fs.readFileSync(path.join(userDataPath, setupStore.CONFIG_FILE_NAME), "utf8");
    expect(rawConfig).not.toContain("secret-app-password");
    expect(rawConfig).not.toContain("db-secret");
    expect(rawConfig).not.toContain("nextcloudAppPassword");
    expect(rawConfig).not.toContain("databaseUrl");
    expect(config.nextcloud_user_id).toBe("Papot_Appli");
    expect(config.nextcloud_login).toBe("Papot_Appli");
    expect(config.device_label).toBe("PC Lucien");
    expect(config).not.toHaveProperty("papot_user_id");
    expect(config).not.toHaveProperty("papot_user_display_name");
  });

  it("stores Nextcloud and PostgreSQL secrets separately from the JSON configuration", () => {
    const userDataPath = makeTempDirectory();
    setupStore.saveDesktopSetup({
      userDataPath,
      input: validInput(),
      nextcloudUserId: "Papot_Appli",
      safeStorage: fakeSafeStorage,
    });

    const encryptedNextcloud = fs.readFileSync(
      path.join(userDataPath, setupStore.SECRET_FILE_NAME),
      "utf8",
    );
    const encryptedDatabase = fs.readFileSync(
      path.join(userDataPath, setupStore.DATABASE_SECRET_FILE_NAME),
      "utf8",
    );
    expect(encryptedNextcloud).toBe("encrypted:secret-app-password");
    expect(encryptedDatabase).toBe(
      "encrypted:postgresql://papot:db-secret@serveur-papot:5432/papot",
    );
  });

  it("reopens a complete setup and decrypts both reusable secrets", () => {
    const userDataPath = makeTempDirectory();
    setupStore.saveDesktopSetup({
      userDataPath,
      input: validInput(),
      nextcloudUserId: "Papot_Appli",
      safeStorage: fakeSafeStorage,
    });

    const reopened = setupStore.readDesktopSetup({
      userDataPath,
      safeStorage: fakeSafeStorageReader,
    });
    expect(reopened?.nextcloudAppPassword).toBe("secret-app-password");
    expect(reopened?.databaseUrl).toBe(
      "postgresql://papot:db-secret@serveur-papot:5432/papot",
    );
    expect(reopened?.config.device_label).toBe("PC Lucien");
    expect(setupStore.hasDesktopSetup({ userDataPath, safeStorage: fakeSafeStorageReader })).toBe(
      true,
    );
  });

  it("does not accept unreadable encrypted secrets as a completed setup", () => {
    const userDataPath = makeTempDirectory();
    setupStore.saveDesktopSetup({
      userDataPath,
      input: validInput(),
      nextcloudUserId: "Papot_Appli",
      safeStorage: fakeSafeStorage,
    });

    const unavailableReader = {
      isEncryptionAvailable: () => true,
      decryptString: () => {
        throw new Error("cannot decrypt");
      },
    };
    expect(setupStore.hasDesktopSetup({ userDataPath, safeStorage: unavailableReader })).toBe(
      false,
    );
  });

  it("preserves only the stable device identifier when setup is saved again", () => {
    const userDataPath = makeTempDirectory();
    const first = setupStore.saveDesktopSetup({
      userDataPath,
      input: validInput(),
      nextcloudUserId: "Papot_Appli",
      safeStorage: fakeSafeStorage,
    });
    const second = setupStore.saveDesktopSetup({
      userDataPath,
      input: { ...validInput(), deviceLabel: "PC Lucien Bureau" },
      nextcloudUserId: "Papot_Appli",
      safeStorage: fakeSafeStorage,
    });

    expect(second.device_id).toBe(first.device_id);
    expect(second.device_label).toBe("PC Lucien Bureau");
    expect(second).not.toHaveProperty("papot_user_id");
  });

  it("refuses a relative shared path", () => {
    expect(() =>
      setupStore.normalizeSetupInput({ ...validInput(), sharedDataPath: "Documents/PAPOT" }),
    ).toThrow("DESKTOP_SHARED_PATH_INVALID");
  });

  it("refuses an invalid PostgreSQL URL", () => {
    expect(() =>
      setupStore.normalizeSetupInput({ ...validInput(), databaseUrl: "https://serveur-papot/db" }),
    ).toThrow("DESKTOP_DATABASE_URL_INVALID");
  });

  it("refuses a non-HTTPS Nextcloud URL", () => {
    expect(() =>
      setupStore.normalizeSetupInput({
        ...validInput(),
        nextcloudBaseUrl: "http://cloud.ideo-solutions.com",
      }),
    ).toThrow("DESKTOP_NEXTCLOUD_HTTPS_REQUIRED");
  });

  it("fails closed when Windows secure storage is unavailable", () => {
    const userDataPath = makeTempDirectory();
    expect(() =>
      setupStore.saveDesktopSetup({
        userDataPath,
        input: validInput(),
        nextcloudUserId: "Papot_Appli",
        safeStorage: {
          isEncryptionAvailable: () => false,
          encryptString: () => Buffer.alloc(0),
        },
      }),
    ).toThrow("DESKTOP_SECRET_STORE_UNAVAILABLE");
    expect(setupStore.readDesktopSetupConfig(userDataPath)).toBeNull();
  });
});
