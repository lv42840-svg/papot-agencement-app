import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const topbar = readFileSync(
  new URL("../src/components/desktop-topbar.tsx", import.meta.url),
  "utf8",
);
const shell = readFileSync(
  new URL("../src/components/desktop-app-shell.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

describe("topbar connection and device indicator", () => {
  it("does not display an Electron configuration badge as a network status", () => {
    expect(topbar).not.toContain("Configuration absente");
    expect(topbar).not.toContain("Configuration active");
    expect(topbar).not.toContain("desktopConnection");
    expect(topbar).not.toContain("WifiOff");
    expect(topbar).not.toContain("Wifi");
    expect(shell).not.toContain("configured={");
    expect(shell).not.toContain("configured: ");
    expect(css).not.toContain(".desktopConnection");
  });

  it("preserves the signed-in identity and real logout action", () => {
    expect(topbar).toContain("{displayName}");
    expect(topbar).toContain("{deviceLabel}");
    expect(topbar).toContain("desktopTopbarDate");
    expect(topbar).toContain('action="/api/auth/logout"');
    expect(shell).toContain("<DesktopSidebar");
    expect(shell).toContain("requireUser()");
  });
});
