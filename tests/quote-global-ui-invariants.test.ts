import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const createSource = readFileSync(
  new URL("../src/components/quote-create-workspace.tsx", import.meta.url),
  "utf-8",
);
const editorSource = readFileSync(
  new URL("../src/components/quote-direct-editor.tsx", import.meta.url),
  "utf-8",
);
const lifecycleSource = readFileSync(
  new URL("../src/components/quote-lifecycle-actions.tsx", import.meta.url),
  "utf-8",
);

describe("quote global UI invariants", () => {
  it("keeps the validated quote workflow visible without exposing Send", () => {
    expect(createSource).toContain("Base · V1");
    expect(createSource).toContain("Responsable du chiffrage");
    expect(createSource).toContain("Date prévue d’envoi");
    expect(createSource).toContain("Validité du devis : 30 jours");
    expect(lifecycleSource).toContain("Nouvelle version");
    expect(lifecycleSource).toContain("Nouvelle variante");
    expect(lifecycleSource).toContain("Dupliquer");
    expect(lifecycleSource).toContain("Version précédente");
    expect(editorSource).not.toContain("QuoteSendAction");
  });
});
