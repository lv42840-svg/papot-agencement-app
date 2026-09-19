"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  FileText,
  FolderOpen,
  Paperclip,
  PlayCircle,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommercialCase, CommercialPayload } from "@/lib/commercial/domain";
import {
  CHANTIER_STATUS_LABELS,
  type ChantierRecord,
  type ChantiersPayload,
} from "@/lib/chantiers/domain";
import type { ChantierCapabilities } from "@/lib/chantiers/mutations";
import { obatKindForFile, requestObatAnalysis } from "@/lib/obat/client";
import type { ObatImportAnalysis } from "@/lib/obat/domain";

type ChantiersSnapshot = {
  payload: ChantiersPayload;
  actor: { userId: string; displayName: string };
  capabilities: ChantierCapabilities;
  focusChantierId?: string;
  serverNow: string;
};

type CommercialSnapshot = { payload: CommercialPayload };
type ViewMode = "ACTIVE" | "DONE" | "ARCHIVED";

const errorMessages: Record<string, string> = {
  DESKTOP_RUNTIME_NOT_CONFIGURED: "Le poste PAPOT n'est pas configuré.",
  CHANTIERS_LOCKED:
    "Les chantiers sont modifiés sur un autre poste. Réessaie dans quelques secondes.",
  CHANTIERS_VERSION_CONFLICT:
    "Les chantiers ont changé sur un autre poste. Actualise puis réessaie.",
  CHANTIER_ALREADY_LAUNCHED: "Cette affaire a déjà été lancée en chantier.",
  CHANTIER_COMMERCIAL_NOT_CONFIRMED: "L'affaire doit être confirmée avant le lancement chantier.",
  CHANTIER_INSTALL_DATE_REQUIRED: "La date prévisionnelle de pose est obligatoire.",
  CHANTIER_QUOTE_DECLARATION_REQUIRED: "Indique explicitement que tu n'as pas le devis client.",
  CHANTIER_SIGNED_QUOTE_DECLARATION_REQUIRED:
    "Indique explicitement que tu n'as pas le devis signé.",
  CHANTIER_COSTING_DECLARATION_REQUIRED: "Indique explicitement que tu n'as pas le déboursé OBAT.",
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("fr-FR");
}

function formatDateOnly(value: string | null): string {
  if (!value) return "Pose à compléter";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day, 12));
}

function matches(item: ChantierRecord, query: string): boolean {
  if (!query) return true;
  return [item.name, item.number, item.reference, item.clientName, item.companyName, item.siteLabel]
    .filter(Boolean)
    .some((value) => normalize(String(value)).includes(query));
}

function statusClass(item: ChantierRecord): string {
  if (item.status === "DONE") return "done";
  if (item.status === "ARCHIVED") return "archived";
  return "active";
}

async function postCommercial(body: Record<string, unknown>): Promise<CommercialSnapshot> {
  const response = await fetch("/api/desktop/commercial", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as CommercialSnapshot & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "COMMERCIAL_MUTATION_FAILED");
  return result;
}

