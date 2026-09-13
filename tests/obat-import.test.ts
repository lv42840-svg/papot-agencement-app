import { describe, expect, it } from "vitest";
import { parseObatCostingCsvText } from "../src/lib/obat/csv-parser";
import { parseObatQuoteText } from "../src/lib/obat/pdf-parser";

describe("OBAT import", () => {
  it("extracts the launch hours and identity from the OBAT costing CSV", () => {
    const csv = `"Désignation","Quantité","Unité","Prix unitaire HT","DEB. SEC. U.","DEB. SEC. TOTAL","TVA","Total HT"
"Fourniture","","","","","","",""
"Main d'oeuvre","","","","","","",""
"FABRICATION","31.2","h","64,95 €","24.63","768.456","20 %","2026,44 €"
"POSE","80","h","74,49 €","37.63","3010.4","20 %","5959,22 €"
"ÉTUDES","45","h","67,74 €","24.63","1108.35","20 %","3048,12 €"
"Bordereau de chantier sur devis : D202600865","","","","","","",""
"En date du : 11/09/2026","","","","","","",""
"Valable jusqu'au : 11/10/2026","","","","","","",""
"Client : Mme  Les Coquette'ries","","","","","","",""
"Adresse : 105 Grande Rue, 69600 Oullins-Pierre-Bénite, France","","","","","","",""
"Chantier : Les Coquette'ries - Oullins","","","","","","",""
"Adresse chantier : 105 Grande Rue, 69600 Oullins-Pierre-Bénite, France","","","","","","",""
"Description : Les Coquette'ries - Oullins","","","","","","",""
"Texte libre : Libellé des chèques : SAS PAPOT-LIBERAL
Coordonnées bancaires
Banque Populaire Auvergne Rhône Alpes","","","","","","",""`;

    const result = parseObatCostingCsvText(csv);

    expect(result.quoteNumber).toBe("D202600865");
    expect(result.quoteDate).toBe("2026-09-11");
    expect(result.validUntil).toBe("2026-10-11");
    expect(result.clientName).toBe("Les Coquette'ries");
    expect(result.projectName).toBe("Les Coquette'ries - Oullins");
    expect(result.siteAddress).toBe("105 Grande Rue, 69600 Oullins-Pierre-Bénite, France");
    expect(result.hours).toEqual({ be: 45, workshop: 31.2, install: 80 });
  });

  it("extracts commercial fields from the text carried by an OBAT quote PDF", () => {
    const text = `PAPOT-LIBERAL
Devis
N° D202600865
En date du : 11/09/2026
Valable jusqu'au : 11/10/2026
Début des travaux le : 09/11/2026 - Durée estimée à : 2 semaines
Date limite de fin de chantier le : 18/12/2026
Les Coquette'ries - Oullins
N° DÉSIGNATION QTÉ PRIX U. TVA TOTAL HT
Les Coquette'ries
Mme MENDES Estella
105 Grande Rue
69600 Oullins-Pierre-Bénite
France
SIREN : 83953757800016
Total net HT 15 299,58 €
TVA 20,00 % 3 059,92 €
Total TTC 18 359,50 €
NET À PAYER 18 359,50 €
Conditions de paiement
Acompte de 30 % à la signature soit 5 507,84 € TTC
Reste à facturer : 12 851,66 € TTC`;

    const result = parseObatQuoteText(text);

    expect(result.quoteNumber).toBe("D202600865");
    expect(result.quoteDate).toBe("2026-09-11");
    expect(result.validUntil).toBe("2026-10-11");
    expect(result.plannedStartDate).toBe("2026-11-09");
    expect(result.plannedEndDate).toBe("2026-12-18");
    expect(result.estimatedDuration).toBe("2 semaines");
    expect(result.projectName).toBe("Les Coquette'ries - Oullins");
    expect(result.clientName).toBe("Les Coquette'ries");
    expect(result.contactName).toBe("Mme MENDES Estella");
    expect(result.clientSiren).toBe("83953757800016");
    expect(result.totalNetHt).toBe(15299.58);
    expect(result.vatAmount).toBe(3059.92);
    expect(result.totalTtc).toBe(18359.5);
    expect(result.depositTtc).toBe(5507.84);
  });
});
