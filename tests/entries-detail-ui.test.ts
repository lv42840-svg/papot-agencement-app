import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const entriesWorkspace = readFileSync(
  new URL("../src/components/entries-workspace.tsx", import.meta.url),
  "utf-8",
);
const commercialBridge = readFileSync(
  new URL("../src/components/task-commercial-bridge.tsx", import.meta.url),
  "utf-8",
);

describe("recette fiche Entrées", () => {
  it("organise la fiche en petits onglets cohérents", () => {
    expect(entriesWorkspace).toContain('type EntryDetailTab = "INFO" | "AFFAIR" | "ATTACHMENTS" | "HISTORY"');
    expect(entriesWorkspace).toContain(">Informations<");
    expect(entriesWorkspace).toContain(">Affaire<");
    expect(entriesWorkspace).toContain("Pièces jointes");
    expect(entriesWorkspace).toContain(">Historique<");
    expect(entriesWorkspace).toContain("entriesDetailTabs");
  });

  it("branche la fiche Entrée sur le rattachement Commercial existant", () => {
    expect(entriesWorkspace).toContain("<TaskCommercialBridge");
    expect(commercialBridge).toContain("Rattacher à une affaire");
    expect(commercialBridge).toContain('action: "linkSourceEntry"');
    expect(commercialBridge).toContain("Rattacher et ouvrir");
  });

  it("montre une miniature d'image et permet de l'agrandir", () => {
    expect(entriesWorkspace).toContain("entriesAttachmentThumbnail");
    expect(entriesWorkspace).toContain("Voir l’image en grand");
    expect(entriesWorkspace).toContain("entriesImageLightbox");
    expect(entriesWorkspace).toContain('aria-modal="true"');
  });
});
