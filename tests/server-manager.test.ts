import { createRequire } from "node:module";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const serverManager = require("../desktop/server-manager.cjs") as {
  startPackagedServer: (input: {
    resourcesPath: string;
    host: string;
    port: number;
    loadServer: (serverPath: string) => void;
  }) => Promise<void>;
  waitForLocalServer: (input: { host: string; port: number; timeoutMs?: number }) => Promise<void>;
};

const servers: net.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("packaged desktop server", () => {
  it("waits until the loopback server is accepting connections", async () => {
    const server = net.createServer();
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS_MISSING");

    await expect(
      serverManager.waitForLocalServer({ host: "127.0.0.1", port: address.port }),
    ).resolves.toBeUndefined();
  });

  it("loads the bundled server inside PAPOT with loopback-only production settings", async () => {
    const server = net.createServer();
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS_MISSING");

    let loadedServerPath = "";
    await serverManager.startPackagedServer({
      resourcesPath: "C:\\Program Files\\PAPOT\\resources",
      host: "127.0.0.1",
      port: address.port,
      loadServer: (serverPath: string) => void (loadedServerPath = serverPath),
    });

    expect(loadedServerPath).toBe("C:\\Program Files\\PAPOT\\resources/server/server.js");
    expect(process.env.HOSTNAME).toBe("127.0.0.1");
    expect(process.env.PORT).toBe(String(address.port));
    expect(process.env.NODE_ENV).toBe("production");
    expect(process.env.NODE_PATH).toBe(
      "C:\\Program Files\\PAPOT\\resources/server/vendor_node_modules",
    );
  });
});
