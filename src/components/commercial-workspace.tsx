"use client";

import {
  AlertTriangle,
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
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Upload,
  X,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COMMERCIAL_DOCUMENT_CATEGORY_LABELS,
  COMMERCIAL_STATUS_LABELS,
  commercialHasSignedQuote,
  commercialNeedsFollowUp,
  isCommercialClosed,
  isQuoteOverdue,
  nextCommercialDeadline,
  type CommercialCase,
  type CommercialDocument,
  type CommercialDocumentCategory,
  type CommercialPayload,
  type CommercialStatus,
} from "@/lib/commercial/domain";
import type { CommercialCapabilities } from "@/lib/commercial/mutations";

type CommercialSnapshot = {
  payload: CommercialPayload;
  actor: { userId: string; displayName: string };
  capabilities: CommercialCapabilities;
  suggestedPeople: string[];
  focusCaseId?: string;
  serverNow: string;
};

type MutationBody = Record<string, unknown> & { action: string };
type ListMode = "active" | "confirmed" | "archives";
type CommercialDetailTab = "client" | "follow" | "notes" | "documents" | "capacity" | "history";

const errorMessages: Record<string, string> = {
  DESKTOP_RUNTIME_NOT_CONFIGURED: "Le poste PAPOT n'est pas configuré.",
  COMMERCIAL_LOCKED:
    "Le suivi commercial est modifié sur un autre poste. Réessaie dans quelques secondes.",
  COMMERCIAL_VERSION_CONFLICT:
    "Le suivi commercial a changé sur un autre poste. Actualise puis réessaie.",
  COMMERCIAL_CASE_NOT_FOUND: "Cette affaire n'existe plus dans le suivi commercial.",
  COMMERCIAL_CASE_CLOSED: "Cette affaire est clôturée. Il faut la rouvrir avant de la modifier.",
  COMMERCIAL_REVIEW_DATE_REQUIRED:
    "Une date de revue ou de relance est obligatoire pour ce statut.",
  COMMERCIAL_CONFIRMATION_DATE_REQUIRED: "La date prévisionnelle de confirmation est obligatoire.",
  COMMERCIAL_QUOTE_OWNER_AND_DATE_REQUIRED:
    "Le responsable du chiffrage et la date prévue d'envoi sont obligatoires.",
  COMMERCIAL_INSTALL_DATE_REQUIRED:
    "La date prévisionnelle de pose est obligatoire pour confirmer l'affaire.",
  COMMERCIAL_QUOTE_DATE_NOT_LATER:
    "La nouvelle date d'envoi doit être postérieure à la date actuelle.",
  COMMERCIAL_DOCUMENTS_REQUIRED: "Sélectionne au moins un document.",
  COMMERCIAL_DOCUMENTS_TOO_MANY: "Tu peux ajouter jusqu'à 12 documents à la fois.",
  COMMERCIAL_DOCUMENT_TOO_LARGE: "Un document dépasse la limite technique de 100 Mo.",
  COMMERCIAL_SIGNED_QUOTE_CATEGORY_INVALID:
    "Un devis signé doit être classé dans la catégorie Devis.",
  COMMERCIAL_SOURCE_TASK_ALREADY_LINKED: "Une affaire commerciale existe déjà pour cette tâche.",
};

