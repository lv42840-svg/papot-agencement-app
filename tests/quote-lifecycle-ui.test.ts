import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const directEditor = readFileSync(
  new URL("../src/components/quote-direct-editor.tsx", import.meta.url),
  "utf-8",
);
const lifecycleActions = readFileSync(
  new URL("../src/components/quote-lifecycle-actions.tsx", import.meta.url),
  "utf-8",
);
const photoRoute = readFileSync(
  new URL(
    "../src/app/api/desktop/quotes/[quoteId]/items/[itemId]/photos/[photoId]/route.ts",
    import.meta.url,
  ),
  "utf-8",
);

describe("quote lifecycle UI", () => {
  it("expose les trois actions depuis le devis", () => {
    expect(directEditor).toContain("<QuoteLifecycleActions");
    expect(lifecycleActions).toContain("Nouvelle version");
    expect(lifecycleActions).toContain("Nouvelle variante");
    expect(lifecycleActions).toContain("Dupliquer");
  });

  it("annonce clairement une ancienne version en lecture seule", () => {
    expect(lifecycleActions).toContain('quote.status === "SUPERSEDED"');
    expect(lifecycleActions).toContain("Version précédente");
    expect(lifecycleActions).toContain("lecture seule");
  });

  it("ne supprime le fichier photo que s'il n'est plus reference par une autre version", () => {
    expect(photoRoute).toContain("stillReferenced");
    expect(photoRoute).toContain("candidate.storagePath === photo.storagePath");
    expect(photoRoute).toContain("if (!stillReferenced)");
  });
});
