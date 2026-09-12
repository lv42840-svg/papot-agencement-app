import { createRequire } from "node:module";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const serverManager = require("../desktop/server-manager.cjs") as {
  startPackagedServer: (input: {
    resourcesPath: string;
    execPath: string;
    host: string;
    port: number;
    forkProcess: (...args: unknown[]) => { kill: () => void; killed: boolean };
  }) => Promise<{ kill: () => void; killed: boolean }>;
  stopPackagedServer: (child?: { kill: () => void; killed: boolean }) => void;
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

  it("starts the bundled server with loopback-only production settings", async () => {
    const server = net.createServer();
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS_MISSING");

    let receivedOptions: Record<string, unknown> | undefined;
    const child = { killed: false, kill: () => undefined };
    await serverManager.startPackagedServer({
      resourcesPath: "C:\\Program Files\\PAPOT\\resources",
      execPath: "C:\\Program Files\\PAPOT\\PAPOT.exe",
      host: "127.0.0.1",
      port: address.port,
      forkProcess: (...args: unknown[]) => {
        receivedOptions = args[2] as Record<string, unknown>;
        return child;
      },
    });

    const env = receivedOptions?.env as Record<string, string>;
    expect(env.HOSTNAME).toBe("127.0.0.1");
    expect(env.PORT).toBe(String(address.port));
    expect(env.NODE_ENV).toBe("production");
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("stops the bundled server on application shutdown", () => {
    let stopped = false;
    serverManager.stopPackagedServer({ killed: false, kill: () => void (stopped = true) });
    expect(stopped).toBe(true);
  });
});