function formatDateOnly(value: string | null): string {
  if (!value) return "Sans date";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day, 12));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} o`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} Ko`;
  return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} Mo`;
}

function statusTone(status: CommercialStatus): string {
  if (status === "FOLLOW_UP") return "follow";
  if (status === "CHIFFRAGE") return "quote";
  if (status === "LIKELY") return "likely";
  if (status === "CONFIRMED") return "confirmed";
  if (status === "LOST" || status === "ABANDONED") return "closed";
  if (status === "WAITING") return "waiting";
  return "lead";
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase("fr-FR");
}

function matchesSearch(item: CommercialCase, query: string): boolean {
  if (!query) return true;
  return [
    item.name,
    item.clientName,
    item.siteLabel,
    item.contactName,
    item.contactPhone,
    item.contactEmail,
    item.description,
    item.nextAction,
  ]
    .filter(Boolean)
    .some((value) => normalizeSearch(String(value)).includes(query));
}

function documentHref(
  item: CommercialCase,
  document: CommercialDocument,
  download = false,
): string {
  return `/api/desktop/commercial/${item.id}/documents/${document.id}${download ? "?download=1" : ""}`;
}

function useCommercialData() {
  const [snapshot, setSnapshot] = useState<CommercialSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/desktop/commercial", { cache: "no-store" });
      const body = (await response.json()) as CommercialSnapshot & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "COMMERCIAL_LOAD_FAILED");
      setSnapshot(body);
    } catch (loadError) {
      const code = loadError instanceof Error ? loadError.message : "COMMERCIAL_LOAD_FAILED";
      setError(errorMessages[code] ?? "Impossible de charger le suivi commercial.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(async (body: MutationBody, successMessage: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/desktop/commercial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as CommercialSnapshot & { error?: string };
      if (!response.ok) {
        const code = result.error ?? "COMMERCIAL_MUTATION_FAILED";
        throw new Error(errorMessages[code] ?? "L'action commerciale n'a pas pu être enregistrée.");
      }
      setSnapshot(result);
      setNotice(successMessage);
      return result;
    } catch (mutationError) {
      setError(
        mutationError instanceof Error ? mutationError.message : "L'action commerciale a échoué.",
      );
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const uploadDocuments = useCallback(
    async (
      caseId: string,
      files: File[],
      options: {
        category: CommercialDocumentCategory;
        versionLabel: string;
        variantLabel: string;
        isCurrent: boolean;
        isSignedQuote: boolean;
      },
    ) => {
      if (files.length === 0) return null;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const form = new FormData();
        files.forEach((file) => form.append("files", file));
        form.set("category", options.category);
        form.set("versionLabel", options.versionLabel);
        form.set("variantLabel", options.variantLabel);
        form.set("isCurrent", options.isCurrent ? "1" : "0");
        form.set("isSignedQuote", options.isSignedQuote ? "1" : "0");
        const response = await fetch(`/api/desktop/commercial/${caseId}/documents`, {
          method: "POST",
          body: form,
        });
        const result = (await response.json()) as CommercialSnapshot & { error?: string };
        if (!response.ok) {
          const code = result.error ?? "COMMERCIAL_DOCUMENT_UPLOAD_FAILED";
          throw new Error(errorMessages[code] ?? "Les documents n'ont pas pu être ajoutés.");
        }
        setSnapshot(result);
        setNotice(
          `${files.length} document${files.length > 1 ? "s" : ""} ajouté${files.length > 1 ? "s" : ""}.`,
        );
        return result;
      } catch (uploadError) {
        setError(
          uploadError instanceof Error ? uploadError.message : "L'ajout des documents a échoué.",
        );
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { snapshot, loading, busy, error, notice, load, mutate, uploadDocuments };
}

export function CommercialWorkspace() {
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus");
  const { snapshot, loading, busy, error, notice, load, mutate, uploadDocuments } =
    useCommercialData();
  const [mode, setMode] = useState<ListMode>("active");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(focusId);
  const [showCreate, setShowCreate] = useState(false);
  const now = useMemo(() => new Date(snapshot?.serverNow ?? Date.now()), [snapshot?.serverNow]);

  const allCases = useMemo(() => snapshot?.payload.cases ?? [], [snapshot?.payload.cases]);
  const search = normalizeSearch(query);
  const visibleCases = useMemo(() => {
    const matching = allCases.filter((item) => matchesSearch(item, search));
    if (search) return matching;
    if (mode === "archives") return matching.filter(isCommercialClosed);
    if (mode === "confirmed") return matching.filter((item) => item.status === "CONFIRMED");
    return matching.filter((item) => !isCommercialClosed(item) && item.status !== "CONFIRMED");
  }, [allCases, mode, search]);

  const selected = allCases.find((item) => item.id === selectedId) ?? visibleCases[0] ?? null;
  const activeCount = allCases.filter(
    (item) => !isCommercialClosed(item) && item.status !== "CONFIRMED",
  ).length;
  const followUpCount = allCases.filter(
    (item) => commercialNeedsFollowUp(item, now) && !isCommercialClosed(item),
  ).length;
  const overdueQuoteCount = allCases.filter((item) => isQuoteOverdue(item, now)).length;
  const confirmedCount = allCases.filter((item) => item.status === "CONFIRMED").length;

  useEffect(() => {
    if (focusId && allCases.some((item) => item.id === focusId)) {
      setSelectedId(focusId);
      return;
    }
    if (!selectedId || !allCases.some((item) => item.id === selectedId)) {
      setSelectedId(visibleCases[0]?.id ?? null);
    }
  }, [allCases, focusId, selectedId, visibleCases]);

  return (
    <div className="commercialWorkspace">
      <section className="commercialHeading">
        <div>
          <h1>Commercial</h1>
          <p>Pistes, chiffrages, relances et passage vers l&apos;affaire confirmée.</p>
        </div>
        <div className="commercialHeadingActions">
          {snapshot?.capabilities.canCreate ? (
            <button
              type="button"
              className="primaryButton"
              onClick={() => setShowCreate((value) => !value)}
            >
              <Plus size={15} /> Nouvelle affaire
            </button>
          ) : null}
          <button
            type="button"
            className="commercialRefresh"
            onClick={() => void load()}
            disabled={busy}
          >
            <RefreshCw size={14} /> Actualiser
          </button>
        </div>
      </section>

      {error ? <div className="commercialMessage commercialError">{error}</div> : null}
      {notice ? <div className="commercialMessage commercialSuccess">{notice}</div> : null}

      {showCreate && snapshot ? (
        <CreateCommercialCase
          busy={busy}
          onCancel={() => setShowCreate(false)}
          onCreate={async (body) => {
            const result = await mutate(body, "Affaire commerciale créée.");
            if (result?.focusCaseId) {
              setSelectedId(result.focusCaseId);
              setMode("active");
              setQuery("");
              setShowCreate(false);
            }
          }}
        />
      ) : null}

      <section className="commercialSummary">
        <SummaryCard label="Actives" value={activeCount} />
        <SummaryCard
          label="À relancer"
          value={followUpCount}
          tone={followUpCount ? "alert" : undefined}
        />
        <SummaryCard
          label="Chiffrages en retard"
          value={overdueQuoteCount}
          tone={overdueQuoteCount ? "warning" : undefined}
        />
        <SummaryCard
          label="Confirmées"
          value={confirmedCount}
          tone={confirmedCount ? "success" : undefined}
        />
      </section>

      <section className="commercialToolbar">
        <div className="commercialModes">
          <button
            className={mode === "active" ? "isActive" : ""}
            type="button"
            onClick={() => setMode("active")}
          >
            Actives
          </button>
          <button
            className={mode === "confirmed" ? "isActive" : ""}
            type="button"
            onClick={() => setMode("confirmed")}
          >
            Confirmées
          </button>
          <button
            className={mode === "archives" ? "isActive" : ""}
            type="button"
            onClick={() => setMode("archives")}
          >
            Archives
          </button>
        </div>
        <label className="commercialSearch">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher affaire, client, lieu, contact…"
          />
          {query ? (
            <button type="button" title="Effacer" onClick={() => setQuery("")}>
              <X size={13} />
            </button>
          ) : null}
        </label>
      </section>

      {loading && !snapshot ? (
        <div className="commercialLoading">
          <RefreshCw size={18} className="commercialSpin" /> Chargement du suivi commercial…
        </div>
      ) : (
        <div className="commercialMasterDetail">
          <aside className="commercialListPanel">
            {search ? (
              <div className="commercialSearchHint">
                Recherche dans les affaires actives et archivées
              </div>
            ) : null}
            {visibleCases.length === 0 ? (
              <div className="commercialEmptyList">
                <BriefcaseBusiness size={26} />
                <strong>Aucune affaire ici</strong>
              </div>
            ) : (
              visibleCases.map((item) => (
                <CommercialListRow
                  key={item.id}
                  item={item}
                  selected={selected?.id === item.id}
                  now={now}
                  onSelect={() => setSelectedId(item.id)}
                />
              ))
            )}
          </aside>

          <main className="commercialDetailPanel">
            {selected && snapshot ? (
              <CommercialCaseDetail
                key={selected.id}
                item={selected}
                now={now}
                busy={busy}
                capabilities={snapshot.capabilities}
                suggestedPeople={snapshot.suggestedPeople}
                mutate={mutate}
                uploadDocuments={uploadDocuments}
              />
            ) : (
              <div className="commercialNoSelection">
                <FolderOpen size={32} />
                <strong>Sélectionne une affaire</strong>
              </div>
            )}
          </main>
        </div>
      )}

      <CommercialStyles />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "alert" | "warning" | "success";
}) {
  return (
    <div className={tone ? `is-${tone}` : ""}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function CreateCommercialCase({
  busy,
  onCancel,
  onCreate,
}: {
  busy: boolean;
  onCancel: () => void;
  onCreate: (body: MutationBody) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [siteLabel, setSiteLabel] = useState("");
  const [reviewDate, setReviewDate] = useState("");

  return (
    <form
      className="commercialCreate"
      onSubmit={(event) => {
        event.preventDefault();
        void onCreate({ action: "create", name, clientName, siteLabel, reviewDate });
      }}
    >
      <div className="commercialCreateTitle">
        <div>
          <strong>Nouvelle affaire</strong>
          <span>Une vraie piste commerciale. Pour une note à la volée, utilise Entrées.</span>
        </div>
        <button type="button" onClick={onCancel}>
          <X size={15} />
        </button>
      </div>
      <label>
        <span>Nom de l&apos;affaire *</span>
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Client, lieu ou nom libre"
          required
        />
      </label>
      <label>
        <span>Client</span>
        <input value={clientName} onChange={(event) => setClientName(event.target.value)} />
      </label>
      <label>
        <span>Lieu chantier</span>
        <input value={siteLabel} onChange={(event) => setSiteLabel(event.target.value)} />
      </label>
      <label>
        <span>Prochaine revue *</span>
        <input
          type="date"
          value={reviewDate}
          onChange={(event) => setReviewDate(event.target.value)}
          required
        />
      </label>
      <button
        type="submit"
        className="primaryButton"
        disabled={busy || !name.trim() || !reviewDate}
      >
        <Plus size={14} /> Créer la piste
      </button>
    </form>
  );
}

function CommercialListRow({
  item,
  selected,
  now,
  onSelect,
}: {
  item: CommercialCase;
  selected: boolean;
  now: Date;
  onSelect: () => void;
}) {
  const overdueQuote = isQuoteOverdue(item, now);
  const followUp = commercialNeedsFollowUp(item, now);
  const deadline = nextCommercialDeadline(item);
  return (
    <button
      type="button"
      className={`commercialListRow${selected ? " isSelected" : ""}${overdueQuote || followUp ? " needsAction" : ""}`}
      onClick={onSelect}
    >
      <div className="commercialListTop">
        <span className={`commercialStatus commercialStatus-${statusTone(item.status)}`}>
          {COMMERCIAL_STATUS_LABELS[item.status]}
        </span>
        {overdueQuote ? <span className="commercialAlertPill">Chiffrage en retard</span> : null}
        {followUp && !overdueQuote ? <span className="commercialAlertPill">À traiter</span> : null}
      </div>
      <strong>{item.name}</strong>
      <span>
        {[item.clientName, item.siteLabel].filter(Boolean).join(" · ") ||
          "Client / lieu à compléter"}
      </span>
      <small>
        {deadline ? (
          <>
            <CalendarClock size={10} /> {formatDateOnly(deadline)}
          </>
        ) : item.status === "CONFIRMED" ? (
          <>
            <CheckCircle2 size={10} /> Confirmée
          </>
        ) : null}
      </small>
    </button>
  );
}

function CommercialCaseDetail({
  item,
  now,
  busy,
  capabilities,
  suggestedPeople,
  mutate,
  uploadDocuments,
}: {
  item: CommercialCase;
  now: Date;
  busy: boolean;
  capabilities: CommercialCapabilities;
  suggestedPeople: string[];
  mutate: (body: MutationBody, successMessage: string) => Promise<CommercialSnapshot | null>;
  uploadDocuments: ReturnType<typeof useCommercialData>["uploadDocuments"];
}) {
  const [activeTab, setActiveTab] = useState<CommercialDetailTab>("client");
  const closed = isCommercialClosed(item);
  const overdueQuote = isQuoteOverdue(item, now);
  const followUpDue = commercialNeedsFollowUp(item, now);
  const missingSignedQuote = item.status === "CONFIRMED" && !commercialHasSignedQuote(item);
  const canEditOpen = capabilities.canModify && !closed;
  const canEditCapacity = capabilities.canProvision && !closed && item.status !== "CONFIRMED";
  const tabs: Array<{
    id: CommercialDetailTab;
    label: string;
    icon: typeof BriefcaseBusiness;
    badge?: number;
  }> = [
    { id: "client", label: "Client", icon: BriefcaseBusiness },
    { id: "follow", label: "Suivi", icon: Clock3 },
    { id: "notes", label: "Notes internes", icon: FileText },
    { id: "documents", label: "Documents", icon: Paperclip, badge: item.documents.length },
    { id: "capacity", label: "Charge", icon: CalendarClock },
    { id: "history", label: "Historique", icon: History, badge: item.history.length },
  ];

  return (
    <div className="commercialDetailContent">
      <header className="commercialDetailHeader">
        <div>
          <div className="commercialListTop">
            <span className={`commercialStatus commercialStatus-${statusTone(item.status)}`}>
              {COMMERCIAL_STATUS_LABELS[item.status]}
            </span>
            {overdueQuote ? <span className="commercialAlertPill">Chiffrage en retard</span> : null}
            {followUpDue && !overdueQuote ? (
              <span className="commercialAlertPill">Action commerciale à faire</span>
            ) : null}
          </div>
          <h2>{item.name}</h2>
          <p>
            Créée par {item.createdByName} le {formatDateTime(item.createdAt)}
          </p>
        </div>
      </header>

      {missingSignedQuote ? (
        <div className="commercialSignedWarning">
          <AlertTriangle size={18} />
          <div>
            <strong>Devis signé manquant</strong>
            <span>
              L&apos;affaire reste confirmée et peut avancer. Le rappel disparaîtra dès qu&apos;un
              devis signé sera ajouté.
            </span>
          </div>
        </div>
      ) : null}

      <nav className="commercialDetailTabs" aria-label="Rubriques de l'affaire">
        {tabs.map(({ id, label, icon: Icon, badge }) => (
          <button
            key={id}
            type="button"
            className={activeTab === id ? "isActive" : undefined}
            aria-current={activeTab === id ? "page" : undefined}
            onClick={() => setActiveTab(id)}
          >
            <Icon size={14} />
            <span>{label}</span>
            {badge !== undefined ? <small>{badge}</small> : null}
          </button>
        ))}
      </nav>

      <div className="commercialTabBody">
        {activeTab === "client" ? (
          <DetailsSection item={item} busy={busy} canModify={canEditOpen} mutate={mutate} />
        ) : null}

        {activeTab === "follow" ? (
          closed ? (
            <ClosedCommercialCase
              item={item}
              busy={busy}
              canModify={capabilities.canModify}
              mutate={mutate}
            />
          ) : (
            <>
              <StatusSection
                item={item}
                busy={busy}
                canModify={capabilities.canModify}
                canConfirm={capabilities.canConfirm}
                suggestedPeople={suggestedPeople}
                mutate={mutate}
              />
              <CloseSection
                item={item}
                busy={busy}
                canModify={capabilities.canModify}
                mutate={mutate}
              />
            </>
          )
        ) : null}

        {activeTab === "notes" ? (
          <QuoteNotesSection item={item} busy={busy} canModify={canEditOpen} mutate={mutate} />
        ) : null}

        {activeTab === "documents" ? (
          <DocumentsSection
            item={item}
            busy={busy}
            canModify={canEditOpen}
            uploadDocuments={uploadDocuments}
          />
        ) : null}

        {activeTab === "capacity" ? (
          <ProvisionSection
            item={item}
            busy={busy}
            canProvision={canEditCapacity}
            mutate={mutate}
          />
        ) : null}

        {activeTab === "history" ? <HistorySection item={item} /> : null}
      </div>
    </div>
  );
}

function DetailsSection({
  item,
  busy,
  canModify,
  mutate,
}: {
  item: CommercialCase;
  busy: boolean;
  canModify: boolean;
  mutate: (body: MutationBody, successMessage: string) => Promise<CommercialSnapshot | null>;
}) {
  const [name, setName] = useState(item.name);
  const [clientName, setClientName] = useState(item.clientName ?? "");
  const [siteLabel, setSiteLabel] = useState(item.siteLabel ?? "");
  const [contactName, setContactName] = useState(item.contactName ?? "");
  const [contactPhone, setContactPhone] = useState(item.contactPhone ?? "");
  const [contactEmail, setContactEmail] = useState(item.contactEmail ?? "");
  const [description, setDescription] = useState(item.description ?? "");
  const [nextAction, setNextAction] = useState(item.nextAction ?? "");

  return (
    <section className="commercialSection">
      <div className="commercialSectionTitle">
        <BriefcaseBusiness size={15} /> Client / affaire
      </div>
      <div className="commercialTwoFields">
        <Field label="Nom de l'affaire">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={!canModify}
          />
        </Field>
        <Field label="Client">
          <input
            value={clientName}
            onChange={(event) => setClientName(event.target.value)}
            disabled={!canModify}
          />
        </Field>
        <Field label="Lieu chantier">
          <input
            value={siteLabel}
            onChange={(event) => setSiteLabel(event.target.value)}
            disabled={!canModify}
          />
        </Field>
        <Field label="Contact">
          <input
            value={contactName}
            onChange={(event) => setContactName(event.target.value)}
            disabled={!canModify}
          />
        </Field>
        <Field label="Téléphone">
          <input
            value={contactPhone}
            onChange={(event) => setContactPhone(event.target.value)}
            disabled={!canModify}
          />
        </Field>
        <Field label="E-mail">
          <input
            type="email"
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
            disabled={!canModify}
          />
        </Field>
      </div>
      <Field label="C'est quoi ?">
        <textarea
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={!canModify}
        />
      </Field>
      <Field label="J'en fais quoi ?">
        <textarea
          rows={2}
          value={nextAction}
          onChange={(event) => setNextAction(event.target.value)}
          disabled={!canModify}
        />
      </Field>
      {canModify ? (
        <button
          type="button"
          className="primaryButton commercialFitButton"
          disabled={busy || !name.trim()}
          onClick={() =>
            void mutate(
              {
                action: "updateDetails",
                caseId: item.id,
                name,
                clientName,
                siteLabel,
                contactName,
                contactPhone,
                contactEmail,
                description,
                nextAction,
              },
              "Informations commerciales enregistrées.",
            )
          }
        >
          <Save size={14} /> Enregistrer
        </button>
      ) : null}
    </section>
  );
}

function StatusSection({
  item,
  busy,
  canModify,
  canConfirm,
  suggestedPeople,
  mutate,
}: {
  item: CommercialCase;
  busy: boolean;
  canModify: boolean;
  canConfirm: boolean;
  suggestedPeople: string[];
  mutate: (body: MutationBody, successMessage: string) => Promise<CommercialSnapshot | null>;
}) {
  const [target, setTarget] = useState<Exclude<CommercialStatus, "LOST" | "ABANDONED">>(
    item.status === "LOST" || item.status === "ABANDONED" ? "PISTE" : item.status,
  );
  const [reviewDate, setReviewDate] = useState(item.reviewDate ?? "");
  const [expectedDate, setExpectedDate] = useState(item.expectedConfirmationDate ?? "");
  const [quoteDueDate, setQuoteDueDate] = useState(item.quoteDueDate ?? "");
  const [quoteOwnerName, setQuoteOwnerName] = useState(item.quoteOwnerName ?? "");
  const [installDate, setInstallDate] = useState(item.plannedInstallDate ?? "");
  const [quoteFollowUpDate, setQuoteFollowUpDate] = useState("");
  const [followUpSummary, setFollowUpSummary] = useState("");
  const [followUpStatus, setFollowUpStatus] = useState<CommercialStatus>("WAITING");
  const [followUpNextDate, setFollowUpNextDate] = useState("");
  const [postponeDate, setPostponeDate] = useState("");
  const [postponeReason, setPostponeReason] = useState("");

  function saveStatus() {
    void mutate(
      {
        action: "setStatus",
        caseId: item.id,
        status: target,
        reviewDate: reviewDate || undefined,
        expectedConfirmationDate: expectedDate || undefined,
        quoteDueDate: quoteDueDate || undefined,
        quoteOwnerName: quoteOwnerName || undefined,
        plannedInstallDate: installDate || undefined,
      },
      "Statut commercial enregistré.",
    );
  }

  const followUpDateNeeded =
    followUpStatus === "WAITING" || followUpStatus === "PISTE" || followUpStatus === "LIKELY";

  return (
    <section className="commercialSection">
      <div className="commercialSectionTitle">
        <Clock3 size={15} /> Suivi commercial
      </div>
      {isQuoteOverdue(item) ? (
        <div className="commercialInlineAlert">
          <AlertTriangle size={15} /> Le devis devait être envoyé le{" "}
          {formatDateOnly(item.quoteDueDate)}. L&apos;affaire reste en Chiffrage en cours.
        </div>
      ) : null}

      {canModify ? (
        <div className="commercialStatusEditor">
          <Field label="Statut">
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value as typeof target)}
            >
              <option value="PISTE">Piste</option>
              <option value="CHIFFRAGE">Chiffrage en cours</option>
              <option value="WAITING">En attente</option>
              <option value="FOLLOW_UP">À relancer</option>
              <option value="LIKELY">Ça va tomber</option>
              {canConfirm ? <option value="CONFIRMED">Confirmée</option> : null}
            </select>
          </Field>
          {target === "PISTE" || target === "WAITING" ? (
            <Field label="Date de revue / retour *">
              <input
                type="date"
                value={reviewDate}
                onChange={(event) => setReviewDate(event.target.value)}
              />
            </Field>
          ) : null}
          {target === "LIKELY" ? (
            <Field label="Confirmation attendue *">
              <input
                type="date"
                value={expectedDate}
                onChange={(event) => setExpectedDate(event.target.value)}
              />
            </Field>
          ) : null}
          {target === "CHIFFRAGE" ? (
            <>
              <Field label="Responsable chiffrage *">
                <input
                  list={`quote-owner-${item.id}`}
                  value={quoteOwnerName}
                  onChange={(event) => setQuoteOwnerName(event.target.value)}
                />
                <datalist id={`quote-owner-${item.id}`}>
                  {suggestedPeople.map((person) => (
                    <option value={person} key={person} />
                  ))}
                </datalist>
              </Field>
              <Field label="Envoi du devis prévu *">
                <input
                  type="date"
                  value={quoteDueDate}
                  onChange={(event) => setQuoteDueDate(event.target.value)}
                />
              </Field>
            </>
          ) : null}
          {target === "CONFIRMED" ? (
            <Field label="Date prévisionnelle de pose *">
              <input
                type="date"
                value={installDate}
                onChange={(event) => setInstallDate(event.target.value)}
              />
            </Field>
          ) : null}
          <button
            type="button"
            className="secondaryButton commercialStatusSave"
            disabled={busy}
            onClick={saveStatus}
          >
            <Save size={13} /> Appliquer
          </button>
        </div>
      ) : null}

      {item.status === "CHIFFRAGE" && canModify ? (
        <div className="commercialSubcard">
          <strong>Devis prêt à partir ?</strong>
          <div className="commercialInlineForm">
            <Field label="Date de relance obligatoire">
              <input
                type="date"
                value={quoteFollowUpDate}
                onChange={(event) => setQuoteFollowUpDate(event.target.value)}
              />
            </Field>
            <button
              type="button"
              className="primaryButton"
              disabled={busy || !quoteFollowUpDate}
              onClick={() =>
                void mutate(
                  { action: "markQuoteSent", caseId: item.id, followUpDate: quoteFollowUpDate },
                  "Devis marqué envoyé. L'affaire est en attente de la relance.",
                )
              }
            >
              <Send size={14} /> Marquer envoyé
            </button>
          </div>
        </div>
      ) : null}

      {item.status === "CHIFFRAGE" && item.quoteDueDate && canModify ? (
        <details className="commercialDetailsBox">
          <summary>Reporter la date prévue d&apos;envoi</summary>
          <div className="commercialInlineForm">
            <Field label="Nouvelle date">
              <input
                type="date"
                value={postponeDate}
                onChange={(event) => setPostponeDate(event.target.value)}
              />
            </Field>
            <Field label="Motif obligatoire">
              <input
                value={postponeReason}
                onChange={(event) => setPostponeReason(event.target.value)}
                placeholder="Pourquoi le chiffrage est repoussé ?"
              />
            </Field>
            <button
              type="button"
              className="secondaryButton"
              disabled={busy || !postponeDate || !postponeReason.trim()}
              onClick={() =>
                void mutate(
                  {
                    action: "postponeQuoteDue",
                    caseId: item.id,
                    newDate: postponeDate,
                    reason: postponeReason,
                  },
                  "Date prévue du devis repoussée et historisée.",
                )
              }
            >
              <CalendarClock size={13} /> Reporter
            </button>
          </div>
        </details>
      ) : null}

      {canModify && item.status !== "CONFIRMED" ? (
        <div className="commercialSubcard">
          <strong>Enregistrer une relance</strong>
          <Field label="Compte rendu obligatoire">
            <textarea
              rows={2}
              value={followUpSummary}
              onChange={(event) => setFollowUpSummary(event.target.value)}
              placeholder="Résultat, contexte ou suite attendue"
            />
          </Field>
          <div className="commercialFollowGrid">
            <Field label="Suite">
              <select
                value={followUpStatus}
                onChange={(event) => setFollowUpStatus(event.target.value as CommercialStatus)}
              >
                <option value="WAITING">En attente</option>
                <option value="PISTE">Piste</option>
                <option value="LIKELY">Ça va tomber</option>
                <option value="CHIFFRAGE">Chiffrage en cours</option>
                {canConfirm ? <option value="CONFIRMED">Confirmée</option> : null}
                <option value="LOST">Perdu</option>
                <option value="ABANDONED">Abandonné</option>
              </select>
            </Field>
            {followUpDateNeeded ? (
              <Field
                label={followUpStatus === "LIKELY" ? "Confirmation attendue *" : "Prochaine date *"}
              >
                <input
                  type="date"
                  value={followUpNextDate}
                  onChange={(event) => setFollowUpNextDate(event.target.value)}
                />
              </Field>
            ) : null}
            {followUpStatus === "CHIFFRAGE" ? (
              <>
                <Field label="Responsable chiffrage *">
                  <input
                    list={`follow-owner-${item.id}`}
                    value={quoteOwnerName}
                    onChange={(event) => setQuoteOwnerName(event.target.value)}
                  />
                  <datalist id={`follow-owner-${item.id}`}>
                    {suggestedPeople.map((person) => (
                      <option value={person} key={person} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Envoi prévu *">
                  <input
                    type="date"
                    value={quoteDueDate}
                    onChange={(event) => setQuoteDueDate(event.target.value)}
                  />
                </Field>
              </>
            ) : null}
            {followUpStatus === "CONFIRMED" ? (
              <Field label="Date prévisionnelle de pose *">
                <input
                  type="date"
                  value={installDate}
                  onChange={(event) => setInstallDate(event.target.value)}
                />
              </Field>
            ) : null}
          </div>
          <button
            type="button"
            className="primaryButton commercialFitButton"
            disabled={busy || !followUpSummary.trim() || (followUpDateNeeded && !followUpNextDate)}
            onClick={() =>
              void mutate(
                {
                  action: "recordFollowUp",
                  caseId: item.id,
                  summary: followUpSummary,
                  nextStatus: followUpStatus,
                  nextDate: followUpNextDate || undefined,
                  quoteDueDate: quoteDueDate || undefined,
                  quoteOwnerName: quoteOwnerName || undefined,
                  plannedInstallDate: installDate || undefined,
                },
                "Relance enregistrée dans l'historique commercial.",
              )
            }
          >
            <Send size={14} /> Enregistrer la relance
          </button>
        </div>
      ) : null}
    </section>
  );
}

function QuoteNotesSection({
  item,
  busy,
  canModify,
  mutate,
}: {
  item: CommercialCase;
  busy: boolean;
  canModify: boolean;
  mutate: (body: MutationBody, successMessage: string) => Promise<CommercialSnapshot | null>;
}) {
  const [notes, setNotes] = useState(item.quoteNotes);
  return (
    <section className="commercialSection">
      <div className="commercialSectionTitle">
        <FileText size={15} /> Notes internes de chiffrage
      </div>
      <p className="commercialHint">
        Zone libre interne à PAPOT. Elle n&apos;est jamais envoyée automatiquement au client.
      </p>
      <textarea
        className="commercialNotes"
        rows={8}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        disabled={!canModify}
        placeholder="Ex. Ligne 1.2 : vérifier quincaillerie, hypothèse de pose…"
      />
      {canModify ? (
        <button
          type="button"
          className="secondaryButton commercialFitButton"
          disabled={busy}
          onClick={() =>
            void mutate(
              { action: "updateNotes", caseId: item.id, quoteNotes: notes },
              "Notes de chiffrage enregistrées.",
            )
          }
        >
          <Save size={13} /> Enregistrer les notes
        </button>
      ) : null}
    </section>
  );
}

function DocumentsSection({
  item,
  busy,
  canModify,
  uploadDocuments,
}: {
  item: CommercialCase;
  busy: boolean;
  canModify: boolean;
  uploadDocuments: ReturnType<typeof useCommercialData>["uploadDocuments"];
}) {
  const [category, setCategory] = useState<CommercialDocumentCategory>("RECEIVED");
  const [versionLabel, setVersionLabel] = useState("");
  const [variantLabel, setVariantLabel] = useState("");
  const [isCurrent, setIsCurrent] = useState(true);
  const [isSignedQuote, setIsSignedQuote] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const grouped = Object.keys(COMMERCIAL_DOCUMENT_CATEGORY_LABELS).map((key) => {
    const typed = key as CommercialDocumentCategory;
    return {
      category: typed,
      documents: item.documents.filter((document) => document.category === typed),
    };
  });

  async function submit() {
    const result = await uploadDocuments(item.id, files, {
      category,
      versionLabel,
      variantLabel,
      isCurrent,
      isSignedQuote,
    });
    if (result) {
      setFiles([]);
      setVersionLabel("");
      setVariantLabel("");
      setIsSignedQuote(false);
    }
  }

  return (
    <section className="commercialSection">
      <div className="commercialSectionTitle">
        <Paperclip size={15} /> Documents / Chiffrage{" "}
        <span className="commercialCountPill">{item.documents.length}</span>
      </div>
      <p className="commercialHint">
        Les originaux sont classés automatiquement par affaire et catégorie.
      </p>

      <div className="commercialDocumentGroups">
        {grouped.map((group) => (
          <div className="commercialDocumentGroup" key={group.category}>
            <div className="commercialDocumentGroupTitle">
              <strong>{COMMERCIAL_DOCUMENT_CATEGORY_LABELS[group.category]}</strong>
              <span>{group.documents.length}</span>
            </div>
            {group.documents.length === 0 ? (
              <small>Aucun document</small>
            ) : (
              group.documents.map((document) => (
                <CommercialDocumentRow key={document.id} item={item} document={document} />
              ))
            )}
          </div>
        ))}
      </div>

      {canModify ? (
        <div className="commercialUploadBox">
          <div className="commercialUploadFields">
            <Field label="Catégorie">
              <select
                value={category}
                onChange={(event) => {
                  const next = event.target.value as CommercialDocumentCategory;
                  setCategory(next);
                  if (next !== "QUOTE") setIsSignedQuote(false);
                }}
              >
                {Object.entries(COMMERCIAL_DOCUMENT_CATEGORY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Version (facultatif)">
              <input
                value={versionLabel}
                onChange={(event) => setVersionLabel(event.target.value)}
                placeholder="V2"
              />
            </Field>
            <Field label="Variante (facultatif)">
              <input
                value={variantLabel}
                onChange={(event) => setVariantLabel(event.target.value)}
                placeholder="Variante A"
              />
            </Field>
          </div>
          <div className="commercialUploadChecks">
            <label>
              <input
                type="checkbox"
                checked={isCurrent}
                onChange={(event) => setIsCurrent(event.target.checked)}
              />{" "}
              Version actuelle
            </label>
            {category === "QUOTE" ? (
              <label>
                <input
                  type="checkbox"
                  checked={isSignedQuote}
                  onChange={(event) => setIsSignedQuote(event.target.checked)}
                />{" "}
                Devis signé
              </label>
            ) : null}
          </div>
          <input
            ref={inputRef}
            hidden
            type="file"
            multiple
            disabled={busy}
            onChange={(event) => {
              setFiles(Array.from(event.target.files ?? []).slice(0, 12));
              event.currentTarget.value = "";
            }}
          />
          <div className="commercialUploadActions">
            <button
              type="button"
              className="secondaryButton"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <Paperclip size={13} /> Choisir des fichiers
            </button>
            {files.length > 0 ? (
              <button
                type="button"
                className="primaryButton"
                disabled={busy}
                onClick={() => void submit()}
              >
                <Upload size={13} /> Envoyer {files.length}
              </button>
            ) : null}
          </div>
          {files.length > 0 ? (
            <div className="commercialSelectedFiles">
              {files.map((file, index) => (
                <span key={`${file.name}-${file.size}-${index}`}>
                  {file.name}
                  <button
                    type="button"
                    onClick={() =>
                      setFiles((current) =>
                        current.filter((_, currentIndex) => currentIndex !== index),
                      )
                    }
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function CommercialDocumentRow({
  item,
  document,
}: {
  item: CommercialCase;
  document: CommercialDocument;
}) {
  const [preview, setPreview] = useState(false);
  const image = document.contentType.startsWith("image/");
  const pdf = document.contentType === "application/pdf";
  const Icon = image ? ImageIcon : FileText;
  const url = documentHref(item, document);
  return (
    <div className="commercialDocumentRow">
      <span className="commercialDocumentIcon">
        <Icon size={16} />
      </span>
      <div className="commercialDocumentMeta">
        <strong>{document.fileName}</strong>
        <span>
          {formatBytes(document.sizeBytes)} · {document.uploadedByName} ·{" "}
          {formatDateTime(document.uploadedAt)}
        </span>
        <div>
          {document.isCurrent ? <em>Actuel</em> : null}
          {document.isSignedQuote ? <em>Signé</em> : null}
          {document.variantLabel ? <em>{document.variantLabel}</em> : null}
          {document.versionLabel ? <em>{document.versionLabel}</em> : null}
        </div>
      </div>
      <div className="commercialDocumentActions">
        {image || pdf ? (
          <button
            type="button"
            className="secondaryButton"
            onClick={() => setPreview((value) => !value)}
          >
            <Eye size={13} /> {preview ? "Fermer" : "Aperçu"}
          </button>
        ) : null}
        <a
          className="secondaryButton"
          href={documentHref(item, document, true)}
          download={document.fileName}
        >
          <Download size={13} /> Télécharger
        </a>
      </div>
      {preview ? (
        <div className="commercialDocumentPreview">
          {image ? (
            <img src={url} alt={document.fileName} />
          ) : (
            <iframe src={url} title={document.fileName} />
          )}
        </div>
      ) : null}
    </div>
  );
}

function ProvisionSection({
  item,
  busy,
  canProvision,
  mutate,
}: {
  item: CommercialCase;
  busy: boolean;
  canProvision: boolean;
  mutate: (body: MutationBody, successMessage: string) => Promise<CommercialSnapshot | null>;
}) {
  const [be, setBe] = useState(String(item.provisionHours.be));
  const [workshop, setWorkshop] = useState(String(item.provisionHours.workshop));
  const [install, setInstall] = useState(String(item.provisionHours.install));
  const readOnlyReason = isCommercialClosed(item)
    ? "La charge potentielle a été retirée lors de la clôture du dossier."
    : item.status === "CONFIRMED"
      ? "L'affaire est confirmée. Cette charge est conservée ici comme référence commerciale."
      : null;
  return (
    <section className="commercialSection">
      <div className="commercialSectionTitle">
        <CalendarClock size={15} /> Charge potentielle
      </div>
      <p className="commercialHint">
        {readOnlyReason ?? "Réservation prévisionnelle distincte d'une commande ferme."}
      </p>
      <div className="commercialThreeFields">
        <Field label="BE (h)">
          <input
            type="number"
            min="0"
            step="0.5"
            value={be}
            onChange={(event) => setBe(event.target.value)}
            disabled={!canProvision}
          />
        </Field>
        <Field label="Atelier (h)">
          <input
            type="number"
            min="0"
            step="0.5"
            value={workshop}
            onChange={(event) => setWorkshop(event.target.value)}
            disabled={!canProvision}
          />
        </Field>
        <Field label="Pose (h)">
          <input
            type="number"
            min="0"
            step="0.5"
            value={install}
            onChange={(event) => setInstall(event.target.value)}
            disabled={!canProvision}
          />
        </Field>
      </div>
      {canProvision ? (
        <button
          type="button"
          className="secondaryButton commercialFitButton"
          disabled={busy}
          onClick={() =>
            void mutate(
              {
                action: "updateProvision",
                caseId: item.id,
                be: Number(be || 0),
                workshop: Number(workshop || 0),
                install: Number(install || 0),
              },
              "Charge potentielle enregistrée.",
            )
          }
        >
          <Save size={13} /> Enregistrer la provision
        </button>
      ) : null}
    </section>
  );
}

function CloseSection({
  item,
  busy,
  canModify,
  mutate,
}: {
  item: CommercialCase;
  busy: boolean;
  canModify: boolean;
  mutate: (body: MutationBody, successMessage: string) => Promise<CommercialSnapshot | null>;
}) {
  const [reason, setReason] = useState("");
  if (!canModify || item.status === "CONFIRMED") return null;
  return (
    <details className="commercialCloseBox">
      <summary>
        <Archive size={14} /> Clôturer le dossier commercial
      </summary>
      <p>La clôture retire la charge potentielle mais conserve documents, notes et historique.</p>
      <Field label="Motif facultatif">
        <textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      <div className="commercialCloseActions">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void mutate(
              { action: "close", caseId: item.id, status: "LOST", reason },
              "Affaire classée Perdu.",
            )
          }
        >
          Perdu
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void mutate(
              { action: "close", caseId: item.id, status: "ABANDONED", reason },
              "Affaire classée Abandonné.",
            )
          }
        >
          Abandonné
        </button>
      </div>
    </details>
  );
}

function ClosedCommercialCase({
  item,
  busy,
  canModify,
  mutate,
}: {
  item: CommercialCase;
  busy: boolean;
  canModify: boolean;
  mutate: (body: MutationBody, successMessage: string) => Promise<CommercialSnapshot | null>;
}) {
  const [reviewDate, setReviewDate] = useState("");
  return (
    <section className="commercialSection commercialArchiveSummary">
      <div className="commercialSectionTitle">
        <Archive size={15} /> Dossier archivé
      </div>
      <p>
        Clôturé le {item.closedAt ? formatDateTime(item.closedAt) : ""}
        {item.closingReason ? ` · ${item.closingReason}` : ""}
      </p>
      <p>
        Les documents, notes et l&apos;historique sont conservés. La charge potentielle n&apos;est
        pas restaurée automatiquement.
      </p>
      {canModify ? (
        <div className="commercialInlineForm">
          <Field label="Nouvelle date de revue *">
            <input
              type="date"
              value={reviewDate}
              onChange={(event) => setReviewDate(event.target.value)}
            />
          </Field>
          <button
            type="button"
            className="primaryButton"
            disabled={busy || !reviewDate}
            onClick={() =>
              void mutate(
                { action: "reopen", caseId: item.id, reviewDate },
                "Dossier commercial rouvert en Piste.",
              )
            }
          >
            <RotateCcw size={14} /> Rouvrir
          </button>
        </div>
      ) : null}
    </section>
  );
}

function HistorySection({ item }: { item: CommercialCase }) {
  return (
    <section className="commercialHistory commercialHistoryTab">
      <div className="commercialSectionTitle">
        <History size={15} /> Historique
      </div>
      {[...item.history].reverse().map((event) => (
        <div className="commercialHistoryRow" key={event.id}>
          <span />
          <div>
            <strong>{event.summary}</strong>
            <small>
              {event.actorName} · {formatDateTime(event.at)}
            </small>
          </div>
        </div>
      ))}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="commercialField">
      <span>{label}</span>
      {children}
    </label>
  );
}

function CommercialStyles() {
  return (
    <style jsx global>{`
      .commercialWorkspace {
        display: grid;
        gap: 15px;
        width: 100%;
      }
      .commercialHeading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
      }
      .commercialHeading h1 {
        margin: 0 0 4px;
        font-size: 27px;
      }
      .commercialHeading p {
        margin: 0;
        color: var(--muted);
        font-size: 11px;
      }
      .commercialHeadingActions {
        display: flex;
        gap: 8px;
      }
      .commercialRefresh {
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
      .commercialMessage {
        padding: 10px 12px;
        border-radius: 9px;
        font-size: 11px;
      }
      .commercialError {
        border: 1px solid #efc4bc;
        background: #fff5f3;
        color: #a3493a;
      }
      .commercialSuccess {
        border: 1px solid #c4e4cf;
        background: #f1faf4;
        color: #347850;
      }
      .commercialCreate {
        padding: 14px;
        display: grid;
        grid-template-columns: minmax(220px, 1.4fr) repeat(3, minmax(150px, 0.7fr)) auto;
        gap: 10px;
        align-items: end;
        border: 1px solid #ded7ee;
        border-radius: 11px;
        background: white;
      }
      .commercialCreateTitle {
        grid-column: 1/-1;
        display: flex;
        justify-content: space-between;
      }
      .commercialCreateTitle > div {
        display: grid;
        gap: 2px;
      }
      .commercialCreateTitle strong {
        font-size: 13px;
      }
      .commercialCreateTitle span {
        color: #8b8692;
        font-size: 9px;
      }
      .commercialCreateTitle > button {
        border: 0;
        background: transparent;
      }
      .commercialCreate label {
        display: grid;
        gap: 4px;
      }
      .commercialCreate label > span,
      .commercialField > span {
        color: #5e5965;
        font-size: 9px;
        font-weight: 750;
      }
      .commercialCreate input,
      .commercialField input,
      .commercialField select,
      .commercialField textarea,
      .commercialNotes {
        width: 100%;
        padding: 9px 10px;
        border: 1px solid #ddd9e5;
        border-radius: 8px;
        background: white;
        color: var(--text);
        outline: none;
        font: inherit;
      }
      .commercialField textarea,
      .commercialNotes {
        resize: vertical;
      }
      .commercialCreate input:focus,
      .commercialField input:focus,
      .commercialField select:focus,
      .commercialField textarea:focus,
      .commercialNotes:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent);
      }
      .commercialSummary {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 9px;
      }
      .commercialSummary > div {
        min-height: 68px;
        padding: 11px 13px;
        display: grid;
        align-content: center;
        gap: 4px;
        border: 1px solid #e7e3ed;
        border-radius: 10px;
        background: white;
      }
      .commercialSummary strong {
        font-size: 20px;
        line-height: 1;
      }
      .commercialSummary span {
        color: #85808e;
        font-size: 9px;
        font-weight: 700;
      }
      .commercialSummary .is-alert strong {
        color: #b34e3d;
      }
      .commercialSummary .is-warning strong {
        color: #a76a1d;
      }
      .commercialSummary .is-success strong {
        color: #3c855a;
      }
      .commercialToolbar {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
      }
      .commercialModes {
        display: flex;
        gap: 5px;
      }
      .commercialModes button {
        min-height: 31px;
        padding: 0 10px;
        border: 1px solid #e0dce8;
        border-radius: 7px;
        background: white;
        color: #6c6675;
        font-size: 10px;
      }
      .commercialModes button.isActive {
        border-color: #9d8be7;
        background: #f1edff;
        color: #6551c7;
        font-weight: 800;
      }
      .commercialSearch {
        width: min(520px, 48vw);
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
      .commercialSearch input {
        min-width: 0;
        flex: 1;
        border: 0;
        outline: 0;
        font: inherit;
        font-size: 10px;
      }
      .commercialSearch button {
        padding: 0;
        border: 0;
        background: transparent;
        color: #8a8592;
      }
      .commercialLoading,
      .commercialNoSelection {
        min-height: 360px;
        display: grid;
        place-items: center;
        align-content: center;
        gap: 8px;
        border: 1px solid #e8e4ef;
        border-radius: 12px;
        background: white;
        color: #8a8592;
        font-size: 11px;
      }
      .commercialMasterDetail {
        min-height: 620px;
        display: grid;
        grid-template-columns: minmax(310px, 0.68fr) minmax(620px, 1.7fr);
        gap: 13px;
        align-items: start;
      }
      .commercialListPanel,
      .commercialDetailPanel {
        min-width: 0;
        max-height: calc(100vh - 270px);
        overflow: auto;
        border: 1px solid #e8e4ef;
        border-radius: 12px;
        background: white;
      }
      .commercialSearchHint {
        padding: 9px 11px;
        border-bottom: 1px solid #eeeaf3;
        background: #fbfaff;
        color: #81798d;
        font-size: 9px;
      }
      .commercialEmptyList {
        min-height: 250px;
        display: grid;
        place-items: center;
        align-content: center;
        gap: 7px;
        color: #9993a0;
        font-size: 10px;
      }
      .commercialListRow {
        width: 100%;
        padding: 12px 13px;
        display: grid;
        gap: 5px;
        border: 0;
        border-bottom: 1px solid #f0edf4;
        border-left: 3px solid transparent;
        background: white;
        text-align: left;
        color: inherit;
      }
      .commercialListRow:hover {
        background: #fbf9ff;
      }
      .commercialListRow.isSelected {
        border-left-color: #8065e7;
        background: #f7f4ff;
      }
      .commercialListRow.needsAction:not(.isSelected) {
        border-left-color: #d56a50;
      }
      .commercialListTop {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 5px;
      }
      .commercialListRow > strong {
        font-size: 12px;
      }
      .commercialListRow > span {
        overflow: hidden;
        color: #8a8592;
        font-size: 9px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .commercialListRow > small {
        min-height: 13px;
        display: flex;
        align-items: center;
        gap: 4px;
        color: #817b89;
        font-size: 8px;
      }
      .commercialStatus,
      .commercialAlertPill,
      .commercialCountPill {
        width: max-content;
        padding: 3px 6px;
        border-radius: 999px;
        font-size: 8px;
        font-weight: 800;
      }
      .commercialStatus-lead {
        background: #eee9ff;
        color: #6b56c7;
      }
      .commercialStatus-quote {
        background: #eaf2ff;
        color: #4471a4;
      }
      .commercialStatus-waiting {
        background: #f2f0f4;
        color: #716b79;
      }
      .commercialStatus-follow,
      .commercialAlertPill {
        background: #ffe9e4;
        color: #a94d3d;
      }
      .commercialStatus-likely {
        background: #fff0d8;
        color: #9e651d;
      }
      .commercialStatus-confirmed {
        background: #e9f7ee;
        color: #378058;
      }
      .commercialStatus-closed {
        background: #ece9ed;
        color: #706a74;
      }
      .commercialDetailContent {
        padding: 16px;
        display: grid;
        gap: 13px;
      }
      .commercialDetailHeader h2 {
        margin: 6px 0 3px;
        font-size: 21px;
      }
      .commercialDetailHeader p {
        margin: 0;
        color: #918c98;
        font-size: 9px;
      }
      .commercialSignedWarning {
        padding: 11px 12px;
        display: flex;
        gap: 9px;
        border: 1px solid #f0d59f;
        border-radius: 9px;
        background: #fffaee;
        color: #8b651e;
      }
      .commercialSignedWarning > div {
        display: grid;
        gap: 2px;
      }
      .commercialSignedWarning strong {
        font-size: 11px;
      }
      .commercialSignedWarning span {
        font-size: 9px;
      }
      .commercialDetailTabs {
        position: sticky;
        top: -16px;
        z-index: 5;
        padding: 6px;
        display: flex;
        gap: 5px;
        overflow-x: auto;
        border: 1px solid #e3deed;
        border-radius: 10px;
        background: rgba(250, 248, 255, 0.97);
        backdrop-filter: blur(8px);
        box-shadow: 0 4px 14px rgb(68 52 120 / 0.06);
      }
      .commercialDetailTabs button {
        min-height: 34px;
        padding: 0 10px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
        border: 1px solid transparent;
        border-radius: 8px;
        background: transparent;
        color: #706978;
        font-size: 9px;
        font-weight: 750;
      }
      .commercialDetailTabs button:hover {
        background: white;
        color: #5f51a1;
      }
      .commercialDetailTabs button.isActive {
        border-color: #a894ec;
        background: white;
        color: #6551c7;
        box-shadow: 0 2px 8px rgb(87 67 150 / 0.08);
      }
      .commercialDetailTabs button small {
        min-width: 18px;
        padding: 2px 5px;
        border-radius: 999px;
        background: #eeeaf6;
        color: #766c86;
        font-size: 7px;
        text-align: center;
      }
      .commercialDetailTabs button.isActive small {
        background: #eee9ff;
        color: #6551c7;
      }
      .commercialTabBody {
        display: grid;
        gap: 11px;
        min-height: 300px;
      }
      .commercialSection {
        padding: 13px;
        display: grid;
        gap: 10px;
        border: 1px solid #e9e5f0;
        border-radius: 10px;
      }
      .commercialSectionTitle {
        display: flex;
        align-items: center;
        gap: 7px;
        color: #514c59;
        font-size: 12px;
        font-weight: 800;
      }
      .commercialCountPill {
        background: #eeeaf6;
        color: #6c6478;
      }
      .commercialTwoFields {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .commercialThreeFields {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .commercialField {
        display: grid;
        gap: 4px;
      }
      .commercialField input:disabled,
      .commercialField textarea:disabled {
        background: #f7f6f8;
        color: #756f7b;
      }
      .commercialFitButton {
        width: max-content;
      }
      .commercialHint {
        margin: 0;
        color: #8d8794;
        font-size: 9px;
      }
      .commercialStatusEditor {
        display: flex;
        align-items: end;
        flex-wrap: wrap;
        gap: 8px;
      }
      .commercialStatusEditor .commercialField {
        min-width: 160px;
        flex: 1;
      }
      .commercialStatusSave {
        min-height: 36px;
      }
      .commercialInlineAlert {
        padding: 9px 10px;
        display: flex;
        align-items: center;
        gap: 7px;
        border-radius: 8px;
        background: #fff0ec;
        color: #a84d3b;
        font-size: 10px;
        font-weight: 700;
      }
      .commercialSubcard,
      .commercialDetailsBox {
        padding: 11px;
        display: grid;
        gap: 9px;
        border: 1px solid #eee9f4;
        border-radius: 9px;
        background: #fdfcff;
      }
      .commercialSubcard > strong {
        font-size: 10px;
      }
      .commercialInlineForm {
        display: flex;
        align-items: end;
        gap: 8px;
        flex-wrap: wrap;
      }
      .commercialInlineForm .commercialField {
        min-width: 170px;
        flex: 1;
      }
      .commercialDetailsBox summary,
      .commercialCloseBox summary {
        cursor: pointer;
        font-size: 10px;
        font-weight: 750;
      }
      .commercialFollowGrid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .commercialNotes {
        min-height: 180px;
      }
      .commercialDocumentGroups {
        display: grid;
        gap: 7px;
      }
      .commercialDocumentGroup {
        display: grid;
        gap: 6px;
      }
      .commercialDocumentGroupTitle {
        padding: 6px 8px;
        display: flex;
        justify-content: space-between;
        border-radius: 7px;
        background: #f7f5fa;
      }
      .commercialDocumentGroupTitle strong {
        font-size: 9px;
      }
      .commercialDocumentGroupTitle span,
      .commercialDocumentGroup > small {
        color: #918b98;
        font-size: 8px;
      }
      .commercialDocumentRow {
        padding: 8px 9px;
        display: grid;
        grid-template-columns: 32px minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        border: 1px solid #eeeaf3;
        border-radius: 8px;
        background: white;
      }
      .commercialDocumentIcon {
        width: 30px;
        height: 30px;
        display: grid;
        place-items: center;
        border-radius: 7px;
        background: #eee9ff;
        color: #6d59c8;
      }
      .commercialDocumentMeta {
        min-width: 0;
        display: grid;
        gap: 2px;
      }
      .commercialDocumentMeta > strong {
        overflow: hidden;
        font-size: 9px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .commercialDocumentMeta > span {
        color: #918c99;
        font-size: 7.5px;
      }
      .commercialDocumentMeta > div {
        display: flex;
        gap: 4px;
      }
      .commercialDocumentMeta em {
        padding: 2px 5px;
        border-radius: 999px;
        background: #f0edf7;
        color: #675d79;
        font-size: 7px;
        font-style: normal;
      }
      .commercialDocumentActions {
        display: flex;
        gap: 5px;
      }
      .commercialDocumentActions .secondaryButton {
        min-height: 29px;
        padding: 0 7px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 8px;
      }
      .commercialDocumentPreview {
        grid-column: 1/-1;
        max-height: 520px;
        overflow: auto;
        border: 1px solid #e5e0ec;
        border-radius: 7px;
        background: #f5f4f7;
      }
      .commercialDocumentPreview img {
        display: block;
        max-width: 100%;
        margin: auto;
      }
      .commercialDocumentPreview iframe {
        width: 100%;
        height: 480px;
        border: 0;
      }
      .commercialUploadBox {
        padding: 10px;
        display: grid;
        gap: 8px;
        border: 1px dashed #d7d0e6;
        border-radius: 8px;
        background: #fbfaff;
      }
      .commercialUploadFields {
        display: grid;
        grid-template-columns: 1.1fr 1fr 1fr;
        gap: 7px;
      }
      .commercialUploadChecks {
        display: flex;
        gap: 14px;
        color: #686172;
        font-size: 9px;
      }
      .commercialUploadChecks label {
        display: flex;
        align-items: center;
        gap: 5px;
      }
      .commercialUploadActions {
        display: flex;
        gap: 7px;
      }
      .commercialSelectedFiles {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }
      .commercialSelectedFiles > span {
        padding: 4px 6px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border-radius: 6px;
        background: #eee9ff;
        color: #6654bd;
        font-size: 8px;
      }
      .commercialSelectedFiles button {
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
      }
      .commercialCloseBox {
        padding: 11px;
        border: 1px solid #edd9d5;
        border-radius: 9px;
        background: #fffafa;
      }
      .commercialCloseBox summary {
        display: flex;
        align-items: center;
        gap: 6px;
        color: #9b5042;
      }
      .commercialCloseBox > p,
      .commercialArchiveSummary p {
        margin: 8px 0;
        color: #817b88;
        font-size: 9px;
      }
      .commercialCloseActions {
        display: flex;
        gap: 7px;
        margin-top: 8px;
      }
      .commercialCloseActions button {
        min-height: 32px;
        padding: 0 10px;
        border: 1px solid #e1c4bd;
        border-radius: 7px;
        background: white;
        color: #a24f41;
        font-size: 9px;
      }
      .commercialArchiveSummary {
        background: #fbfafc;
      }
      .commercialHistory {
        display: grid;
        gap: 7px;
        padding: 4px 2px;
      }
      .commercialHistoryTab {
        padding: 13px;
        border: 1px solid #e9e5f0;
        border-radius: 10px;
      }
      .commercialHistoryRow {
        display: grid;
        grid-template-columns: 9px minmax(0, 1fr);
        gap: 7px;
      }
      .commercialHistoryRow > span {
        width: 6px;
        height: 6px;
        margin-top: 5px;
        border-radius: 50%;
        background: #aa9bdd;
      }
      .commercialHistoryRow > div {
        display: grid;
        gap: 2px;
      }
      .commercialHistoryRow strong {
        font-size: 8.5px;
        font-weight: 650;
      }
      .commercialHistoryRow small {
        color: #98929e;
        font-size: 7.5px;
      }
      .commercialSpin {
        animation: commercialSpin 1s linear infinite;
      }
      @keyframes commercialSpin {
        to {
          transform: rotate(360deg);
        }
      }
      @media (max-width: 1200px) {
        .commercialMasterDetail {
          grid-template-columns: minmax(280px, 0.65fr) minmax(520px, 1.35fr);
        }
        .commercialCreate {
          grid-template-columns: 1fr 1fr;
        }
        .commercialCreateTitle {
          grid-column: 1/-1;
        }
        .commercialCreate .primaryButton {
          width: max-content;
        }
        .commercialDocumentActions {
          flex-direction: column;
        }
        .commercialDetailTabs {
          top: -16px;
        }
      }
      @media (max-width: 900px) {
        .commercialSummary {
          grid-template-columns: 1fr 1fr;
        }
        .commercialMasterDetail {
          grid-template-columns: 1fr;
        }
        .commercialListPanel,
        .commercialDetailPanel {
          max-height: none;
        }
        .commercialToolbar {
          align-items: stretch;
          flex-direction: column;
        }
        .commercialSearch {
          width: 100%;
        }
        .commercialDetailTabs {
          position: static;
        }
      }
      @media (max-width: 650px) {
        .commercialHeading {
          flex-direction: column;
        }
        .commercialSummary {
          grid-template-columns: 1fr 1fr;
        }
        .commercialTwoFields,
        .commercialThreeFields,
        .commercialFollowGrid,
        .commercialUploadFields {
          grid-template-columns: 1fr;
        }
        .commercialDocumentRow {
          grid-template-columns: 32px minmax(0, 1fr);
        }
        .commercialDocumentActions,
        .commercialDocumentPreview {
          grid-column: 1/-1;
        }
        .commercialCreate {
          grid-template-columns: 1fr;
        }
      }
    `}</style>
  );
}
