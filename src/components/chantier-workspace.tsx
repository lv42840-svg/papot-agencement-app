"use client";

import Link from "next/link";
import {
  Archive,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  FileText,
  FolderOpen,
  History,
  Image as ImageIcon,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Save,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChantierOperationalWorkspace } from "@/components/chantier-operational-workspace";
import {
  CHANTIER_STATUS_LABELS,
  chantierRemainingHours,
  type ChantierRecord,
  type ChantiersPayload,
} from "@/lib/chantiers/domain";
import type { ChantierCapabilities } from "@/lib/chantiers/mutations";
import type { CommercialCase, CommercialDocument, CommercialPayload } from "@/lib/commercial/domain";

type ChantiersSnapshot = {
  payload: ChantiersPayload;
  actor: { userId: string; displayName: string };
  capabilities: ChantierCapabilities;
  focusChantierId?: string;
  serverNow: string;
};

type CommercialSnapshot = { payload: CommercialPayload };
type MutationBody = Record<string, unknown> & { action: string };
type ChantierTab = "client" | "follow" | "documents" | "capacity" | "history";

const errorMessages: Record<string, string> = {
  DESKTOP_RUNTIME_NOT_CONFIGURED: "Le poste PAPOT n'est pas configuré.",
  CHANTIERS_LOCKED: "Le chantier est modifié sur un autre poste. Réessaie dans quelques secondes.",
  CHANTIERS_VERSION_CONFLICT: "Le chantier a changé sur un autre poste. Actualise puis réessaie.",
  CHANTIER_NOT_FOUND: "Ce chantier n'existe plus.",
  CHANTIER_ARCHIVED_READ_ONLY: "Ce chantier est archivé. Réactive-le avant de modifier ses données.",
  CHANTIER_HOURS_UNCHANGED: "Aucune heure prévisionnelle n'a changé.",
  CHANTIER_NOT_ACTIVE: "Seul un chantier actif peut être marqué Terminé.",
  CHANTIER_NOT_DONE: "Cette action nécessite un chantier au statut Terminé.",
  CHANTIER_NOT_ARCHIVED: "Ce chantier n'est pas archivé.",
  CHANTIER_BE_ITEM_NOT_FOUND: "L'élément BE n'existe plus.",
  CHANTIER_WORKSHOP_ITEM_NOT_FOUND: "L'élément Atelier n'existe plus.",
  CHANTIER_INSTALL_ITEM_NOT_FOUND: "L'élément Pose n'existe plus.",
};

