import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const permissionSource = readFileSync(
  new URL("../src/lib/auth/permission-catalog.ts", import.meta.url),
  "utf-8",
);
const sendSource = readFileSync(
  new URL("../src/components/quote-send-action.tsx", import.meta.url),
  "utf-8",
);

describe("web quote reactivation", () => {
  it("keeps Devis as an active module instead of a future placeholder", () => {
    expect(permissionSource).toContain('{ key: "quotes", label: "Devis / Chiffrage" }');
    expect(permissionSource).not.toContain(
      '{ key: "quotes", label: "Devis / Chiffrage", future: true }',
    );
  });

  it("sends the quote from PAPOT instead of delegating to the browser mail client", () => {
    expect(sendSource).toContain("Valider et envoyer");
    expect(sendSource).toContain("Envoi du devis…");
    expect(sendSource).toContain("noreply@papot.eu");
    expect(sendSource).toContain("contact@papot.eu");
    expect(sendSource).not.toContain("mailto:");
    expect(sendSource).not.toContain("composeOutlookMail");
  });
});
