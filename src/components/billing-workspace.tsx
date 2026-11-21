"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, FileDown } from "lucide-react";
import { BillingHubCards, type BillingHubDestination } from "@/components/billing-hub-cards";
import { BillingTestSandboxPanel } from "@/components/billing-test-sandbox-panel";
import { parseBillingPercentageInput } from "@/lib/billing/percentage-input";
import { calculateLineProgress } from "@/lib/billing/progress";
import { filterBillingProjects, type BillingProjectSort } from "@/lib/billing/workspace-list";
import {
  billingPreparationFollowup,
  type BillingPreparationStatus,
} from "@/lib/billing/preparation-followup";
import { belongsToBillingSource } from "@/lib/billing/domain";
import type {
  BillingDraft,
  BillingPayload,
  BillingSource,
  BillingType,
} from "@/lib/billing/domain";
type BillingChantierChoice = {
  id: string;
  name: string;
  clientName: string | null;
  status: string;
};
type IssuedInvoiceSummary = {
  id: string;
  draftId: string;
  number: string;
  issuedAt: string;
  chantierId: string | null;
  clientName: string;
  affairName: string;
  label: string;
  type: BillingType;
  totalTtcCents: number;
};
type IssuedCreditSummary = {
  id: string;
  originalInvoiceId: string;
  number: string;
  issuedOn: string;
  reason: string;
  totalTtcCents: number;
};
type CreditPositionSummary = {
  originalInvoiceId: string;
  creditedTtcCents: number;
  remainingTtcCents: number;
};
type BillingSection = "HOME" | "CHANTIER" | "PROJECTS" | "FOLLOWUP" | "ISSUED" | "TESTS";
type Snapshot = {
  payload: BillingPayload;
  issuedInvoices?: IssuedInvoiceSummary[];
  issuedCreditNotes?: IssuedCreditSummary[];
  creditPositions?: CreditPositionSummary[];
  canIssue?: boolean;
  sources: BillingSource[];
  chantiers: BillingChantierChoice[];
  canWrite: boolean;
  canTestBillingSandbox?: boolean;
};
const money = (n: number) =>
  (n / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const options: { value: BillingType; label: string }[] = [
  { value: "DEPOSIT", label: "Acompte" },
  { value: "PROGRESS", label: "Situation" },
  { value: "FINAL", label: "Solde" },
  { value: "STANDARD", label: "Classique" },
];
const parseMoney = (text: string) => {
  const norm = text.replace(/\s/g, "").replace(",", ".");
  return /^\d+(\.\d{1,2})?$/.test(norm) ? Math.round(Number(norm) * 100) : NaN;
};
export function BillingWorkspace({
  quoteId,
  chantierId,
  initialTab,
}: {
  quoteId?: string;
  chantierId?: string;
  initialTab?: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState(quoteId ?? "");
  const [type, setType] = useState<BillingType>("DEPOSIT");
  const [mode, setMode] = useState<"AMOUNT" | "PERCENT" | "LINES">("PERCENT");
  const [lineValues, setLineValues] = useState<Record<string, string>>({});
  const [value, setValue] = useState("");
  const [manualDescription, setManualDescription] = useState("Travaux réalisés");
  const [manualAmount, setManualAmount] = useState("");
  const [manualVat, setManualVat] = useState("20");
  const [extraDescription, setExtraDescription] = useState("");
  const [extraAmount, setExtraAmount] = useState("");
  const [extraVat, setExtraVat] = useState("20");
  const [extraEvidence, setExtraEvidence] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<BillingSection>(
    chantierId || quoteId
      ? "CHANTIER"
      : initialTab === "FOLLOWUP" ||
          initialTab === "PROJECTS" ||
          initialTab === "ISSUED" ||
          initialTab === "TESTS" ||
          initialTab === "CHANTIER"
        ? initialTab
        : "HOME",
  );
  const [selectedChantier, setSelectedChantier] = useState(chantierId ?? "");
  const [projectSearch, setProjectSearch] = useState("");
  const [issuedSearch, setIssuedSearch] = useState("");
  const [followupSearch, setFollowupSearch] = useState("");
  const [followupStatus, setFollowupStatus] = useState<BillingPreparationStatus | "ALL">("ALL");
  const [projectStatus, setProjectStatus] = useState<"ALL" | BillingDraft["status"]>("ALL");
  const [projectType, setProjectType] = useState<"ALL" | BillingType>("ALL");
  const [projectChantier, setProjectChantier] = useState("ALL");
  const [projectSort, setProjectSort] = useState<BillingProjectSort>("RECENT");
  async function refresh() {
    const response = await fetch("/api/desktop/billing", { cache: "no-store" });
    const body = (await response.json()) as Snapshot & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "BILLING_LOAD_FAILED");
    setData(body);
  }
  useEffect(() => {
    void refresh().catch(() => setError("Impossible de charger la facturation."));
  }, []);
  const allSources = data?.sources ?? [];
  const chantierChoices = [...(data?.chantiers ?? [])]
    .map((chantier) => ({
      id: chantier.id,
      name: chantier.name,
      client: chantier.clientName || "Client à rattacher",
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr-FR"));
  const linkedChantierId = allSources.find(
    (source) => source.sourceQuoteIds?.includes(quoteId ?? "") || source.quoteId === quoteId,
  )?.chantierId;
  const activeChantierId = chantierChoices.some((site) => site.id === selectedChantier)
    ? selectedChantier
    : (linkedChantierId ?? chantierChoices[0]?.id ?? "");
  const sources = allSources.filter((source) => source.chantierId === activeChantierId);
  const active =
    sources.find(
      (source) => source.quoteId === selection || source.sourceQuoteIds?.includes(selection),
    ) ?? sources[0];
  const drafts = data?.payload.drafts ?? [];
  const issued = [...(data?.issuedInvoices ?? [])].sort((a, b) =>
    b.issuedAt.localeCompare(a.issuedAt),
  );
  const issuedIds = new Set(issued.map((invoice) => invoice.draftId));
  const unissuedDrafts = drafts.filter((draft) => !issuedIds.has(draft.id));
  const toPrepare = unissuedDrafts.filter((draft) => draft.status === "DRAFT").length;
  const readyForEmission = unissuedDrafts.filter((draft) => draft.status === "APPROVED").length;
  const visibleIssued = issued.filter((invoice) =>
    [invoice.number, invoice.clientName, invoice.affairName, invoice.label]
      .join(" ")
      .toLocaleLowerCase("fr-FR")
      .includes(issuedSearch.trim().toLocaleLowerCase("fr-FR")),
  );
  const chantierExtras = (data?.payload.extras ?? []).filter(
    (extra) => extra.chantierId === activeChantierId,
  );
  const followup = billingPreparationFollowup(allSources, drafts);
  const visibleFollowup = followup.filter((row) => {
    if (followupStatus !== "ALL" && row.status !== followupStatus) return false;
    const needle = followupSearch.trim().toLocaleLowerCase("fr-FR");
    return (
      !needle ||
      [row.source.clientName, row.source.affairName, row.source.quoteLabel]
        .join(" ")
        .toLocaleLowerCase("fr-FR")
        .includes(needle)
    );
  });
  const projectChantiers = [
    ...new Map<string, { id: string; label: string }>(
      drafts
        .filter((draft) => draft.chantierId !== null)
        .map((draft) => [draft.chantierId!, { id: draft.chantierId!, label: draft.affairName }]),
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label, "fr-FR"));
  const visibleDrafts = filterBillingProjects(unissuedDrafts, {
    search: projectSearch,
    status: projectStatus,
    type: projectType,
    chantierId: projectChantier,
    sort: projectSort,
  });
  const used = active
    ? (data?.payload.drafts ?? [])
        .filter((d) => belongsToBillingSource(d, active))
        .reduce((n, d) => n + d.amountHtCents, 0)
    : 0;
  const remaining = Math.max(0, (active?.contractHtCents ?? 0) - used);
  function previousPercents(source: BillingSource): Record<string, string> {
    const history = (data?.payload.drafts ?? []).filter(
      (draft) => draft.type === "PROGRESS" && belongsToBillingSource(draft, source),
    );
    return Object.fromEntries(
      (source.lines ?? []).map((line) => {
        const prior = history.reduce((maximum, draft) => {
          const progress = draft.lineProgress?.find((row) => row.lineId === line.lineId);
          const included = draft.lines?.some((row) => row.lineId === line.lineId);
          return Math.max(
            maximum,
            progress?.percent ?? (included ? (draft.cumulativePercent ?? 0) : 0),
          );
        }, 0);
        return [line.lineId, String(prior)];
      }),
    );
  }
  // Preview and submit the same percentages, including visible saved defaults.
  const previousLineValues = active ? previousPercents(active) : {};
  const enteredLineRows = (active?.lines ?? []).map((line) => ({
    lineId: line.lineId,
    percent: Number(
      (lineValues[line.lineId] ?? previousLineValues[line.lineId] ?? "0").replace(",", "."),
    ),
  }));
  const cumulativeLinesCents = (active?.lines ?? []).reduce((sum, line, index) => {
    const percent = enteredLineRows[index]?.percent;
    const lineValue =
      typeof percent === "number" && Number.isFinite(percent)
        ? Math.round((line.amountHtCents * percent) / 100)
        : 0;
    return sum + lineValue;
  }, 0);
  const progressPreviewError = (() => {
    if (type !== "PROGRESS" || mode !== "LINES" || !active || !data) return "";
    try {
      calculateLineProgress(data.payload, active, enteredLineRows);
      return "";
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "BILLING_PROGRESS_TAX_ALLOCATION_UNAVAILABLE") {
        if (cumulativeLinesCents < used) {
          const minimum =
            active.lines?.length === 1
              ? ` Sur cette ligne, indique plus de ${((used / active.contractHtCents) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %.`
              : "";
          return `Avancement cumulé insuffisant : ${money(cumulativeLinesCents)} HT contre ${money(used)} HT déjà préparés (acomptes inclus).${minimum}`;
        }
        return "Les pourcentages doivent couvrir les acomptes déjà préparés pour chaque taux de TVA.";
      }
      if (code === "BILLING_AMOUNT_INVALID") {
        return cumulativeLinesCents === used
          ? "Aucun montant complémentaire à facturer : augmente l'avancement cumulé."
          : "Indique un avancement positif supérieur aux montants déjà préparés.";
      }
      if (code === "BILLING_PROGRESS_CANNOT_DECREASE") {
        return "Une situation ne peut pas revenir en dessous de l'avancement déjà enregistré.";
      }
      if (
        code === "BILLING_PROGRESS_PERCENT_INVALID" ||
        code === "BILLING_PROGRESS_LINES_REQUIRED"
      ) {
        return "Indique un pourcentage entre 0 et 100 % pour chaque ligne.";
      }
      return "Vérifie les avancements cumulés avant de créer cette situation.";
    }
  })();
  async function write(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/desktop/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as {
        error?: string;
        fields?: string[];
        payload?: BillingPayload;
      };
      if (!response.ok) {
        const fields = result.fields?.length ? ` (champs : ${result.fields.join(", ")})` : "";
        if (result.error === "BILLING_REQUEST_INVALID") {
          throw new Error(`La demande de facturation est invalide${fields}.`);
        }
        if (result.error === "BILLING_DRAFT_DATA_INVALID") {
          throw new Error(
            `Des données du devis empêchent la création${fields}. Vérifie les lignes du devis.`,
          );
        }
        const descriptions: Record<string, string> = {
          BILLING_MARKET_WITHOUT_CLIENT:
            "Rattache un client existant à l'affaire commerciale avant de créer un marché sans devis.",
          BILLING_MARKET_SOURCE_CONFLICT:
            "Ce chantier comporte déjà un devis retenu. Corrige les devis retenus avant de créer ce marché.",
          BILLING_MARKET_ALREADY_PREPARED:
            "Le marché ne peut plus être modifié après la création d'un projet. Une régularisation devra être enregistrée.",
        };
        throw new Error(
          descriptions[result.error ?? ""] ?? result.error ?? "Erreur de facturation",
        );
      }
      await refresh();
      setNotice(success);
      return result.payload ?? null;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de facturation");
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function saveManualMarket() {
    if (!activeChantierId) return;
    const amountHtCents = parseMoney(manualAmount);
    const vatRatePercent = Number(manualVat.replace(",", "."));
    if (!Number.isSafeInteger(amountHtCents) || amountHtCents <= 0) {
      setError("Saisis un montant de marché HT positif.");
      return;
    }
    if (!manualDescription.trim() || !Number.isFinite(vatRatePercent)) {
      setError("Indique la prestation et un taux de TVA.");
      return;
    }
    await write(
      {
        action: "SET_MANUAL_MARKET",
        chantierId: activeChantierId,
        description: manualDescription.trim(),
        amountHtCents,
        vatRatePercent,
      },
      "Marché sans devis enregistré. Tu peux maintenant préparer un projet.",
    );
  }

  async function addExtra() {
    if (!activeChantierId || !active) return;
    const amountHtCents = parseMoney(extraAmount);
    const vatRatePercent = Number(extraVat.trim().replace(",", "."));
    if (!extraDescription.trim() || !Number.isSafeInteger(amountHtCents) || amountHtCents <= 0) {
      setError("Renseigne une désignation et un montant HT positif pour ce supplément.");
      return;
    }
    if (!Number.isFinite(vatRatePercent) || vatRatePercent < 0 || vatRatePercent > 100) {
      setError("Renseigne un taux de TVA valide.");
      return;
    }
    const result = await write(
      {
        action: "ADD_EXTRA",
        requestId: crypto.randomUUID(),
        chantierId: activeChantierId,
        description: extraDescription.trim(),
        amountHtCents,
        vatRatePercent,
      },
      "Travaux supplémentaires enregistrés en attente d'accord. Ils ne sont pas facturables.",
    );
    if (result) {
      setExtraDescription("");
      setExtraAmount("");
    }
  }

  async function confirmExtra(extraId: string) {
    const evidence = extraEvidence[extraId]?.trim();
    if (!evidence) {
      setError("Indique la preuve de l'accord et sa date avant de confirmer.");
      return;
    }
    const result = await write(
      { action: "CONFIRM_EXTRA", extraId, evidence },
      "Accord enregistré : le supplément entre désormais dans le marché du chantier.",
    );
    if (result) {
      setExtraEvidence((old) => ({ ...old, [extraId]: "" }));
    }
  }

  async function create() {
    if (!active) return;
    const linesMode = type === "PROGRESS" && mode === "LINES";
    const percentMode = mode === "PERCENT" && (type === "PROGRESS" || type === "DEPOSIT");
    const numeric = percentMode ? parseBillingPercentageInput(value) : parseMoney(value);
    if (percentMode && numeric === null) {
      setError("Saisis un pourcentage entre 0,01 et 100 (par exemple 30).");
      return;
    }
    if (!linesMode && type !== "STANDARD" && type !== "FINAL" && !Number.isFinite(numeric)) {
      setError("Montant invalide.");
      return;
    }
    const payload: Record<string, unknown> = {
      action: "CREATE",
      requestId: crypto.randomUUID(),
      quoteId: active.quoteId,
      chantierId: active.chantierId,
      type,
    };
    if (linesMode) {
      if (progressPreviewError) {
        setError(progressPreviewError);
        return;
      }
      const rows = enteredLineRows;
      if (
        rows.length === 0 ||
        rows.some((row) => !Number.isFinite(row.percent) || row.percent < 0 || row.percent > 100)
      ) {
        setError("Renseigne un avancement entre 0 et 100 % pour chaque ligne.");
        return;
      }
      payload.linePercentages = rows;
    } else if (percentMode) payload.cumulativePercent = numeric;
    else if (type !== "STANDARD" && type !== "FINAL") payload.amountHtCents = numeric;
    const result = await write(
      payload,
      "Projet enregistré. Aucune facture officielle émise. Ouvre son éditeur pour personnaliser les lignes.",
    );
    const created = result?.drafts.find((draft) => draft.requestId === payload.requestId);
    if (created) router.push(`/facturation/${encodeURIComponent(created.id)}`);
    else if (result) setValue("");
  }
  function navigate(destination: BillingSection | BillingHubDestination) {
    setTab(destination);
    setSelection("");
    setLineValues({});
    setValue("");
    setError("");
    setNotice("");
  }
  return (
    <div
      className="billingPage"
      style={{ padding: 24, maxWidth: 1120, margin: "auto", display: "grid", gap: 16 }}
    >
      <header className="billingHubHeader">
        <div>
          <p className="billingHubEyebrow">PAPOT AGENCEMENT · FINANCES</p>
          <h1>Facturation</h1>
          <p>
            {tab === "HOME"
              ? "Que souhaites-tu faire aujourd'hui ?"
              : "Une action à la fois : les projets restent distincts des factures émises."}
          </p>
        </div>
        <Link
          href={chantierId ? "/chantiers/" + chantierId : "/desktop-ready"}
          className="secondaryButton"
        >
          Quitter la facturation
        </Link>
      </header>
      {tab === "HOME" ? (
        <>
          <p className="billingHubGuidance">
            <strong>À retenir :</strong> préparer ou valider un projet n&apos;émet pas de facture.
            Une facture officielle possède son propre numéro et son PDF archivé. Les factures PAPOT
            ne sont pas transmises automatiquement à Pennylane.
          </p>
          {data && (
            <BillingHubCards
              counts={{
                toPrepare,
                approved: readyForEmission,
                issued: issued.length,
                markets: followup.length,
              }}
              testEnabled={Boolean(data.canTestBillingSandbox)}
              onOpen={navigate}
            />
          )}
          {data && !data.canTestBillingSandbox && (
            <p className="billingHubHelp">
              Le mode TEST est volontairement verrouillé. Pour l&apos;ouvrir, activer la simulation
              sur le serveur et attribuer les droits correspondants dans Paramètres &gt;
              Utilisateurs.
            </p>
          )}
        </>
      ) : (
        <nav className="billingHubSubnav" aria-label="Navigation facturation">
          <button type="button" className="secondaryButton" onClick={() => navigate("HOME")}>
            <ArrowLeft size={16} aria-hidden="true" /> Accueil facturation
          </button>
          {(tab === "CHANTIER" || tab === "FOLLOWUP") && (
            <button
              type="button"
              className="secondaryButton"
              onClick={() => navigate(tab === "CHANTIER" ? "FOLLOWUP" : "CHANTIER")}
            >
              {tab === "CHANTIER" ? "Voir les marchés à facturer" : "Créer depuis un chantier"}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          )}
          {tab === "PROJECTS" && (
            <button type="button" className="secondaryButton" onClick={() => navigate("CHANTIER")}>
              Créer un nouveau projet <ArrowRight size={16} aria-hidden="true" />
            </button>
          )}
        </nav>
      )}
      {error && (
        <p role="alert" className="billingHubError">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="billingHubSuccess">
          {notice}
        </p>
      )}
      {!data && <p>Chargement…</p>}
      {data && data.canTestBillingSandbox && tab === "TESTS" && <BillingTestSandboxPanel />}
      {data && tab === "ISSUED" && (
        <section className="billingRegister" aria-label="Registre des factures émises">
          <div className="billingRegisterHeading">
            <div>
              <h2>Factures émises dans PAPOT</h2>
              <p>
                Numéros définitifs, PDF originaux et avoirs. Les factures enregistrées uniquement
                dans Pennylane ne figurent pas dans ce registre.
              </p>
            </div>
            <span className="billingRegisterCount">{issued.length} facture(s)</span>
          </div>
          {!data.canIssue && (
            <p className="billingHubGuidance">
              L&apos;émission officielle n&apos;est pas autorisée pour cette session. Tu peux
              consulter les documents déjà émis sans créer de nouveau numéro.
            </p>
          )}
          <label className="billingRegisterSearch">
            Rechercher un numéro, un client ou un chantier
            <input
              value={issuedSearch}
              onChange={(event) => setIssuedSearch(event.target.value)}
              placeholder="Référence, client ou chantier…"
            />
          </label>
          {issued.length === 0 ? (
            <div className="billingRegisterEmpty">
              <FileDown size={30} aria-hidden="true" />
              <h3>Aucune facture officielle PAPOT pour le moment</h3>
              <p>
                Les projets validés apparaissent dans « À valider », mais ne deviennent des factures
                qu&apos;après émission numérotée.
              </p>
              <button
                className="secondaryButton"
                type="button"
                onClick={() => navigate("PROJECTS")}
              >
                Voir les projets à valider
              </button>
            </div>
          ) : visibleIssued.length === 0 ? (
            <p>Aucune facture émise ne correspond à cette recherche.</p>
          ) : (
            <div className="billingRegisterList">
              {visibleIssued.map((invoice) => {
                const credits = (data.issuedCreditNotes ?? []).filter(
                  (credit) => credit.originalInvoiceId === invoice.id,
                );
                const position = data.creditPositions?.find(
                  (item) => item.originalInvoiceId === invoice.id,
                );
                return (
                  <article className="billingIssuedCard" key={invoice.id}>
                    <div className="billingIssuedHeader">
                      <div>
                        <strong>{invoice.number}</strong>
                        <span>
                          {invoice.clientName} · {invoice.affairName}
                        </span>
                        <small>
                          {new Date(invoice.issuedAt).toLocaleDateString("fr-FR")} · {invoice.label}
                        </small>
                      </div>
                      <div className="billingIssuedAmount">
                        <strong>{money(invoice.totalTtcCents)} TTC</strong>
                        {position && position.creditedTtcCents > 0 && (
                          <small>Après avoirs : {money(position.remainingTtcCents)} TTC</small>
                        )}
                      </div>
                    </div>
                    <div className="billingIssuedActions">
                      <a
                        className="secondaryButton"
                        href={"/api/desktop/billing/issued/" + invoice.id + "/pdf"}
                      >
                        <FileDown size={16} aria-hidden="true" /> Télécharger la facture
                      </a>
                      <Link href={"/facturation/" + invoice.draftId} className="secondaryButton">
                        Consulter le document
                      </Link>
                    </div>
                    {credits.length > 0 && (
                      <div className="billingIssuedCredits">
                        <strong>Avoirs liés</strong>
                        {credits.map((credit) => (
                          <a
                            key={credit.id}
                            href={"/api/desktop/billing/credits/issued/" + credit.id + "/pdf"}
                          >
                            {credit.number} · {money(credit.totalTtcCents)} TTC · PDF
                          </a>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
      {data && tab === "CHANTIER" && (
        <section
          role="tabpanel"
          style={{ background: "white", padding: 20, borderRadius: 12, display: "grid", gap: 12 }}
        >
          <h2>Nouvelle facture depuis un chantier</h2>
          <label>
            Chantier
            {chantierChoices.length > 0 ? (
              <select
                aria-label="Choisir un chantier à facturer"
                style={{ width: "100%", padding: 9 }}
                value={activeChantierId}
                onChange={(e) => {
                  setSelectedChantier(e.target.value);
                  setSelection("");
                  setLineValues({});
                  setError("");
                }}
              >
                {chantierChoices.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name} · {site.client}
                  </option>
                ))}
              </select>
            ) : (
              <p>Aucun chantier avec un devis retenu éligible à la facturation.</p>
            )}
          </label>
          {sources.length === 0 ? (
            <div className="invoiceCard">
              <h3>Chantier sans devis retenu</h3>
              <p>
                Renseigne un marché simplifié pour préparer une facture. Ce montant constitue une
                base de travail interne, sans émission officielle.
              </p>
              <label>
                Désignation des travaux
                <input
                  value={manualDescription}
                  maxLength={4000}
                  onChange={(event) => setManualDescription(event.target.value)}
                />
              </label>
              <label>
                Montant total HT
                <input
                  value={manualAmount}
                  inputMode="decimal"
                  placeholder="Ex. 1500,00"
                  onChange={(event) => setManualAmount(event.target.value)}
                />
              </label>
              <label>
                Taux de TVA applicable (%), à confirmer selon le chantier
                <input
                  value={manualVat}
                  inputMode="decimal"
                  onChange={(event) => setManualVat(event.target.value)}
                />
              </label>
              <button
                className="primaryButton"
                type="button"
                disabled={!data.canWrite || busy}
                onClick={() => void saveManualMarket()}
              >
                Enregistrer le marché simplifié
              </button>
            </div>
          ) : (
            <>
              <div>
                <strong>Marché global du chantier</strong>
                <p>
                  {active?.quoteLabel} · {active?.lines?.length ?? 0} prestations. Tous les devis
                  retenus de ce chantier sont regroupés dans un seul projet.
                </p>
              </div>
              <p>
                <b>Contrat :</b> {money(active?.contractHtCents ?? 0)} HT · <b>Déjà préparé :</b>{" "}
                {money(used)} HT · <b>Disponible :</b> {money(remaining)} HT
              </p>
              <label>
                Type{" "}
                <select
                  style={{ padding: 9 }}
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value as BillingType);
                    setMode(e.target.value === "PROGRESS" ? "LINES" : "PERCENT");
                  }}
                >
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {type === "DEPOSIT" || type === "PROGRESS" ? (
                <>
                  <label>
                    Mode{" "}
                    <select
                      style={{ padding: 9 }}
                      value={mode}
                      onChange={(e) => {
                        const next = e.target.value as "AMOUNT" | "PERCENT" | "LINES";
                        setMode(next);
                        if (next === "LINES" && active) {
                          setLineValues(previousPercents(active));
                        }
                      }}
                    >
                      <option value="AMOUNT">Montant HT en € (optionnel)</option>
                      <option value="PERCENT">
                        {type === "PROGRESS" ? "Avancement global cumulé %" : "Acompte %"}
                      </option>
                      {type === "PROGRESS" && (active?.lines?.length ?? 0) > 0 ? (
                        <option value="LINES">Avancement par ligne (%)</option>
                      ) : null}
                    </select>
                  </label>
                  {mode !== "LINES" && (
                    <label>
                      {mode === "PERCENT" ? "Pourcentage" : "Montant HT"}{" "}
                      <input
                        style={{ padding: 9 }}
                        inputMode="decimal"
                        value={value}
                        onChange={(e) => {
                          setValue(e.target.value);
                          setError("");
                        }}
                        placeholder={
                          mode === "PERCENT" ? "Ex. 30 (à saisir)" : "Ex. 2500,00 (à saisir)"
                        }
                      />
                    </label>
                  )}
                  {type === "PROGRESS" && mode === "LINES" && active?.lines?.length ? (
                    <div style={{ display: "grid", gap: 9 }}>
                      <p>
                        Indique l&apos;avancement <strong>cumulé</strong> de chaque ligne. PAPOT
                        soustraira les projets précédents, y compris les acomptes.
                      </p>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 550 }}>
                          <thead>
                            <tr>
                              <th style={{ textAlign: "left" }}>Ligne du devis</th>
                              <th>Montant HT</th>
                              <th>Avancement précédent</th>
                              <th>Nouvel avancement %</th>
                              <th>Cumul HT</th>
                            </tr>
                          </thead>
                          <tbody>
                            {active.lines.map((line) => {
                              const previous = Number(previousLineValues[line.lineId] ?? "0");
                              const entered = lineValues[line.lineId] ?? String(previous);
                              const percent = Number(entered.replace(",", "."));
                              const cumulative = Number.isFinite(percent)
                                ? Math.round((line.amountHtCents * percent) / 100)
                                : 0;
                              return (
                                <tr key={line.lineId}>
                                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                                    {line.description}
                                  </td>
                                  <td style={{ textAlign: "right", padding: 8 }}>
                                    {money(line.amountHtCents)}
                                  </td>
                                  <td style={{ textAlign: "center", padding: 8 }}>{previous} %</td>
                                  <td style={{ textAlign: "center", padding: 8 }}>
                                    <input
                                      aria-label={`Avancement ${line.description}`}
                                      style={{ maxWidth: 95, padding: 8 }}
                                      inputMode="decimal"
                                      value={entered}
                                      onChange={(e) => {
                                        setLineValues((current) => ({
                                          ...current,
                                          [line.lineId]: e.target.value,
                                        }));
                                        setError("");
                                      }}
                                    />
                                  </td>
                                  <td style={{ textAlign: "right", padding: 8 }}>
                                    {money(cumulative)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p>
                        <strong>Avancement cumulé : {money(cumulativeLinesCents)} HT.</strong> Déjà
                        préparé : {money(used)} HT. Projet complémentaire estimé :{" "}
                        {money(cumulativeLinesCents - used)} HT.
                      </p>
                      {progressPreviewError ? (
                        <p role="status" style={{ color: "#aa2525" }}>
                          {progressPreviewError}
                        </p>
                      ) : null}
                      <small>
                        Les retours en arrière et les répartitions de TVA incompatibles avec les
                        acomptes antérieurs sont bloqués.
                      </small>
                    </div>
                  ) : null}
                </>
              ) : (
                <p>Le projet sera égal au montant disponible : {money(remaining)} HT.</p>
              )}
              <button
                type="button"
                className="primaryButton"
                disabled={!data.canWrite || busy || remaining <= 0 || Boolean(progressPreviewError)}
                onClick={() => void create()}
              >
                Créer le projet
              </button>
            </>
          )}
        </section>
      )}
      {data && tab === "CHANTIER" && active && (
        <section
          className="invoiceCard"
          role="tabpanel"
          aria-label="Travaux supplémentaires du chantier"
        >
          <h2>Travaux supplémentaires du chantier</h2>
          <p>
            Un supplément en attente d&apos;accord reste visible, mais il n&apos;augmente pas le
            marché facturable. Une confirmation documentée est nécessaire.
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            <label>
              Désignation des travaux supplémentaires
              <input
                value={extraDescription}
                maxLength={4000}
                onChange={(event) => setExtraDescription(event.target.value)}
                placeholder="Ex. Cornières complémentaires"
              />
            </label>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <label style={{ flex: "1 1 160px" }}>
                Montant HT
                <input
                  value={extraAmount}
                  inputMode="decimal"
                  placeholder="Ex. 850,00"
                  onChange={(event) => setExtraAmount(event.target.value)}
                />
              </label>
              <label style={{ flex: "1 1 120px" }}>
                TVA (%)
                <input
                  value={extraVat}
                  inputMode="decimal"
                  onChange={(event) => setExtraVat(event.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              className="secondaryButton"
              disabled={!data.canWrite || busy}
              onClick={() => void addExtra()}
            >
              Ajouter un supplément en attente d&apos;accord
            </button>
          </div>
          {chantierExtras.length === 0 ? (
            <p>Aucun travail supplémentaire enregistré sur ce chantier.</p>
          ) : (
            <ul style={{ display: "grid", gap: 12, paddingLeft: 18 }}>
              {chantierExtras.map((extra) => (
                <li key={extra.id}>
                  <strong>{extra.description}</strong> · {money(extra.amountHtCents)} HT ·
                  {extra.agreementStatus === "CONFIRMED"
                    ? " Accord confirmé"
                    : " Accord à confirmer"}
                  {extra.agreementStatus === "CONFIRMED" ? (
                    <p>
                      Justificatif : {extra.agreementEvidence} · Confirmé par{" "}
                      {extra.confirmedByName}
                    </p>
                  ) : (
                    <div style={{ display: "grid", gap: 6, maxWidth: 700 }}>
                      <label>
                        Justificatif de l&apos;accord (date, interlocuteur et référence)
                        <input
                          value={extraEvidence[extra.id] ?? ""}
                          maxLength={1000}
                          placeholder="Ex. Accord du client par mail le..."
                          onChange={(event) =>
                            setExtraEvidence((old) => ({
                              ...old,
                              [extra.id]: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="secondaryButton"
                        disabled={!data.canWrite || busy}
                        onClick={() => void confirmExtra(extra.id)}
                      >
                        Confirmer l&apos;accord et intégrer au marché
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p>
            La confirmation crée une nouvelle base de préparation. Les anciens devis restent
            inchangés et aucun document officiel n&apos;est émis.
          </p>
        </section>
      )}
      {data && tab === "FOLLOWUP" && (
        <section
          role="tabpanel"
          style={{ background: "white", padding: 20, borderRadius: 12, display: "grid", gap: 14 }}
        >
          <h2>Marchés des chantiers et préparation des factures</h2>
          <p>
            Un devis signé n&apos;est pas une facture. Cette liste suit les marchés et les
            <strong> projets non émis</strong>. Les factures numérotées PAPOT se consultent dans «
            Factures émises » ; le rapprochement avec Pennylane reste distinct.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <strong>{followup.length} marché(s) de chantier</strong>
            <strong>
              {money(followup.reduce((s, r) => s + r.preparedHtCents, 0))} HT en projets
            </strong>
            <strong>
              {money(followup.reduce((s, r) => s + r.remainingToPrepareHtCents, 0))} HT à préparer
            </strong>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={{ display: "grid", gap: 5, flex: "2 1 220px" }}>
              Rechercher un marché de chantier
              <input
                value={followupSearch}
                onChange={(event) => setFollowupSearch(event.target.value)}
                placeholder="Chantier, client ou référence"
              />
            </label>
            <label style={{ display: "grid", gap: 5, flex: "1 1 180px" }}>
              Préparation des factures
              <select
                value={followupStatus}
                onChange={(event) => setFollowupStatus(event.target.value as typeof followupStatus)}
              >
                <option value="ALL">Tous les marchés</option>
                <option value="NONE">Aucun projet</option>
                <option value="PARTIAL">Projets partiels</option>
                <option value="FULL">Totalité préparée (non émise)</option>
              </select>
            </label>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "2px solid #ded8e9" }}>
                  <th style={{ padding: 9 }}>Client / chantier</th>
                  <th style={{ padding: 9 }}>Devis du marché</th>
                  <th style={{ padding: 9, textAlign: "right" }}>Contrat HT</th>
                  <th style={{ padding: 9, textAlign: "right" }}>Projets préparés HT</th>
                  <th style={{ padding: 9, textAlign: "right" }}>Reste à préparer HT</th>
                  <th style={{ padding: 9 }}>État des projets</th>
                  <th style={{ padding: 9 }}>Facturé réel</th>
                  <th style={{ padding: 9 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleFollowup.map((row) => (
                  <tr key={row.source.quoteId} style={{ borderBottom: "1px solid #ece8f0" }}>
                    <td style={{ padding: 9 }}>
                      <strong>{row.source.clientName}</strong>
                      <div>{row.source.affairName}</div>
                    </td>
                    <td style={{ padding: 9 }}>
                      {row.source.sourceQuoteIds?.length ? (
                        <div style={{ display: "grid", gap: 5 }}>
                          <strong>{row.source.sourceQuoteIds.length} devis retenu(s)</strong>
                          {row.source.sourceQuoteIds.map((quoteId) => (
                            <Link key={quoteId} href={`/devis/${encodeURIComponent(quoteId)}`}>
                              Ouvrir le devis {quoteId.slice(0, 8)}
                            </Link>
                          ))}
                        </div>
                      ) : (
                        "Marché sans devis"
                      )}
                    </td>
                    <td style={{ padding: 9, textAlign: "right" }}>
                      {money(row.source.contractHtCents)}
                    </td>
                    <td style={{ padding: 9, textAlign: "right" }}>{money(row.preparedHtCents)}</td>
                    <td style={{ padding: 9, textAlign: "right" }}>
                      {money(row.remainingToPrepareHtCents)}
                    </td>
                    <td style={{ padding: 9 }}>
                      {row.status === "NONE"
                        ? "Aucun projet"
                        : row.status === "PARTIAL"
                          ? "Préparation partielle"
                          : "Totalité préparée"}
                      <div style={{ fontSize: 11 }}>{row.projectCount} projet(s) non émis</div>
                    </td>
                    <td style={{ padding: 9 }}>À rapprocher avec Pennylane</td>
                    <td style={{ padding: 9 }}>
                      {row.source.chantierId ? (
                        <button
                          type="button"
                          className="secondaryButton"
                          onClick={() => {
                            setSelectedChantier(row.source.chantierId!);
                            setSelection(row.source.quoteId);
                            setTab("CHANTIER");
                            setValue("");
                          }}
                        >
                          Préparer une facture
                        </button>
                      ) : (
                        <span>Chantier à vérifier</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visibleFollowup.length ? <p>Aucun devis ne correspond aux filtres.</p> : null}
          </div>
        </section>
      )}
      {data && tab === "PROJECTS" && (
        <section
          role="tabpanel"
          style={{ background: "white", padding: 20, borderRadius: 12, display: "grid", gap: 12 }}
        >
          <h2>À valider · projets non émis ({unissuedDrafts.length})</h2>
          <p>
            Prépare le document, vérifie le visa et valide-le en interne. Une validation interne ne
            génère pas de numéro de facture.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
            <label style={{ display: "grid", gap: 5, flex: "2 1 220px" }}>
              Rechercher (client, chantier, devis)
              <input
                aria-label="Rechercher un projet de facture"
                value={projectSearch}
                placeholder="Nom, référence, libellé…"
                onChange={(e) => setProjectSearch(e.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 5, flex: "1 1 125px" }}>
              Statut
              <select
                aria-label="Filtrer par statut"
                value={projectStatus}
                onChange={(e) => setProjectStatus(e.target.value as typeof projectStatus)}
              >
                <option value="ALL">Tous</option>
                <option value="DRAFT">À préparer</option>
                <option value="APPROVED">Validés en interne</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 5, flex: "1 1 125px" }}>
              Type
              <select
                aria-label="Filtrer par type"
                value={projectType}
                onChange={(e) => setProjectType(e.target.value as typeof projectType)}
              >
                <option value="ALL">Tous</option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 5, flex: "1 1 170px" }}>
              Chantier
              <select
                aria-label="Filtrer par chantier"
                value={projectChantier}
                onChange={(e) => setProjectChantier(e.target.value)}
              >
                <option value="ALL">Tous les chantiers</option>
                <option value="NONE">Sans chantier</option>
                {projectChantiers.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 5, flex: "1 1 135px" }}>
              Trier par
              <select
                aria-label="Trier les projets de factures"
                value={projectSort}
                onChange={(e) => setProjectSort(e.target.value as BillingProjectSort)}
              >
                <option value="RECENT">Plus récents</option>
                <option value="OLDEST">Plus anciens</option>
                <option value="CLIENT">Client A-Z</option>
                <option value="AMOUNT_DESC">Montant HT décroissant</option>
              </select>
            </label>
          </div>
          <p>
            {visibleDrafts.length} projet(s) affiché(s) sur {unissuedDrafts.length}.
          </p>
          {visibleDrafts.length === 0 ? (
            <p>Aucun projet ne correspond aux filtres.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 950, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "2px solid #ded8e9" }}>
                    <th style={{ padding: 9 }}>Date</th>
                    <th style={{ padding: 9 }}>Client / chantier</th>
                    <th style={{ padding: 9 }}>Devis</th>
                    <th style={{ padding: 9 }}>Intitulé / type</th>
                    <th style={{ padding: 9 }}>Statut</th>
                    <th style={{ padding: 9, textAlign: "right" }}>HT</th>
                    <th style={{ padding: 9, textAlign: "right" }}>TTC</th>
                    <th style={{ padding: 9 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDrafts.map((d) => (
                    <tr key={d.id} style={{ borderBottom: "1px solid #e9e5ef" }}>
                      <td style={{ padding: 9, whiteSpace: "nowrap" }}>
                        {new Date(d.createdAt).toLocaleDateString("fr-FR")}
                      </td>
                      <td style={{ padding: 9 }}>
                        <strong>{d.clientName}</strong>
                        <div>{d.affairName}</div>
                      </td>
                      <td style={{ padding: 9 }}>{d.quoteLabel}</td>
                      <td style={{ padding: 9 }}>
                        <strong>{d.label}</strong>
                        <div>{options.find((option) => option.value === d.type)?.label}</div>
                      </td>
                      <td style={{ padding: 9 }}>
                        {d.status === "APPROVED" ? "Validé · à émettre" : "À préparer"}
                        <div style={{ fontSize: 11 }}>Non émis</div>
                      </td>
                      <td style={{ padding: 9, textAlign: "right", whiteSpace: "nowrap" }}>
                        {money(d.amountHtCents)}
                      </td>
                      <td style={{ padding: 9, textAlign: "right", whiteSpace: "nowrap" }}>
                        {money(d.totalTtcCents)}
                      </td>
                      <td style={{ padding: 9 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <Link
                            href={`/facturation/${encodeURIComponent(d.id)}`}
                            className="secondaryButton"
                          >
                            {d.status === "APPROVED" ? "Consulter" : "Ouvrir"}
                          </Link>
                          {data.canWrite && d.status === "DRAFT" ? (
                            <button
                              type="button"
                              className="secondaryButton"
                              disabled={busy}
                              onClick={() => {
                                if (confirm("Supprimer ce projet non émis ?"))
                                  void write(
                                    {
                                      action: "DELETE",
                                      draftId: d.id,
                                      expectedUpdatedAt: d.updatedAt,
                                    },
                                    "Projet supprimé",
                                  );
                              }}
                            >
                              Supprimer
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
