import { Calculator, FileText, LibraryBig, Percent, Sigma } from "lucide-react";

const foundations = [
  {
    icon: Sigma,
    title: "Quantités et formules",
    text: "Quantité directe ou formule légère conservée avec la ligne.",
  },
  {
    icon: LibraryBig,
    title: "Bibliothèque intégrée",
    text: "Composants et ouvrages réutilisables accessibles dans ce même module.",
  },
  {
    icon: Percent,
    title: "Remises et TVA",
    text: "Calculs de remises ligne, section et global, puis HT, TVA et TTC.",
  },
  {
    icon: Calculator,
    title: "Calculs fiables",
    text: "Les montants sont calculés en centimes pour éviter les dérives d’arrondi.",
  },
] as const;

export function QuotesWorkspace() {
  return (
    <div className="quoteWorkspace">
      <section className="panel quoteWorkspacePanel">
        <div className="quoteWorkspaceIntro">
          <div className="quoteWorkspaceIcon" aria-hidden="true">
            <FileText size={23} />
          </div>
          <div>
            <h2>Devis natifs PAPOT</h2>
            <p className="muted">
              L’espace Devis est maintenant en place. La prochaine brique branchera la création et
              le stockage local des brouillons sur cette fondation métier.
            </p>
          </div>
        </div>

        <div className="quoteFoundationGrid">
          {foundations.map(({ icon: Icon, title, text }) => (
            <article key={title} className="quoteFoundationItem">
              <Icon size={18} aria-hidden="true" />
              <div>
                <strong>{title}</strong>
                <span>{text}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel quoteListShell" aria-label="Liste des devis natifs">
        <div className="panelHeader">
          <div>
            <h2>Devis</h2>
            <p className="muted">La liste des brouillons apparaîtra ici dès la brique de stockage.</p>
          </div>
          <span className="countBadge">0</span>
        </div>

        <div className="quoteEmptyState">
          <FileText size={28} aria-hidden="true" />
          <strong>Aucun devis natif stocké pour le moment</strong>
          <span>
            Aucun bouton factice n’est ajouté : la création sera activée dès que le stockage local
            des brouillons sera branché.
          </span>
        </div>
      </section>

      <style jsx>{`
        .quoteWorkspace {
          display: grid;
          gap: 18px;
        }
        .quoteWorkspacePanel {
          display: grid;
          gap: 18px;
        }
        .quoteWorkspaceIntro {
          display: flex;
          gap: 14px;
          align-items: flex-start;
        }
        .quoteWorkspaceIntro h2,
        .quoteWorkspaceIntro p {
          margin-bottom: 0;
        }
        .quoteWorkspaceIcon {
          width: 44px;
          height: 44px;
          flex: 0 0 auto;
          display: grid;
          place-items: center;
          border-radius: 10px;
          background: color-mix(in srgb, var(--accent) 11%, white);
          color: var(--accent);
        }
        .quoteFoundationGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .quoteFoundationItem {
          min-height: 86px;
          padding: 14px;
          display: flex;
          align-items: flex-start;
          gap: 10px;
          border: 1px solid var(--border);
          border-radius: 9px;
          background: var(--surface-soft);
        }
        .quoteFoundationItem > :global(svg) {
          flex: 0 0 auto;
          margin-top: 1px;
          color: var(--accent);
        }
        .quoteFoundationItem strong,
        .quoteFoundationItem span {
          display: block;
        }
        .quoteFoundationItem strong {
          margin-bottom: 4px;
          font-size: 13px;
        }
        .quoteFoundationItem span {
          color: var(--muted);
          font-size: 12px;
          line-height: 1.45;
        }
        .quoteEmptyState {
          min-height: 190px;
          display: grid;
          place-items: center;
          align-content: center;
          gap: 7px;
          padding: 28px;
          text-align: center;
          color: var(--muted);
        }
        .quoteEmptyState > :global(svg) {
          color: color-mix(in srgb, var(--accent) 65%, var(--muted));
        }
        .quoteEmptyState strong {
          color: var(--text);
          font-size: 14px;
        }
        .quoteEmptyState span {
          max-width: 560px;
          font-size: 12px;
          line-height: 1.5;
        }
        @media (max-width: 900px) {
          .quoteFoundationGrid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
