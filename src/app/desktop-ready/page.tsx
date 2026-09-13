import Link from "next/link";
import {
  BriefcaseBusiness,
  Clock3,
  FileText,
  FolderOpen,
  Plus,
  ShoppingCart,
} from "lucide-react";
import { DesktopAppShell } from "@/components/desktop-app-shell";

export const dynamic = "force-dynamic";

const purchaseIndicators = [
  { label: "À traiter", detail: "commandes et achats nécessitant une action" },
  { label: "Brouillons", detail: "BC et commandes internet en cours" },
  { label: "Factures à récupérer", detail: "justificatifs finaux encore manquants" },
  { label: "Retards de paiement", detail: "virements arrivés à échéance" },
];

export default function DesktopReadyPage() {
  return (
    <DesktopAppShell>
      <div className="dashboardHeading">
        <div>
          <h1>Bonjour 👋</h1>
        </div>
        <Link className="primaryButton" href="/entrees">
          <Plus size={18} /> Nouvelle entrée
        </Link>
      </div>

      <section className="dashboardStats" aria-label="Indicateurs principaux">
        <article className="dashboardStat dashboardStatPurple">
          <span className="dashboardStatIcon"><BriefcaseBusiness size={20} /></span>
          <div><strong>0</strong><span>Nouvelles pistes</span><small>à traiter</small></div>
        </article>
        <article className="dashboardStat dashboardStatGold">
          <span className="dashboardStatIcon"><FileText size={20} /></span>
          <div><strong>0</strong><span>Devis en attente</span><small>de relance</small></div>
        </article>
        <article className="dashboardStat dashboardStatGreen">
          <span className="dashboardStatIcon"><FolderOpen size={20} /></span>
          <div><strong>0</strong><span>Chantiers en cours</span><small>cette semaine</small></div>
        </article>
        <article className="dashboardStat dashboardStatBlue">
          <span className="dashboardStatIcon"><Clock3 size={20} /></span>
          <div><strong>—</strong><span>Heures saisies</span><small>cette semaine</small></div>
        </article>
      </section>

      <section className="dashboardGrid">
        <article className="dashboardPanel">
          <div className="dashboardPanelHeader">
            <div><h2>Grand planning</h2><p>Semaine de travail partagée</p></div>
            <Link href="/planning/2026-S38">Ouvrir</Link>
          </div>
          <div className="dashboardEmpty">
            <CalendarPreview />
            <p>Le vrai planning sera construit ici à partir des chantiers.</p>
          </div>
        </article>

        <article className="dashboardPanel">
          <div className="dashboardPanelHeader">
            <div><h2>Mes tâches</h2><p>Éléments prioritaires</p></div>
          </div>
          <div className="dashboardEmpty dashboardEmptyCompact">
            <ClipboardEmpty />
            <p>Aucune tâche active pour le moment.</p>
          </div>
        </article>

        <article className="dashboardPanel" aria-label="Widget Achats préparé">
          <div className="dashboardPanelHeader">
            <div>
              <h2 style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <ShoppingCart size={16} /> Achats
              </h2>
              <p>Points réellement à traiter</p>
            </div>
            <span
              style={{
                padding: "4px 7px",
                borderRadius: 999,
                background: "#f1edff",
                color: "#6b57c9",
                fontSize: 9,
                fontWeight: 800,
              }}
            >
              PRÊT À RACCORDER
            </span>
          </div>
          <div style={{ display: "grid", gap: 8, paddingTop: 14 }}>
            {purchaseIndicators.map((indicator) => (
              <div
                key={indicator.label}
                style={{
                  display: "grid",
                  gridTemplateColumns: "34px minmax(0, 1fr)",
                  gap: 10,
                  alignItems: "center",
                  padding: "9px 10px",
                  border: "1px solid #efecf4",
                  borderRadius: 8,
                  background: "#fcfbff",
                }}
              >
                <strong
                  style={{
                    width: 30,
                    height: 30,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: 8,
                    background: "#eee9ff",
                    color: "#6e59cf",
                    fontSize: 14,
                  }}
                >
                  —
                </strong>
                <div style={{ display: "grid", gap: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 750 }}>{indicator.label}</span>
                  <small style={{ color: "#8d8895", fontSize: 9 }}>{indicator.detail}</small>
                </div>
              </div>
            ))}
          </div>
          <p style={{ margin: "12px 0 0", color: "#8d8895", fontSize: 9 }}>
            Les compteurs restent volontairement neutres tant que le vrai module Achats n&apos;est pas raccordé.
          </p>
        </article>

        <article className="dashboardPanel dashboardQuickPanel">
          <div className="dashboardPanelHeader">
            <div><h2>Accès rapides</h2><p>Écrans actuellement raccordés</p></div>
          </div>
          <div className="dashboardQuickActions">
            <Link className="secondaryButton" href="/entrees"><Plus size={17} /> Nouvelle entrée</Link>
            <Link className="secondaryButton" href="/chantiers/chantier-test-verrou"><FolderOpen size={17} /> Fiche chantier</Link>
            <Link className="secondaryButton" href="/planning/2026-S38"><Clock3 size={17} /> Planning partagé</Link>
          </div>
        </article>
      </section>
    </DesktopAppShell>
  );
}

function CalendarPreview() {
  return <div className="calendarPreview" aria-hidden="true">{["Lun", "Mar", "Mer", "Jeu", "Ven"].map((day, index) => <span className={index === 2 ? "calendarToday" : ""} key={day}>{day}</span>)}</div>;
}

function ClipboardEmpty() {
  return <div className="clipboardEmpty" aria-hidden="true"><span /><span /><span /></div>;
}
