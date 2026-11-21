"use client";

import { ArrowUpRight, ClipboardCheck, FileCheck2, FilePlus2, FlaskConical, LockKeyhole } from "lucide-react";

export type BillingHubDestination = "CHANTIER" | "PROJECTS" | "ISSUED" | "TESTS";

export type BillingHubCounts = {
  toPrepare: number;
  approved: number;
  issued: number;
  markets: number;
};

export function BillingHubCards({
  counts,
  testEnabled,
  onOpen,
}: {
  counts: BillingHubCounts;
  testEnabled: boolean;
  onOpen: (destination: BillingHubDestination) => void;
}) {
  return (
    <section className="billingHubCards" aria-label="Actions de facturation">
      <button type="button" className="billingHubCard" onClick={() => onOpen("CHANTIER")}>
        <span className="billingHubCardIcon billingHubIconLavender"><FilePlus2 size={25} aria-hidden="true" /></span>
        <span className="billingHubCardTitle">Créer une facture</span>
        <span className="billingHubCardCopy">
          Préparer un acompte, une situation ou un solde à partir d&apos;un chantier.
        </span>
        <span className="billingHubCardFoot">
          {counts.markets} marché(s) à consulter <ArrowUpRight size={17} aria-hidden="true" />
        </span>
      </button>

      <button type="button" className="billingHubCard" onClick={() => onOpen("PROJECTS")}>
        <span className="billingHubCardIcon billingHubIconAmber"><ClipboardCheck size={25} aria-hidden="true" /></span>
        <span className="billingHubCardTitle">À valider</span>
        <span className="billingHubCardCopy">
          Vérifier les projets, les visas et les documents à émettre.
        </span>
        <span className="billingHubCardFoot">
          {counts.toPrepare} à préparer · {counts.approved} validé(s) <ArrowUpRight size={17} aria-hidden="true" />
        </span>
      </button>

      <button type="button" className="billingHubCard" onClick={() => onOpen("ISSUED")}>
        <span className="billingHubCardIcon billingHubIconGreen"><FileCheck2 size={25} aria-hidden="true" /></span>
        <span className="billingHubCardTitle">Factures émises</span>
        <span className="billingHubCardCopy">
          Retrouver les numéros officiels, les PDF et les avoirs PAPOT.
        </span>
        <span className="billingHubCardFoot">
          {counts.issued} facture(s) émise(s) <ArrowUpRight size={17} aria-hidden="true" />
        </span>
      </button>

      <button
        type="button"
        className="billingHubCard"
        disabled={!testEnabled}
        aria-disabled={!testEnabled}
        onClick={() => onOpen("TESTS")}
      >
        <span className="billingHubCardIcon billingHubIconBlue"><FlaskConical size={25} aria-hidden="true" /></span>
        <span className="billingHubCardTitle">Mode TEST</span>
        <span className="billingHubCardCopy">
          Essayer des factures et des avoirs, puis effacer uniquement les simulations.
        </span>
        <span className="billingHubCardFoot">
          {testEnabled ? (
            <>Ouvrir les essais <ArrowUpRight size={17} aria-hidden="true" /></>
          ) : (
            <>Accès non activé <LockKeyhole size={15} aria-hidden="true" /></>
          )}
        </span>
      </button>
    </section>
  );
}
