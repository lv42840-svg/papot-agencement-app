import { describe, expect, it } from "vitest";
import {
  createLocalDesktopSetupConfig,
  localDesktopSetupConfigSchema,
  localDesktopSetupContainsPlaintextSecret,
} from "../src/lib/desktop/setup-config";

const DEVICE_ID = "cb8ede85-641f-45ad-ab2a-68f53a1d52ce";

function baseInput() {
  return {
    sharedDataPath: "\\\\SERVEUR\\PAPOT",
    nextcloudBaseUrl: "https://cloud.ideo-solutions.com/",
    nextcloudLogin: "Papot_Appli",
    nextcloudUserId: "Papot_Appli",
    deviceLabel: "PC Lucien",
    deviceId: DEVICE_ID,
  };
}

describe("local desktop setup configuration", () => {
  it("accepts a UNC shared-data path and normalizes the Nextcloud URL", () => {
    const config = createLocalDesktopSetupConfig(baseInput());
    expect(config.shared_data_path).toBe("\\\\SERVEUR\\PAPOT");
    expect(config.nextcloud_base_url).toBe("https://cloud.ideo-solutions.com");
    expect(config.nextcloud_sync_root).toBe("PAPOT_SYNC");
    expect(config.device_id).toBe(DEVICE_ID);
    expect(config.schema_version).toBe(3);
  });

  it("accepts a local Windows absolute path", () => {
    const config = createLocalDesktopSetupConfig({ ...baseInput(), sharedDataPath: "D:\\PAPOT" });
    expect(config.shared_data_path).toBe("D:\\PAPOT");
  });

  it("refuses a relative shared-data path", () => {
    expect(() =>
      createLocalDesktopSetupConfig({ ...baseInput(), sharedDataPath: "PAPOT\\Documents" }),
    ).toThrow("SHARED_PATH_MUST_BE_WINDOWS_ABSOLUTE_OR_UNC");
  });

  it("requires HTTPS for Nextcloud", () => {
    expect(() =>
      createLocalDesktopSetupConfig({
        ...baseInput(),
        nextcloudBaseUrl: "http://cloud.ideo-solutions.com",
      }),
    ).toThrow("NEXTCLOUD_HTTPS_REQUIRED");
  });

  it("keeps only the Nextcloud secret reference and no plaintext credentials", () => {
    const config = createLocalDesktopSetupConfig(baseInput());
    expect(config.nextcloud_app_password_secret_key).toBe("nextcloud-app-password");
    expect("database_url_secret_key" in config).toBe(false);
    expect(localDesktopSetupContainsPlaintextSecret(config)).toBe(false);
    expect("nextcloud_app_password" in config).toBe(false);
    expect("database_url" in config).toBe(false);
  });

  it("rejects unknown plaintext credential fields", () => {
    const config = createLocalDesktopSetupConfig(baseInput());
    expect(() =>
      localDesktopSetupConfigSchema.parse({
        ...config,
        database_url: "postgresql://user:secret@server:5432/papot",
      }),
    ).toThrow();
    expect(
      localDesktopSetupContainsPlaintextSecret({
        ...config,
        database_url: "postgresql://user:secret@server:5432/papot",
      }),
    ).toBe(true);
  });

  it("trims human-readable setup values", () => {
    const config = createLocalDesktopSetupConfig({
      ...baseInput(),
      nextcloudLogin: "  Papot_Appli  ",
      deviceLabel: "  PC Lucien  ",
    });
    expect(config.nextcloud_login).toBe("Papot_Appli");
    expect(config.device_label).toBe("PC Lucien");
  });
});