function formatDateOnly(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(year, month - 1, day, 12),
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} o`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} Ko`;
  return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} Mo`;
}

function documentHref(item: CommercialCase, document: CommercialDocument, download = false): string {
  return `/api/desktop/commercial/${item.id}/documents/${document.id}${download ? "?download=1" : ""}`;
}

function statusTone(item: ChantierRecord): string {
  if (item.status === "DONE") return "done";
  if (item.status === "ARCHIVED") return "archived";
  return "active";
}

export function ChantierWorkspace({ chantierId }: { chantierId: string }) {
  const [chantiersSnapshot, setChantiersSnapshot] = useState<ChantiersSnapshot | null>(null);
  const [commercialSnapshot, setCommercialSnapshot] = useState<CommercialSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ChantierTab>("client");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [chantiersResponse, commercialResponse] = await Promise.all([
        fetch("/api/desktop/chantiers", { cache: "no-store" }),
        fetch("/api/desktop/commercial", { cache: "no-store" }),
      ]);
      const chantiersBody = (await chantiersResponse.json()) as ChantiersSnapshot & { error?: string };
      const commercialBody = (await commercialResponse.json()) as CommercialSnapshot & { error?: string };
      if (!chantiersResponse.ok) throw new Error(chantiersBody.error ?? "CHANTIERS_LOAD_FAILED");
      if (!commercialResponse.ok) throw new Error(commercialBody.error ?? "COMMERCIAL_LOAD_FAILED");
      setChantiersSnapshot(chantiersBody);
      setCommercialSnapshot(commercialBody);
    } catch (loadError) {
      const code = loadError instanceof Error ? loadError.message : "CHANTIERS_LOAD_FAILED";
      setError(errorMessages[code] ?? "Impossible de charger le chantier.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const chantier = useMemo(
    () => chantiersSnapshot?.payload.chantiers.find((item) => item.id === chantierId) ?? null,
    [chantiersSnapshot, chantierId],
  );
  const commercialCase = useMemo(
    () =>
      commercialSnapshot?.payload.cases.find((item) => item.id === chantier?.sourceCommercialCaseId) ?? null,
    [commercialSnapshot, chantier?.sourceCommercialCaseId],
  );

  const mutate = useCallback(async (body: MutationBody, successMessage: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/desktop/chantiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as ChantiersSnapshot & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "CHANTIERS_MUTATION_FAILED");
      setChantiersSnapshot(result);
      setNotice(successMessage);
      return true;
    } catch (mutationError) {
      const code = mutationError instanceof Error ? mutationError.message : "CHANTIERS_MUTATION_FAILED";
      setError(errorMessages[code] ?? "La modification du chantier a échoué.");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  if (loading && !chantiersSnapshot) {
    return <div className="chantierLoading"><RefreshCw className="chantierSpin" size={20} /> Chargement du chantier…</div>;
  }

  if (!chantier || !chantiersSnapshot) {
    return (
      <div className="chantierLoading">
        <FolderOpen size={31} />
        <strong>Chantier introuvable</strong>
        <Link href="/chantiers">Retour à la liste</Link>
      </div>
    );
  }

  const tabs: Array<{ id: ChantierTab; label: string; icon: typeof BriefcaseBusiness; badge?: number }> = [
    { id: "client", label: "Client", icon: BriefcaseBusiness },
    { id: "follow", label: "Suivi chantier", icon: Clock3 },
    { id: "documents", label: "Documents", icon: Paperclip, badge: commercialCase?.documents.length ?? 0 },
    { id: "capacity", label: "Charge", icon: CalendarClock },
    { id: "history", label: "Historique", icon: History, badge: chantier.history.length },
  ];

  return (
    <div className="chantierWorkspace">
      <section className="chantierHeading">
        <div>
          <Link href="/chantiers" className="chantierBack">← Tous les chantiers</Link>
          <div className="chantierTitleRow">
            <span className={`chantierLifecycle chantierLifecycle-${statusTone(chantier)}`}>{CHANTIER_STATUS_LABELS[chantier.status]}</span>
            {chantier.signedQuoteReminder ? <span className="chantierWarningPill">Devis signé manquant</span> : null}
          </div>
          <h1>{chantier.name}</h1>
          <p>{[chantier.clientName, chantier.siteLabel].filter(Boolean).join(" · ") || "Client / lieu à compléter"}</p>
        </div>
        <div className="chantierHeadingActions">
          {commercialCase ? <Link className="secondaryButton" href={`/commercial?focus=${commercialCase.id}`}>Ouvrir le commercial</Link> : null}
          <button type="button" className="chantierRefresh" onClick={() => void load()} disabled={busy}><RefreshCw size={14} /> Actualiser</button>
        </div>
      </section>

      {error ? <div className="chantierMessage chantierError">{error}</div> : null}
      {notice ? <div className="chantierMessage chantierSuccess">{notice}</div> : null}

      <nav className="chantierTabs" aria-label="Rubriques du chantier">
        {tabs.map(({ id, label, icon: Icon, badge }) => (
          <button key={id} type="button" className={activeTab === id ? "isActive" : undefined} onClick={() => setActiveTab(id)}>
            <Icon size={14} /> <span>{label}</span>{badge !== undefined ? <small>{badge}</small> : null}
          </button>
        ))}
      </nav>

      <section className="chantierTabBody">
        {activeTab === "client" ? (
          <ClientTab chantier={chantier} busy={busy} canModify={chantiersSnapshot.capabilities.canModify && chantier.status !== "ARCHIVED"} mutate={mutate} />
        ) : null}
        {activeTab === "follow" ? (
          <FollowTab chantier={chantier} busy={busy} capabilities={chantiersSnapshot.capabilities} mutate={mutate} />
        ) : null}
        {activeTab === "documents" ? (
          <DocumentsTab chantier={chantier} commercialCase={commercialCase} />
        ) : null}
        {activeTab === "capacity" ? (
          <CapacityTab chantier={chantier} busy={busy} canModify={chantiersSnapshot.capabilities.canModify && chantier.status !== "ARCHIVED"} mutate={mutate} />
        ) : null}
        {activeTab === "history" ? <HistoryTab chantier={chantier} /> : null}
      </section>

      <ChantierStyles />
    </div>
  );
}

function ClientTab({ chantier, busy, canModify, mutate }: { chantier: ChantierRecord; busy: boolean; canModify: boolean; mutate: (body: MutationBody, message: string) => Promise<boolean> }) {
  const [number, setNumber] = useState(chantier.number ?? "");
  const [reference, setReference] = useState(chantier.reference ?? "");
  const [name, setName] = useState(chantier.name);
  const [clientName, setClientName] = useState(chantier.clientName ?? "");
  const [companyName, setCompanyName] = useState(chantier.companyName ?? "");
  const [siteLabel, setSiteLabel] = useState(chantier.siteLabel ?? "");
  const [contactName, setContactName] = useState(chantier.contactName ?? "");
  const [contactPhone, setContactPhone] = useState(chantier.contactPhone ?? "");
  const [contactEmail, setContactEmail] = useState(chantier.contactEmail ?? "");
  const [description, setDescription] = useState(chantier.description ?? "");
  const [nextAction, setNextAction] = useState(chantier.nextAction ?? "");

  return (
    <section className="chantierCard">
      <div className="chantierSectionTitle"><BriefcaseBusiness size={15} /> Client / chantier</div>
      <div className="chantierGrid2">
        <Field label="N° chantier"><input value={number} onChange={(event) => setNumber(event.target.value)} disabled={!canModify} placeholder="Facultatif tant que le format n'est pas défini" /></Field>
        <Field label="Référence chantier"><input value={reference} onChange={(event) => setReference(event.target.value)} disabled={!canModify} /></Field>
        <Field label="Nom du chantier"><input value={name} onChange={(event) => setName(event.target.value)} disabled={!canModify} /></Field>
        <Field label="Client"><input value={clientName} onChange={(event) => setClientName(event.target.value)} disabled={!canModify} /></Field>
        <Field label="Société"><input value={companyName} onChange={(event) => setCompanyName(event.target.value)} disabled={!canModify} /></Field>
        <Field label="Lieu chantier"><input value={siteLabel} onChange={(event) => setSiteLabel(event.target.value)} disabled={!canModify} /></Field>
        <Field label="Contact"><input value={contactName} onChange={(event) => setContactName(event.target.value)} disabled={!canModify} /></Field>
        <Field label="Téléphone"><input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} disabled={!canModify} /></Field>
        <Field label="E-mail"><input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} disabled={!canModify} /></Field>
        <Field label="Pose prévisionnelle"><input value={formatDateOnly(chantier.plannedInstallDate)} disabled /></Field>
      </div>
      <Field label="C'est quoi ?"><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} disabled={!canModify} /></Field>
      <Field label="J'en fais quoi ?"><textarea rows={2} value={nextAction} onChange={(event) => setNextAction(event.target.value)} disabled={!canModify} /></Field>
      {canModify ? (
        <button type="button" className="primaryButton chantierFitButton" disabled={busy || !name.trim()} onClick={() => void mutate({ action: "updateDetails", chantierId: chantier.id, number, reference, name, clientName, companyName, siteLabel, contactName, contactPhone, contactEmail, description, nextAction }, "Informations du chantier enregistrées.")}><Save size={14} /> Enregistrer</button>
      ) : <p className="chantierHint">Chantier archivé : consultation uniquement tant qu&apos;il n&apos;est pas réactivé.</p>}
    </section>
  );
}

function FollowTab({ chantier, busy, capabilities, mutate }: { chantier: ChantierRecord; busy: boolean; capabilities: ChantierCapabilities; mutate: (body: MutationBody, message: string) => Promise<boolean> }) {
  const [reactivateReason, setReactivateReason] = useState("");
  const [archiveReviewed, setArchiveReviewed] = useState(false);
  const [unarchiveReason, setUnarchiveReason] = useState("");

  return (
    <div className="chantierFollowStack">
      <section className="chantierCard">
        <div className="chantierSectionTitle"><Clock3 size={15} /> Cycle de vie</div>
        <div className="chantierLifecycleSummary">
          <div><span>Statut</span><strong>{CHANTIER_STATUS_LABELS[chantier.status]}</strong></div>
          <div><span>Lancé</span><strong>{formatDateTime(chantier.launchedAt)}</strong></div>
          <div><span>Pose prévue</span><strong>{formatDateOnly(chantier.plannedInstallDate)}</strong></div>
        </div>

        {chantier.status === "ACTIVE" && capabilities.canModify ? (
          <div className="chantierLifecycleAction">
            <p>Le statut Terminé signifie que les travaux principaux sont finis. Les documents, factures, réserves et SAV pourront continuer à évoluer.</p>
            <button type="button" className="secondaryButton" disabled={busy} onClick={() => void mutate({ action: "markDone", chantierId: chantier.id }, "Chantier passé à Terminé.")}><CheckCircle2 size={14} /> Marquer Terminé</button>
          </div>
        ) : null}

        {chantier.status === "DONE" && capabilities.canModify ? (
          <div className="chantierLifecycleAction chantierLifecycleSplit">
            <div>
              <strong>Reprendre les travaux</strong>
              <input value={reactivateReason} onChange={(event) => setReactivateReason(event.target.value)} placeholder="Note facultative" />
              <button type="button" className="secondaryButton" disabled={busy} onClick={() => void mutate({ action: "reactivate", chantierId: chantier.id, reason: reactivateReason }, "Chantier remis en Actif.")}><RotateCcw size={14} /> Remettre Actif</button>
            </div>
            {capabilities.canArchive ? (
              <div>
                <strong>Archiver</strong>
                <p>Le résumé des réserves, SAV, factures et actions sera enrichi à mesure que ces modules sont raccordés. L&apos;archivage reste manuel.</p>
                <label className="chantierArchiveCheck"><input type="checkbox" checked={archiveReviewed} onChange={(event) => setArchiveReviewed(event.target.checked)} /> J&apos;ai vérifié les éléments encore ouverts</label>
                <button type="button" className="chantierArchiveButton" disabled={busy || !archiveReviewed} onClick={() => void mutate({ action: "archive", chantierId: chantier.id, openItemsReviewed: true }, "Chantier archivé.")}><Archive size={14} /> Archiver</button>
              </div>
            ) : null}
          </div>
        ) : null}

        {chantier.status === "ARCHIVED" && capabilities.canArchive ? (
          <div className="chantierLifecycleAction">
            <strong>Réactivation complète</strong>
            <p>Un SAV pourra plus tard être ajouté sans réactiver tout le chantier. Ici, la réactivation remet réellement le chantier dans les vues opérationnelles.</p>
            <input value={unarchiveReason} onChange={(event) => setUnarchiveReason(event.target.value)} placeholder="Motif obligatoire" />
            <button type="button" className="primaryButton chantierFitButton" disabled={busy || !unarchiveReason.trim()} onClick={() => void mutate({ action: "unarchive", chantierId: chantier.id, reason: unarchiveReason }, "Chantier réactivé depuis les archives.")}><RotateCcw size={14} /> Réactiver</button>
          </div>
        ) : null}
      </section>

      <ChantierOperationalWorkspace
        chantier={chantier}
        busy={busy}
        canModify={capabilities.canModify && chantier.status !== "ARCHIVED"}
        mutate={mutate}
      />
    </div>
  );
}

function DocumentsTab({ chantier, commercialCase }: { chantier: ChantierRecord; commercialCase: CommercialCase | null }) {
  const documents = commercialCase?.documents ?? [];
  return (
    <section className="chantierCard">
      <div className="chantierSectionTitle"><Paperclip size={15} /> Documents liés <span className="chantierCountPill">{documents.length}</span></div>
      <p className="chantierHint">Les documents déjà présents dans l&apos;affaire commerciale restent référencés ici sans copie physique. Les nouveaux documents propres au chantier seront raccordés au même système documentaire.</p>
      {documents.length === 0 ? (
        <div className="chantierDocumentsEmpty"><FileText size={25} /><strong>Aucun document commercial lié</strong></div>
      ) : (
        <div className="chantierDocuments">
          {documents.map((document) => commercialCase ? <DocumentRow key={document.id} item={commercialCase} document={document} /> : null)}
        </div>
      )}
      <div className="chantierLaunchDocState">
        <div><span>Devis</span><strong>{chantier.launchDocuments.quote === "PRESENT" ? "Présent au lancement" : "Déclaré absent"}</strong></div>
        <div><span>Devis signé</span><strong>{chantier.launchDocuments.signedQuote === "PRESENT" ? "Présent au lancement" : "Déclaré absent"}</strong></div>
        <div><span>Déboursé OBAT</span><strong>{chantier.launchDocuments.costing === "PRESENT" ? "Présent au lancement" : "Déclaré absent"}</strong></div>
      </div>
    </section>
  );
}

function DocumentRow({ item, document }: { item: CommercialCase; document: CommercialDocument }) {
  const [preview, setPreview] = useState(false);
  const image = document.contentType.startsWith("image/");
  const pdf = document.contentType === "application/pdf";
  const Icon = image ? ImageIcon : FileText;
  const url = documentHref(item, document);
  return (
    <div className="chantierDocumentRow">
      <span className="chantierDocumentIcon"><Icon size={16} /></span>
      <div className="chantierDocumentMeta"><strong>{document.fileName}</strong><small>{formatBytes(document.sizeBytes)} · {document.uploadedByName} · {formatDateTime(document.uploadedAt)}</small></div>
      <div className="chantierDocumentActions">
        {image || pdf ? <button type="button" className="secondaryButton" onClick={() => setPreview((value) => !value)}><Eye size={13} /> {preview ? "Fermer" : "Aperçu"}</button> : null}
        <a className="secondaryButton" href={documentHref(item, document, true)}><Download size={13} /> Télécharger</a>
      </div>
      {preview ? <div className="chantierDocumentPreview">{image ? <img src={url} alt={document.fileName} /> : <iframe src={url} title={document.fileName} />}</div> : null}
    </div>
  );
}

function CapacityTab({ chantier, busy, canModify, mutate }: { chantier: ChantierRecord; busy: boolean; canModify: boolean; mutate: (body: MutationBody, message: string) => Promise<boolean> }) {
  const [be, setBe] = useState(String(chantier.plannedHours.be));
  const [workshop, setWorkshop] = useState(String(chantier.plannedHours.workshop));
  const [install, setInstall] = useState(String(chantier.plannedHours.install));
  const [reason, setReason] = useState("");
  const remaining = chantierRemainingHours(chantier);

  return (
    <section className="chantierCard">
      <div className="chantierSectionTitle"><CalendarClock size={15} /> Charge chantier</div>
      <div className="chantierHoursSummary">
        <HourMetric label="BE" planned={chantier.plannedHours.be} actual={chantier.actualHours.be} remaining={remaining.be} />
        <HourMetric label="Atelier" planned={chantier.plannedHours.workshop} actual={chantier.actualHours.workshop} remaining={remaining.workshop} />
        <HourMetric label="Pose" planned={chantier.plannedHours.install} actual={chantier.actualHours.install} remaining={remaining.install} />
      </div>
      <p className="chantierHint">Le réalisé est à 0 tant que le module Heures n&apos;est pas raccordé. Lorsqu&apos;il le sera, les heures réelles alimenteront automatiquement le reste à faire sans masquer un éventuel dépassement.</p>

      {canModify ? (
        <div className="chantierHoursEdit">
          <div className="chantierGrid3">
            <Field label="BE prévisionnel (h)"><input type="number" min="0" step="0.5" value={be} onChange={(event) => setBe(event.target.value)} /></Field>
            <Field label="Atelier prévisionnel (h)"><input type="number" min="0" step="0.5" value={workshop} onChange={(event) => setWorkshop(event.target.value)} /></Field>
            <Field label="Pose prévisionnelle (h)"><input type="number" min="0" step="0.5" value={install} onChange={(event) => setInstall(event.target.value)} /></Field>
          </div>
          <Field label="Motif obligatoire de modification"><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex. complément demandé, réévaluation atelier…" /></Field>
          <button type="button" className="primaryButton chantierFitButton" disabled={busy || !reason.trim()} onClick={() => void mutate({ action: "updatePlannedHours", chantierId: chantier.id, be: Number(be || 0), workshop: Number(workshop || 0), install: Number(install || 0), reason }, "Heures prévisionnelles mises à jour et historisées.")}><Save size={14} /> Enregistrer la charge</button>
        </div>
      ) : null}
    </section>
  );
}

function HourMetric({ label, planned, actual, remaining }: { label: string; planned: number; actual: number; remaining: number }) {
  return <div className={remaining < 0 ? "isNegative" : undefined}><strong>{label}</strong><span><b>{planned}</b> h prévues</span><span>{actual} h réelles</span><span>{remaining} h restantes</span></div>;
}

function HistoryTab({ chantier }: { chantier: ChantierRecord }) {
  return (
    <section className="chantierCard">
      <div className="chantierSectionTitle"><History size={15} /> Historique</div>
      <div className="chantierHistory">
        {[...chantier.history].reverse().map((event) => (
          <div key={event.id} className="chantierHistoryRow"><span /><div><strong>{event.summary}</strong><small>{event.actorName} · {formatDateTime(event.at)}</small></div></div>
        ))}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="chantierField"><span>{label}</span>{children}</label>;
}

function ChantierStyles() {
  return (
    <style jsx global>{`
      .chantierWorkspace{display:grid;gap:14px;width:100%}.chantierHeading{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}.chantierBack{display:inline-block;margin-bottom:7px;color:#7564cc;font-size:9px;font-weight:750;text-decoration:none}.chantierTitleRow{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.chantierHeading h1{margin:6px 0 3px;font-size:27px}.chantierHeading p{margin:0;color:#8b8692;font-size:10px}.chantierHeadingActions{display:flex;gap:7px}.chantierHeadingActions .secondaryButton,.chantierRefresh{min-height:35px;padding:0 10px;display:inline-flex;align-items:center;gap:6px;border:1px solid #ddd9e8;border-radius:8px;background:white;color:#5c5765;font-size:9px;text-decoration:none}.chantierLifecycle,.chantierWarningPill,.chantierCountPill{width:max-content;padding:4px 7px;border-radius:999px;font-size:8px;font-weight:800}.chantierLifecycle-active{background:#e9f7ee;color:#378058}.chantierLifecycle-done{background:#eef2fa;color:#546e9d}.chantierLifecycle-archived{background:#ece9ed;color:#706a74}.chantierWarningPill{background:#fff0dd;color:#a45f18}.chantierMessage{padding:10px 12px;border-radius:9px;font-size:10px}.chantierError{border:1px solid #efc4bc;background:#fff5f3;color:#a3493a}.chantierSuccess{border:1px solid #c4e4cf;background:#f1faf4;color:#347850}.chantierTabs{padding:6px;display:flex;gap:5px;overflow-x:auto;border:1px solid #e3deed;border-radius:10px;background:#faf8ff}.chantierTabs button{min-height:35px;padding:0 10px;display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;border:1px solid transparent;border-radius:8px;background:transparent;color:#706978;font-size:9px;font-weight:750}.chantierTabs button:hover{background:white;color:#5f51a1}.chantierTabs button.isActive{border-color:#a894ec;background:white;color:#6551c7;box-shadow:0 2px 8px rgb(87 67 150 / .08)}.chantierTabs small{min-width:18px;padding:2px 5px;border-radius:999px;background:#eeeaf6;color:#766c86;font-size:7px}.chantierTabBody{min-height:420px}.chantierCard{padding:14px;display:grid;gap:11px;border:1px solid #e9e5f0;border-radius:11px;background:white}.chantierSectionTitle{display:flex;align-items:center;gap:7px;color:#514c59;font-size:12px;font-weight:800}.chantierCountPill{background:#eeeaf6;color:#6c6478}.chantierGrid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.chantierGrid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.chantierField{display:grid;gap:4px}.chantierField>span{color:#5e5965;font-size:9px;font-weight:750}.chantierField input,.chantierField textarea{width:100%;padding:9px 10px;border:1px solid #ddd9e5;border-radius:8px;background:white;color:var(--text);outline:none;font:inherit}.chantierField textarea{resize:vertical}.chantierField input:disabled,.chantierField textarea:disabled{background:#f7f6f8;color:#756f7b}.chantierFitButton{width:max-content}.chantierHint{margin:0;color:#8d8794;font-size:9px}.chantierLifecycleSummary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.chantierLifecycleSummary>div{padding:9px 10px;display:grid;gap:3px;border:1px solid #eeeaf3;border-radius:8px;background:#fdfcff}.chantierLifecycleSummary span{color:#8c8693;font-size:8px}.chantierLifecycleSummary strong{font-size:10px}.chantierLifecycleAction{padding:11px;display:grid;gap:8px;border:1px solid #eee9f4;border-radius:9px;background:#fbfaff}.chantierLifecycleAction>p,.chantierLifecycleAction div>p{margin:0;color:#817b88;font-size:9px}.chantierLifecycleAction input{width:100%;padding:8px 9px;border:1px solid #ddd9e5;border-radius:7px;background:white}.chantierLifecycleSplit{grid-template-columns:1fr 1fr}.chantierLifecycleSplit>div{display:grid;gap:7px}.chantierArchiveCheck{display:flex;align-items:center;gap:6px;color:#726b77;font-size:8.5px}.chantierArchiveButton{width:max-content;min-height:34px;padding:0 10px;display:inline-flex;align-items:center;gap:6px;border:1px solid #e2c5be;border-radius:8px;background:#fff8f6;color:#a05243;font-size:9px;font-weight:750}.chantierFollowStack{display:grid;gap:11px}.chantierDocuments{display:grid;gap:7px}.chantierDocumentsEmpty{min-height:180px;display:grid;place-items:center;align-content:center;gap:7px;color:#938d99}.chantierDocumentsEmpty strong{font-size:10px}.chantierDocumentRow{padding:8px 9px;display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:8px;align-items:center;border:1px solid #eeeaf3;border-radius:8px;background:#fdfcff}.chantierDocumentIcon{width:30px;height:30px;display:grid;place-items:center;border-radius:7px;background:#eee9ff;color:#6d59c8}.chantierDocumentMeta{min-width:0;display:grid;gap:2px}.chantierDocumentMeta strong{overflow:hidden;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.chantierDocumentMeta small{color:#918c99;font-size:7.5px}.chantierDocumentActions{display:flex;gap:5px}.chantierDocumentActions .secondaryButton{min-height:29px;padding:0 7px;display:inline-flex;align-items:center;gap:4px;font-size:8px}.chantierDocumentPreview{grid-column:1/-1;max-height:520px;overflow:auto;border:1px solid #e5e0ec;border-radius:7px;background:#f5f4f7}.chantierDocumentPreview img{display:block;max-width:100%;margin:auto}.chantierDocumentPreview iframe{width:100%;height:480px;border:0}.chantierLaunchDocState{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.chantierLaunchDocState>div{padding:9px;display:grid;gap:3px;border:1px solid #eeeaf3;border-radius:8px}.chantierLaunchDocState span{color:#8b8592;font-size:8px}.chantierLaunchDocState strong{font-size:9px}.chantierHoursSummary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.chantierHoursSummary>div{padding:12px;display:grid;gap:4px;border:1px solid #e8e4ee;border-radius:9px;background:#fdfcff}.chantierHoursSummary>div>strong{font-size:11px}.chantierHoursSummary span{color:#77717e;font-size:8.5px}.chantierHoursSummary span b{color:#4f4957;font-size:13px}.chantierHoursSummary .isNegative{border-color:#efc5bc;background:#fff6f4}.chantierHoursSummary .isNegative span:last-child{color:#b34f3d;font-weight:800}.chantierHoursEdit{padding-top:4px;display:grid;gap:9px;border-top:1px solid #eeeaf3}.chantierHistory{display:grid;gap:8px}.chantierHistoryRow{display:grid;grid-template-columns:9px minmax(0,1fr);gap:7px}.chantierHistoryRow>span{width:6px;height:6px;margin-top:5px;border-radius:50%;background:#aa9bdd}.chantierHistoryRow>div{display:grid;gap:2px}.chantierHistoryRow strong{font-size:8.5px;font-weight:650}.chantierHistoryRow small{color:#98929e;font-size:7.5px}.chantierLoading{min-height:420px;display:grid;place-items:center;align-content:center;gap:8px;border:1px solid #e8e4ef;border-radius:12px;background:white;color:#8a8592;font-size:10px}.chantierLoading strong{font-size:13px}.chantierLoading a{color:#6b58c6}.chantierSpin{animation:chantierSpin 1s linear infinite}@keyframes chantierSpin{to{transform:rotate(360deg)}}
      @media(max-width:900px){.chantierHeading{flex-direction:column}.chantierGrid2,.chantierGrid3,.chantierHoursSummary,.chantierLaunchDocState,.chantierLifecycleSummary{grid-template-columns:1fr 1fr}.chantierLifecycleSplit{grid-template-columns:1fr}}
      @media(max-width:620px){.chantierGrid2,.chantierGrid3,.chantierHoursSummary,.chantierLaunchDocState,.chantierLifecycleSummary{grid-template-columns:1fr}.chantierDocumentRow{grid-template-columns:32px minmax(0,1fr)}.chantierDocumentActions,.chantierDocumentPreview{grid-column:1/-1}.chantierHeadingActions{flex-wrap:wrap}}
    `}</style>
  );
}