async function uploadCommercialDocument(
  caseId: string,
  files: File[],
  options: { category: "QUOTE" | "COSTING"; versionLabel?: string; isSignedQuote?: boolean },
): Promise<void> {
  if (files.length === 0) return;
  const form = new FormData();
  files.forEach((file) => form.append("files", file));
  form.set("category", options.category);
  form.set("versionLabel", options.versionLabel ?? "");
  form.set("variantLabel", "");
  form.set("isCurrent", "1");
  form.set("isSignedQuote", options.isSignedQuote ? "1" : "0");
  const response = await fetch(`/api/desktop/commercial/${caseId}/documents`, {
    method: "POST",
    body: form,
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "COMMERCIAL_DOCUMENT_UPLOAD_FAILED");
}

export function ChantiersWorkspaceObat() {
  const router = useRouter();
  const [chantiersSnapshot, setChantiersSnapshot] = useState<ChantiersSnapshot | null>(null);
  const [commercialSnapshot, setCommercialSnapshot] = useState<CommercialSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("ACTIVE");
  const [query, setQuery] = useState("");
  const [launchCaseId, setLaunchCaseId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [chantiersResponse, commercialResponse] = await Promise.all([
        fetch("/api/desktop/chantiers", { cache: "no-store" }),
        fetch("/api/desktop/commercial", { cache: "no-store" }),
      ]);
      const chantiersBody = (await chantiersResponse.json()) as ChantiersSnapshot & {
        error?: string;
      };
      const commercialBody = (await commercialResponse.json()) as CommercialSnapshot & {
        error?: string;
      };
      if (!chantiersResponse.ok) throw new Error(chantiersBody.error ?? "CHANTIERS_LOAD_FAILED");
      if (!commercialResponse.ok) throw new Error(commercialBody.error ?? "COMMERCIAL_LOAD_FAILED");
      setChantiersSnapshot(chantiersBody);
      setCommercialSnapshot(commercialBody);
    } catch (loadError) {
      const code = loadError instanceof Error ? loadError.message : "CHANTIERS_LOAD_FAILED";
      setError(errorMessages[code] ?? "Impossible de charger les chantiers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const chantiers = useMemo(() => chantiersSnapshot?.payload.chantiers ?? [], [chantiersSnapshot]);
  const launchedCommercialIds = useMemo(
    () => new Set(chantiers.map((item) => item.sourceCommercialCaseId)),
    [chantiers],
  );
  const launchCandidates = useMemo(
    () =>
      (commercialSnapshot?.payload.cases ?? []).filter(
        (item) => item.status === "CONFIRMED" && !launchedCommercialIds.has(item.id),
      ),
    [commercialSnapshot, launchedCommercialIds],
  );
  const normalizedQuery = normalize(query);
  const visible = useMemo(() => {
    const filtered = chantiers.filter((item) => matches(item, normalizedQuery));
    if (normalizedQuery) return filtered;
    return filtered.filter((item) => item.status === mode);
  }, [chantiers, normalizedQuery, mode]);
  const selectedLaunch = launchCandidates.find((item) => item.id === launchCaseId) ?? null;
  const counts = {
    active: chantiers.filter((item) => item.status === "ACTIVE").length,
    done: chantiers.filter((item) => item.status === "DONE").length,
    archived: chantiers.filter((item) => item.status === "ARCHIVED").length,
  };

  async function launch(body: {
    commercialCaseId: string;
    quoteMissingDeclared: boolean;
    signedQuoteMissingDeclared: boolean;
    costingMissingDeclared: boolean;
    be: number;
    workshop: number;
    install: number;
  }): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/desktop/chantiers/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as ChantiersSnapshot & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "CHANTIER_LAUNCH_FAILED");
      setChantiersSnapshot(result);
      setLaunchCaseId(null);
      if (result.focusChantierId) router.push(`/chantiers/${result.focusChantierId}`);
      return true;
    } catch (launchError) {
      const code = launchError instanceof Error ? launchError.message : "CHANTIER_LAUNCH_FAILED";
      setError(errorMessages[code] ?? "Le chantier n'a pas pu être lancé.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chantiersWorkspace">
      <section className="chantiersHeading">
        <div>
          <h1>Chantiers</h1>
          <p>Affaires lancées, suivi opérationnel et cycle Actif → Terminé → Archivé.</p>
        </div>
        <button
          className="chantiersRefresh"
          type="button"
          onClick={() => void load()}
          disabled={busy}
        >
          <RefreshCw size={14} /> Actualiser
        </button>
      </section>

      {error ? <div className="chantiersError">{error}</div> : null}

      <section className="chantiersSummary">
        <SummaryCard icon={FolderOpen} label="Actifs" value={counts.active} />
        <SummaryCard icon={CheckCircle2} label="Terminés" value={counts.done} />
        <SummaryCard icon={Archive} label="Archivés" value={counts.archived} />
        <SummaryCard icon={PlayCircle} label="À lancer" value={launchCandidates.length} accent />
      </section>

      {launchCandidates.length > 0 ? (
        <section className="chantiersLaunchPanel">
          <div className="chantiersLaunchHeader">
            <div>
              <strong>Affaires confirmées à lancer</strong>
              <span>
                Choisis l&apos;affaire, puis dépose directement ce que tu as déjà sous la main.
              </span>
            </div>
          </div>
          <div className="chantiersLaunchList">
            {launchCandidates.map((item) => (
              <button
                key={item.id}
                type="button"
                className={launchCaseId === item.id ? "isSelected" : undefined}
                onClick={() => setLaunchCaseId((current) => (current === item.id ? null : item.id))}
              >
                <span>
                  <BriefcaseBusiness size={14} />
                </span>
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    {[item.clientName, item.siteLabel].filter(Boolean).join(" · ") ||
                      "Client / lieu à compléter"}
                  </small>
                </div>
                <em>
                  {item.plannedInstallDate
                    ? formatDateOnly(item.plannedInstallDate)
                    : "Pose à compléter"}
                </em>
              </button>
            ))}
          </div>
          {selectedLaunch ? (
            <LaunchSheet
              item={selectedLaunch}
              busy={busy}
              onCancel={() => setLaunchCaseId(null)}
              onLaunch={launch}
            />
          ) : null}
        </section>
      ) : null}

      <section className="chantiersToolbar">
        <div className="chantiersModes">
          <button
            className={mode === "ACTIVE" ? "isActive" : ""}
            type="button"
            onClick={() => setMode("ACTIVE")}
          >
            Actifs
          </button>
          <button
            className={mode === "DONE" ? "isActive" : ""}
            type="button"
            onClick={() => setMode("DONE")}
          >
            Terminés
          </button>
          <button
            className={mode === "ARCHIVED" ? "isActive" : ""}
            type="button"
            onClick={() => setMode("ARCHIVED")}
          >
            Archives
          </button>
        </div>
        <label className="chantiersSearch">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nom, numéro, référence, client, société, lieu…"
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")}>
              <X size={13} />
            </button>
          ) : null}
        </label>
      </section>

      {loading && !chantiersSnapshot ? (
        <div className="chantiersEmpty">
          <RefreshCw className="chantiersSpin" size={20} /> Chargement des chantiers…
        </div>
      ) : visible.length === 0 ? (
        <div className="chantiersEmpty">
          <FolderOpen size={31} />
          <strong>
            {normalizedQuery ? "Aucun chantier correspondant" : "Aucun chantier dans cette vue"}
          </strong>
          <span>
            {normalizedQuery
              ? "La recherche interroge aussi les chantiers archivés."
              : "Les affaires confirmées à lancer apparaissent au-dessus."}
          </span>
        </div>
      ) : (
        <div className="chantiersTable">
          {visible.map((item) => (
            <Link key={item.id} href={`/chantiers/${item.id}`} className="chantiersRow">
              <span className={`chantierStatus chantierStatus-${statusClass(item)}`}>
                {CHANTIER_STATUS_LABELS[item.status]}
              </span>
              <div className="chantiersRowMain">
                <strong>{item.name}</strong>
                <span>
                  {[item.clientName, item.companyName, item.siteLabel]
                    .filter(Boolean)
                    .join(" · ") || "Client / lieu à compléter"}
                </span>
              </div>
              <div className="chantiersRowRefs">
                <span>{item.number || "N° à compléter"}</span>
                <small>{item.reference || "Référence à compléter"}</small>
              </div>
              <div className="chantiersRowDate">
                <CalendarClock size={13} />
                <span>{formatDateOnly(item.plannedInstallDate)}</span>
              </div>
              <FileText size={15} className="chantiersRowArrow" />
            </Link>
          ))}
        </div>
      )}

      <ChantiersStyles />
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof FolderOpen;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className={accent ? "isAccent" : undefined}>
      <span>
        <Icon size={17} />
      </span>
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

function LaunchSheet({
  item,
  busy,
  onCancel,
  onLaunch,
}: {
  item: CommercialCase;
  busy: boolean;
  onCancel: () => void;
  onLaunch: (body: {
    commercialCaseId: string;
    quoteMissingDeclared: boolean;
    signedQuoteMissingDeclared: boolean;
    costingMissingDeclared: boolean;
    be: number;
    workshop: number;
    install: number;
  }) => Promise<boolean>;
}) {
  const obatInputRef = useRef<HTMLInputElement>(null);
  const signedInputRef = useRef<HTMLInputElement>(null);
  const quoteDocument =
    item.documents.find((document) => document.category === "QUOTE" && document.isCurrent) ??
    item.documents.find((document) => document.category === "QUOTE");
  const signedDocument = item.documents.find(
    (document) => document.category === "QUOTE" && document.isSignedQuote,
  );
  const costingDocument =
    item.documents.find((document) => document.category === "COSTING" && document.isCurrent) ??
    item.documents.find((document) => document.category === "COSTING");
  const [quoteMissing, setQuoteMissing] = useState(false);
  const [signedQuoteMissing, setSignedQuoteMissing] = useState(false);
  const [costingMissing, setCostingMissing] = useState(false);
  const [be, setBe] = useState(String(item.provisionHours.be));
  const [workshop, setWorkshop] = useState(String(item.provisionHours.workshop));
  const [install, setInstall] = useState(String(item.provisionHours.install));
  const [obatFiles, setObatFiles] = useState<File[]>([]);
  const [analysis, setAnalysis] = useState<ObatImportAnalysis | null>(null);
  const [signedFile, setSignedFile] = useState<File | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [uploadedQuote, setUploadedQuote] = useState(false);
  const [uploadedCosting, setUploadedCosting] = useState(false);
  const [uploadedSigned, setUploadedSigned] = useState(false);
  const [analysisApplied, setAnalysisApplied] = useState(false);

  const stagedQuote = analysis?.files.some((file) => file.kind === "QUOTE") ?? false;
  const stagedCosting = analysis?.files.some((file) => file.kind === "COSTING") ?? false;
  const quoteAvailable = Boolean(quoteDocument) || stagedQuote || uploadedQuote;
  const costingAvailable = Boolean(costingDocument) || stagedCosting || uploadedCosting;
  const signedAvailable = Boolean(signedDocument) || Boolean(signedFile) || uploadedSigned;
  const declarationsOk =
    (quoteAvailable || quoteMissing) &&
    (signedAvailable || signedQuoteMissing) &&
    (costingAvailable || costingMissing);

  async function analyzeFiles(files: File[]) {
    if (files.length === 0) return;
    setLocalBusy(true);
    setLocalError(null);
    setAnalysisApplied(false);
    try {
      const result = await requestObatAnalysis(files);
      setObatFiles(files);
      setAnalysis(result);
      if (result.hours.be !== null) setBe(String(result.hours.be));
      if (result.hours.workshop !== null) setWorkshop(String(result.hours.workshop));
      if (result.hours.install !== null) setInstall(String(result.hours.install));
      if (result.files.some((file) => file.kind === "QUOTE")) setQuoteMissing(false);
      if (result.files.some((file) => file.kind === "COSTING")) setCostingMissing(false);
    } catch (analysisError) {
      setAnalysis(null);
      setObatFiles([]);
      setLocalError(
        analysisError instanceof Error ? analysisError.message : "L'analyse OBAT a échoué.",
      );
    } finally {
      setLocalBusy(false);
    }
  }

  async function applyPendingDocuments(): Promise<void> {
    if (analysis && !analysisApplied) {
      const details = await postCommercial({
        action: "updateDetails",
        caseId: item.id,
        name: analysis.projectName || item.name,
        clientName: analysis.clientName || item.clientName || "",
        siteLabel: analysis.projectName || item.siteLabel || "",
        contactName: analysis.contactName || item.contactName || "",
        contactPhone: item.contactPhone || "",
        contactEmail: item.contactEmail || "",
        description: analysis.description || item.description || "",
        nextAction: item.nextAction || "",
      });
      const updated = details.payload.cases.find((candidate) => candidate.id === item.id) ?? item;
      if (
        analysis.hours.be !== null ||
        analysis.hours.workshop !== null ||
        analysis.hours.install !== null
      ) {
        await postCommercial({
          action: "updateProvision",
          caseId: item.id,
          be: analysis.hours.be ?? updated.provisionHours.be,
          workshop: analysis.hours.workshop ?? updated.provisionHours.workshop,
          install: analysis.hours.install ?? updated.provisionHours.install,
        });
      }

      const quotes = obatFiles.filter((file) => obatKindForFile(file, analysis) === "QUOTE");
      const costings = obatFiles.filter((file) => obatKindForFile(file, analysis) === "COSTING");
      if (quotes.length > 0 && !uploadedQuote) {
        await uploadCommercialDocument(item.id, quotes, {
          category: "QUOTE",
          versionLabel: analysis.quoteNumber ?? "",
        });
        setUploadedQuote(true);
      }
      if (costings.length > 0 && !uploadedCosting) {
        await uploadCommercialDocument(item.id, costings, {
          category: "COSTING",
          versionLabel: analysis.quoteNumber ?? "",
        });
        setUploadedCosting(true);
      }
      setAnalysisApplied(true);
    }

    if (signedFile && !uploadedSigned) {
      await uploadCommercialDocument(item.id, [signedFile], {
        category: "QUOTE",
        versionLabel: analysis?.quoteNumber ?? "",
        isSignedQuote: true,
      });
      setUploadedSigned(true);
    }
  }

  async function prepareAndLaunch() {
    setLocalBusy(true);
    setLocalError(null);
    try {
      await applyPendingDocuments();
      const quoteReady = Boolean(quoteDocument) || stagedQuote || uploadedQuote;
      const costingReady = Boolean(costingDocument) || stagedCosting || uploadedCosting;
      const signedReady = Boolean(signedDocument) || Boolean(signedFile) || uploadedSigned;
      await onLaunch({
        commercialCaseId: item.id,
        quoteMissingDeclared: !quoteReady && quoteMissing,
        signedQuoteMissingDeclared: !signedReady && signedQuoteMissing,
        costingMissingDeclared: !costingReady && costingMissing,
        be: Number(be || 0),
        workshop: Number(workshop || 0),
        install: Number(install || 0),
      });
    } catch (prepareError) {
      setLocalError(
        prepareError instanceof Error
          ? `Préparation du chantier interrompue : ${prepareError.message}`
          : "La préparation du chantier a échoué.",
      );
    } finally {
      setLocalBusy(false);
    }
  }

  return (
    <div className="launchSheet launchSheetV2">
      <div className="launchSheetTitle">
        <div>
          <strong>Feuille de lancement</strong>
          <span>
            {item.name} · {item.clientName || "Client à compléter"} · pose{" "}
            {formatDateOnly(item.plannedInstallDate)}
          </span>
        </div>
        <button type="button" onClick={onCancel}>
          <X size={15} />
        </button>
      </div>

      <input
        ref={obatInputRef}
        hidden
        type="file"
        multiple
        accept=".pdf,.csv,application/pdf,text/csv"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.currentTarget.value = "";
          void analyzeFiles(files);
        }}
      />
      <input
        ref={signedInputRef}
        hidden
        type="file"
        accept=".pdf,image/*"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.currentTarget.value = "";
          setSignedFile(file);
          if (file) setSignedQuoteMissing(false);
        }}
      />

      <button
        type="button"
        className="launchObatDrop"
        disabled={busy || localBusy}
        onClick={() => obatInputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void analyzeFiles(Array.from(event.dataTransfer.files));
        }}
      >
        {localBusy ? <RefreshCw className="chantiersSpin" size={18} /> : <Upload size={18} />}
        <div>
          <strong>Déposer devis PDF + bordereau CSV OBAT</strong>
          <span>
            PAPOT lit le devis, rapproche le même n° et remplit automatiquement les heures du
            bordereau.
          </span>
        </div>
        <em>
          {obatFiles.length
            ? obatFiles.map((file) => file.name).join(" + ")
            : "Choisir les fichiers"}
        </em>
      </button>

      {analysis ? (
        <div className="launchObatResult">
          <CheckCircle2 size={15} />
          <strong>{analysis.quoteNumber ?? "OBAT reconnu"}</strong>
          <span>{analysis.clientName ?? item.clientName ?? "Client non détecté"}</span>
          <span>
            BE <b>{analysis.hours.be ?? "—"} h</b>
          </span>
          <span>
            Atelier <b>{analysis.hours.workshop ?? "—"} h</b>
          </span>
          <span>
            Pose <b>{analysis.hours.install ?? "—"} h</b>
          </span>
        </div>
      ) : null}
      {localError ? <div className="launchLocalError">{localError}</div> : null}

      <div className="launchDocuments launchDocumentsV2">
        <LaunchDocumentCard
          label="Devis client"
          presentName={quoteDocument?.fileName ?? null}
          stagedName={
            stagedQuote
              ? (obatFiles.find((file) => analysis && obatKindForFile(file, analysis) === "QUOTE")
                  ?.name ?? "Devis OBAT")
              : uploadedQuote
                ? "Devis ajouté"
                : null
          }
          missing={quoteMissing}
          onMissing={setQuoteMissing}
          missingLabel="Je n'ai pas le devis"
        />
        <LaunchDocumentCard
          label="Devis signé"
          presentName={signedDocument?.fileName ?? null}
          stagedName={signedFile?.name ?? (uploadedSigned ? "Devis signé ajouté" : null)}
          missing={signedQuoteMissing}
          onMissing={setSignedQuoteMissing}
          missingLabel="Je n'ai pas le devis signé"
          actionLabel={signedDocument ? "Remplacer" : "Ajouter"}
          onAction={() => signedInputRef.current?.click()}
        />
        <LaunchDocumentCard
          label="Déboursé / bordereau OBAT"
          presentName={costingDocument?.fileName ?? null}
          stagedName={
            stagedCosting
              ? (obatFiles.find((file) => analysis && obatKindForFile(file, analysis) === "COSTING")
                  ?.name ?? "Bordereau OBAT")
              : uploadedCosting
                ? "Bordereau ajouté"
                : null
          }
          missing={costingMissing}
          onMissing={setCostingMissing}
          missingLabel="Je n'ai pas le bordereau"
        />
      </div>

      <div className="launchHours launchHoursV2">
        <label>
          <span>BE</span>
          <div>
            <input
              type="number"
              min="0"
              step="0.1"
              value={be}
              onChange={(event) => setBe(event.target.value)}
            />
            <em>h</em>
          </div>
        </label>
        <label>
          <span>Atelier</span>
          <div>
            <input
              type="number"
              min="0"
              step="0.1"
              value={workshop}
              onChange={(event) => setWorkshop(event.target.value)}
            />
            <em>h</em>
          </div>
        </label>
        <label>
          <span>Pose</span>
          <div>
            <input
              type="number"
              min="0"
              step="0.1"
              value={install}
              onChange={(event) => setInstall(event.target.value)}
            />
            <em>h</em>
          </div>
        </label>
      </div>

      <div className="launchFooter">
        <p>
          Chaque document doit être présent, ajouté maintenant ou explicitement déclaré absent. Les
          fichiers ajoutés sont classés dans l&apos;affaire avant le lancement.
        </p>
        <button
          type="button"
          className="primaryButton launchButton"
          disabled={busy || localBusy || !declarationsOk}
          onClick={() => void prepareAndLaunch()}
        >
          <PlayCircle size={15} /> {localBusy ? "Préparation…" : "Lancer le chantier"}
        </button>
      </div>
    </div>
  );
}

