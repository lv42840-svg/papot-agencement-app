import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../src/app/devis/[quoteId]/page.tsx", import.meta.url), "utf8");
const main = readFileSync(new URL("../desktop/main.cjs", import.meta.url), "utf8");
const preload = readFileSync(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
const desktopTypes = readFileSync(new URL("../src/types/desktop.d.ts", import.meta.url), "utf8");

describe("quote Outlook desktop wiring", () => {
  it("prend d'abord l'email du contact de l'affaire puis retombe sur le client", () => {
    expect(page).toContain("affair?.contactEmail?.trim()");
    expect(page).toContain("primaryContact?.email.trim()");
    expect(page).toContain("client?.email.trim()");
    expect(page).toContain("recipientEmail={recipientEmail}");
  });

  it("n'expose au renderer qu'une action Outlook dédiée", () => {
    expect(preload).toContain(
      'composeOutlookMail: (input) => ipcRenderer.invoke("papot:outlook:compose", input)',
    );
    expect(desktopTypes).toContain('kind: "quote-email"');
    expect(desktopTypes).toContain('method: "CLASSIC_OUTLOOK" | "OUTLOOK_PROTOCOL"');
  });

  it("résout la pièce jointe dans le stockage PAPOT avant d'ouvrir Outlook", () => {
    expect(main).toContain('ipcMain.handle("papot:outlook:compose"');
    expect(main).toContain('kind: "commercial-document"');
    expect(main).toContain("resolveBusinessFilePath");
    expect(main).toContain("OUTLOOK_ATTACHMENT_NOT_FOUND");
    expect(main).toContain("openOutlookDraft");
  });
});
