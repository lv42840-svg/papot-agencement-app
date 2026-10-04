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

  it("supports browser email preparation with manual PDF attachment", () => {
    expect(sendSource).toContain("mailto:");
    expect(sendSource).toContain("commercialDocumentId");
    expect(sendSource).toContain("Télécharger le PDF à joindre");
    expect(sendSource).toContain("Valider et préparer l’envoi");
    expect(sendSource).toContain("window.papotDesktop?.composeOutlookMail");
  });
});