function LaunchDocumentCard({
  label,
  presentName,
  stagedName,
  missing,
  onMissing,
  missingLabel,
  actionLabel,
  onAction,
}: {
  label: string;
  presentName: string | null;
  stagedName: string | null;
  missing: boolean;
  onMissing: (value: boolean) => void;
  missingLabel: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const state = presentName ? "present" : stagedName ? "staged" : missing ? "declared" : "empty";
  return (
    <div className={`launchDocCard is-${state}`}>
      <div className="launchDocHead">
        <span>
          <Paperclip size={13} />
        </span>
        <strong>{label}</strong>
        {state === "present" ? (
          <em>Présent</em>
        ) : state === "staged" ? (
          <em>À ajouter</em>
        ) : state === "declared" ? (
          <em>Absent déclaré</em>
        ) : (
          <em>Manquant</em>
        )}
      </div>
      <div className="launchDocFile">{presentName ?? stagedName ?? "Aucun fichier"}</div>
      <div className="launchDocActions">
        {onAction ? (
          <button type="button" className="secondaryButton" onClick={onAction}>
            {actionLabel ?? "Ajouter"}
          </button>
        ) : (
          <span />
        )}
        {!presentName && !stagedName ? (
          <label className="launchDocMissing">
            <input
              type="checkbox"
              checked={missing}
              onChange={(event) => onMissing(event.target.checked)}
            />{" "}
            {missingLabel}
          </label>
        ) : null}
      </div>
    </div>
  );
}

function ChantiersStyles() {
  return (
    <style jsx global>{`
      .chantiersWorkspace {
        display: grid;
        gap: 15px;
        width: 100%;
      }
      .chantiersHeading {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
      }
      .chantiersHeading h1 {
        margin: 0 0 4px;
        font-size: 27px;
      }
      .chantiersHeading p {
        margin: 0;
        color: var(--muted);
        font-size: 11px;
      }
      .chantiersRefresh {
        min-height: 36px;
        padding: 0 11px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid #ddd9e8;
        border-radius: 8px;
        background: white;
        color: #5c5765;
      }
      .chantiersError,
      .launchLocalError {
        padding: 10px 12px;
        border: 1px solid #efc4bc;
        border-radius: 9px;
        background: #fff5f3;
        color: #a3493a;
        font-size: 11px;
      }
      .chantiersSummary {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 9px;
      }
      .chantiersSummary > div {
        min-height: 72px;
        padding: 11px 13px;
        display: grid;
        grid-template-columns: auto 1fr;
        grid-template-rows: auto auto;
        column-gap: 9px;
        align-content: center;
        border: 1px solid #e7e3ed;
        border-radius: 10px;
        background: white;
      }
      .chantiersSummary > div > span {
        grid-row: 1/3;
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        border-radius: 9px;
        background: #f1edff;
        color: #6c58c8;
      }
      .chantiersSummary strong {
        font-size: 20px;
        line-height: 1;
      }
      .chantiersSummary small {
        color: #85808e;
        font-size: 9px;
        font-weight: 700;
      }
      .chantiersSummary .isAccent {
        border-color: #d5c9ff;
        background: #fbf9ff;
      }
      .chantiersLaunchPanel {
        padding: 13px;
        display: grid;
        gap: 10px;
        border: 1px solid #ded6f1;
        border-radius: 11px;
        background: white;
      }
      .chantiersLaunchHeader > div {
        display: grid;
        gap: 2px;
      }
      .chantiersLaunchHeader strong {
        font-size: 12px;
      }
      .chantiersLaunchHeader span {
        color: #8b8692;
        font-size: 9px;
      }
      .chantiersLaunchList {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 7px;
      }
      .chantiersLaunchList > button {
        padding: 9px 10px;
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        border: 1px solid #ebe6f2;
        border-radius: 9px;
        background: #fdfcff;
        text-align: left;
        color: inherit;
      }
      .chantiersLaunchList > button:hover,
      .chantiersLaunchList > button.isSelected {
        border-color: #a895e9;
        background: #f6f2ff;
      }
      .chantiersLaunchList > button > span {
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        border-radius: 7px;
        background: #eee9ff;
        color: #6b57c8;
      }
      .chantiersLaunchList > button > div {
        min-width: 0;
        display: grid;
        gap: 2px;
      }
      .chantiersLaunchList > button strong {
        overflow: hidden;
        font-size: 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chantiersLaunchList > button small {
        overflow: hidden;
        color: #8d8794;
        font-size: 8px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chantiersLaunchList > button em {
        color: #7a7384;
        font-size: 8px;
        font-style: normal;
        white-space: nowrap;
      }
      .launchSheetV2 {
        padding: 14px;
        display: grid;
        gap: 11px;
        border: 1px solid #d9d0ee;
        border-radius: 11px;
        background: #fcfbff;
        box-shadow: 0 8px 24px rgb(68 48 120 / 0.05);
      }
      .launchSheetTitle {
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }
      .launchSheetTitle > div {
        display: grid;
        gap: 2px;
      }
      .launchSheetTitle strong {
        font-size: 12px;
      }
      .launchSheetTitle span {
        color: #807988;
        font-size: 8.5px;
      }
      .launchSheetTitle > button {
        border: 0;
        background: transparent;
        color: #7e7588;
      }
      .launchObatDrop {
        min-height: 64px;
        padding: 10px 12px;
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr) auto;
        gap: 9px;
        align-items: center;
        border: 1px dashed #a994e7;
        border-radius: 9px;
        background: #f7f3ff;
        color: #6552c7;
        text-align: left;
      }
      .launchObatDrop > div {
        display: grid;
        gap: 2px;
      }
      .launchObatDrop strong {
        font-size: 9.5px;
      }
      .launchObatDrop span {
        color: #887f94;
        font-size: 8px;
      }
      .launchObatDrop em {
        max-width: 280px;
        overflow: hidden;
        color: #756e7f;
        font-size: 7.5px;
        font-style: normal;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .launchObatResult {
        padding: 7px 9px;
        display: flex;
        align-items: center;
        gap: 9px;
        border: 1px solid #cfe2d6;
        border-radius: 8px;
        background: #f4fbf6;
        color: #4b7b5b;
        font-size: 8px;
      }
      .launchObatResult > strong {
        font-size: 9px;
      }
      .launchObatResult > span:first-of-type {
        margin-right: auto;
      }
      .launchDocumentsV2 {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .launchDocCard {
        padding: 10px;
        display: grid;
        gap: 8px;
        border: 1px solid #e6e1ec;
        border-radius: 9px;
        background: white;
      }
      .launchDocCard.is-present {
        border-color: #cce4d3;
        background: #f8fcf9;
      }
      .launchDocCard.is-staged {
        border-color: #cfc4f1;
        background: #faf8ff;
      }
      .launchDocCard.is-declared {
        border-color: #eadcc8;
        background: #fffaf4;
      }
      .launchDocHead {
        display: grid;
        grid-template-columns: 22px 1fr auto;
        gap: 6px;
        align-items: center;
      }
      .launchDocHead > span {
        width: 22px;
        height: 22px;
        display: grid;
        place-items: center;
        border-radius: 6px;
        background: #f0ecf7;
        color: #6e5bc4;
      }
      .launchDocHead strong {
        font-size: 9px;
      }
      .launchDocHead em {
        padding: 3px 5px;
        border-radius: 999px;
        background: #f0edf3;
        color: #77707d;
        font-size: 6.8px;
        font-style: normal;
        font-weight: 800;
      }
      .launchDocCard.is-present .launchDocHead em {
        background: #e4f4e9;
        color: #3e8057;
      }
      .launchDocCard.is-staged .launchDocHead em {
        background: #ede8ff;
        color: #6550c7;
      }
      .launchDocFile {
        overflow: hidden;
        color: #6f6876;
        font-size: 8px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .launchDocActions {
        min-height: 26px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 7px;
      }
      .launchDocActions .secondaryButton {
        min-height: 26px;
        padding: 0 8px;
        font-size: 7.5px;
      }
      .launchDocMissing {
        display: flex;
        align-items: center;
        gap: 5px;
        color: #756d79;
        font-size: 7.5px;
      }
      .launchDocMissing input {
        width: 13px !important;
        height: 13px !important;
        min-height: 0 !important;
        padding: 0 !important;
        margin: 0;
        accent-color: #7662cf;
      }
      .launchHoursV2 {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .launchHoursV2 label {
        padding: 9px 10px;
        display: grid;
        gap: 5px;
        border: 1px solid #e3deeb;
        border-radius: 8px;
        background: white;
      }
      .launchHoursV2 label > span {
        color: #6b6472;
        font-size: 8px;
        font-weight: 800;
      }
      .launchHoursV2 label > div {
        display: flex;
        align-items: center;
      }
      .launchHoursV2 input {
        min-width: 0;
        width: 100%;
        padding: 0;
        border: 0;
        outline: 0;
        background: transparent;
        font-size: 18px;
        font-weight: 750;
        color: #4f4758;
      }
      .launchHoursV2 em {
        color: #9a93a0;
        font-size: 9px;
        font-style: normal;
      }
      .launchFooter {
        display: flex;
        justify-content: space-between;
        gap: 15px;
        align-items: center;
      }
      .launchFooter p {
        max-width: 720px;
        margin: 0;
        color: #8b8491;
        font-size: 8px;
      }
      .launchButton {
        width: max-content;
        white-space: nowrap;
      }
      .chantiersToolbar {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
      }
      .chantiersModes {
        display: flex;
        gap: 5px;
      }
      .chantiersModes button {
        min-height: 31px;
        padding: 0 10px;
        border: 1px solid #e0dce8;
        border-radius: 7px;
        background: white;
        color: #6c6675;
        font-size: 10px;
      }
      .chantiersModes button.isActive {
        border-color: #9d8be7;
        background: #f1edff;
        color: #6551c7;
        font-weight: 800;
      }
      .chantiersSearch {
        width: min(560px, 50vw);
        min-height: 34px;
        padding: 0 9px;
        display: flex;
        align-items: center;
        gap: 7px;
        border: 1px solid #ded9e6;
        border-radius: 8px;
        background: white;
        color: #8a8592;
      }
      .chantiersSearch input {
        min-width: 0;
        flex: 1;
        border: 0;
        outline: 0;
        font: inherit;
        font-size: 10px;
      }
      .chantiersSearch button {
        padding: 0;
        border: 0;
        background: transparent;
        color: #8a8592;
      }
      .chantiersEmpty {
        min-height: 330px;
        display: grid;
        place-items: center;
        align-content: center;
        gap: 8px;
        border: 1px solid #e8e4ef;
        border-radius: 12px;
        background: white;
        color: #8a8592;
        font-size: 10px;
        text-align: center;
      }
      .chantiersEmpty strong {
        color: #59535f;
        font-size: 13px;
      }
      .chantiersTable {
        overflow: hidden;
        border: 1px solid #e8e4ef;
        border-radius: 12px;
        background: white;
      }
      .chantiersRow {
        min-height: 66px;
        padding: 10px 12px;
        display: grid;
        grid-template-columns:
          74px minmax(220px, 1.6fr) minmax(130px, 0.7fr) minmax(120px, 0.55fr)
          20px;
        gap: 10px;
        align-items: center;
        border-bottom: 1px solid #f0edf4;
        color: inherit;
        text-decoration: none;
      }
      .chantiersRow:last-child {
        border-bottom: 0;
      }
      .chantiersRow:hover {
        background: #fbf9ff;
      }
      .chantierStatus {
        width: max-content;
        padding: 4px 7px;
        border-radius: 999px;
        font-size: 8px;
        font-weight: 800;
      }
      .chantierStatus-active {
        background: #e9f7ee;
        color: #378058;
      }
      .chantierStatus-done {
        background: #eef2fa;
        color: #546e9d;
      }
      .chantierStatus-archived {
        background: #ece9ed;
        color: #706a74;
      }
      .chantiersRowMain,
      .chantiersRowRefs {
        min-width: 0;
        display: grid;
        gap: 3px;
      }
      .chantiersRowMain strong {
        overflow: hidden;
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chantiersRowMain span,
      .chantiersRowRefs span,
      .chantiersRowRefs small {
        overflow: hidden;
        color: #8c8793;
        font-size: 8.5px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chantiersRowDate {
        display: flex;
        align-items: center;
        gap: 5px;
        color: #706979;
        font-size: 8.5px;
      }
      .chantiersRowArrow {
        color: #9b90b0;
      }
      .chantiersSpin {
        animation: chantiersSpin 1s linear infinite;
      }
      @keyframes chantiersSpin {
        to {
          transform: rotate(360deg);
        }
      }
      @media (max-width: 1000px) {
        .chantiersSummary {
          grid-template-columns: 1fr 1fr;
        }
        .chantiersRow {
          grid-template-columns: 70px minmax(200px, 1fr) minmax(110px, 0.6fr);
        }
        .chantiersRowDate,
        .chantiersRowArrow {
          display: none;
        }
        .launchDocumentsV2 {
          grid-template-columns: 1fr 1fr 1fr;
        }
        .launchObatDrop {
          grid-template-columns: 30px 1fr;
        }
        .launchObatDrop em {
          grid-column: 2;
        }
      }
      @media (max-width: 760px) {
        .chantiersHeading,
        .chantiersToolbar,
        .launchFooter {
          flex-direction: column;
          align-items: stretch;
        }
        .chantiersSearch {
          width: 100%;
        }
        .chantiersRow {
          grid-template-columns: 65px minmax(0, 1fr);
        }
        .chantiersRowRefs {
          grid-column: 2;
        }
        .launchDocumentsV2,
        .launchHoursV2 {
          grid-template-columns: 1fr;
        }
        .chantiersLaunchList {
          grid-template-columns: 1fr;
        }
        .launchObatResult {
          flex-wrap: wrap;
        }
      }
    `}</style>
  );
}
