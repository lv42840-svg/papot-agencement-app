"use client";

import Link from "next/link";
import {
  Archive,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  History,
  Paperclip,
  Plus,
  RefreshCw,
  Save,
  Search,
  Upload,
  Users,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommercialAffairQuotes } from "@/components/commercial-affair-quotes";
import { CommercialConfirmationDialog } from "@/components/commercial-confirmation-dialog";
import {
  CommercialDocumentActions,
  CommercialOpenFolderButton,
} from "@/components/commercial-open-folder-button";
import { clientWorkspaceHref } from "@/lib/clients/navigation";
import { collectDroppedFiles } from "@/lib/commercial/document-drop";
import {
  filterCommercialDocuments,
  type CommercialDocumentFilter,
} from "@/lib/commercial/document-filter";
import {
  COMMERCIAL_DOCUMENT_CATEGORY_LABELS,
  COMMERCIAL_FOLLOW_STATUS_OPTIONS,
  COMMERCIAL_STATUS_LABELS,
  isCommercialClosed,
  nextCommercialDeadline,
  type CommercialCase,
  type CommercialClient,
  type CommercialDocumentCategory,
  type CommercialPayload,
  type CommercialSiteAddress,
  type CommercialStatus,
} from "@/lib/commercial/domain";
import { filterCommercialCases, type CommercialListFilter } from "@/lib/commercial/list-filter";
import { commercialAffairHref } from "@/lib/commercial/navigation";

type Snapshot = {
  payload: CommercialPayload;
  actor: { userId: string; displayName: string };
  capabilities: { canCreate: boolean; canRead: boolean; canModify: boolean; canConfirm: boolean };
  activeUsers: Array<{ id: string; displayName: string }>;
  focusCaseId?: string;
  serverNow: string;
  error?: string;
};

type Mutation = Record<string, unknown> & { action: string };
type DetailTab = "affair" | "follow" | "documents" | "history";

const errors: Record<string, string> = {
  COMMERCIAL_REQUEST_INVALID: "Certains champs sont invalides.",
  COMMERCIAL_CASE_NOT_FOUND: "Cette affaire n’existe plus.",
  COMMERCIAL_CLIENT_NOT_FOUND: "Ce client n’existe plus.",
  COMMERCIAL_CLIENT_REQUIRED: "Choisis ou crée un client avant de continuer.",
  COMMERCIAL_CLIENT_INCOMPLETE:
    "Le devis est validé : complète la fiche client (identité, adresse, code postal, ville, conditions de règlement et SIRET si professionnel) avant de confirmer l’affaire.",
  CLIENTS_LOCKED:
    "Le fichier clients est modifié sur un autre poste. Réessaie dans quelques secondes.",
  CLIENTS_VERSION_CONFLICT: "Le fichier clients a changé sur un autre poste. Réessaie.",
  COMMERCIAL_CASE_CLOSED: "Cette affaire est clôturée. Rouvre-la avant modification.",
  COMMERCIAL_REVIEW_DATE_REQUIRED: "Une date de prochaine revue est obligatoire.",
  COMMERCIAL_CONFIRMATION_DATE_REQUIRED: "La date prévisionnelle de confirmation est obligatoire.",
  COMMERCIAL_INSTALL_DATE_REQUIRED: "La date prévisionnelle de pose est obligatoire.",
  COMMERCIAL_QUOTE_SELECTION_REQUIRED:
    "Sélectionne au moins un devis retenu avant de confirmer l’affaire.",
  COMMERCIAL_CONFIRM_WITHOUT_QUOTE_REQUIRED:
    "Confirme explicitement que cette affaire démarre sans devis retenu.",
  COMMERCIAL_RETAINED_QUOTE_INVALID:
    "Un devis sélectionné n’est pas un devis figé valide de cette affaire.",
  COMMERCIAL_RETAINED_QUOTE_DUPLICATE: "Un même devis a été sélectionné plusieurs fois.",
  COMMERCIAL_SOURCE_TASK_ALREADY_LINKED: "Cette entrée est déjà rattachée à une affaire.",
  COMMERCIAL_DOCUMENTS_REQUIRED: "Aucun fichier à ajouter.",
  COMMERCIAL_DOCUMENTS_TOO_MANY: "Tu peux ajouter jusqu’à 12 documents à la fois.",
  COMMERCIAL_DOCUMENT_TOO_LARGE: "Un document dépasse la limite de 100 Mo.",
  COMMERCIAL_DOCUMENT_NAME_REQUIRED: "Un document n’a pas de nom exploitable.",
  SERVER_FILE_ROOT_UNAVAILABLE:
    "Le stockage local des documents n’est pas disponible sur ce poste.",
  MODULE_FORBIDDEN: "Ton profil n’autorise pas cette action.",
};

function dateLabel(value: string | null): string {
  if (!value) return "Sans date";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day, 12));
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}

function bytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} Ko`;
  return `${(value / (1024 * 1024)).toFixed(1)} Mo`;
}

function statusTone(status: CommercialStatus): string {
  if (status === "FOLLOW_UP") return "follow";
  if (status === "SENT") return "sent";
  if (status === "CHIFFRAGE") return "quote";
  if (status === "LIKELY") return "likely";
  if (status === "CONFIRMED") return "confirmed";
  if (status === "LOST" || status === "ABANDONED") return "closed";
  if (status === "WAITING") return "waiting";
  return "lead";
}

function followStatusForUi(status: CommercialStatus): CommercialStatus {
  if (status === "CHIFFRAGE") return "PISTE";
  if (status === "LIKELY") return "WAITING";
  return status;
}

function siteAddressFromForm(form: FormData): CommercialSiteAddress {
  return {
    addressLine1: String(form.get("siteAddressLine1") ?? ""),
    addressLine2: String(form.get("siteAddressLine2") ?? ""),
    postalCode: String(form.get("sitePostalCode") ?? ""),
    city: String(form.get("siteCity") ?? ""),
  };
}

function clientAddressLabel(client: CommercialClient | undefined): string {
  if (!client) return "Adresse client à compléter dans la fiche Client.";
  const cityLine = [client.postalCode, client.city].filter(Boolean).join(" ");
  const parts = [client.addressLine1, client.addressLine2, cityLine].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Adresse client à compléter dans la fiche Client.";
}

function useCommercial() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/desktop/commercial", { cache: "no-store" });
      const body = (await response.json()) as Snapshot;
      if (!response.ok) throw new Error(body.error ?? "COMMERCIAL_LOAD_FAILED");
      setSnapshot(body);
    } catch (loadError) {
      const code = loadError instanceof Error ? loadError.message : "COMMERCIAL_LOAD_FAILED";
      setError(errors[code] ?? "Impossible de charger les affaires.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  const mutate = useCallback(async (mutation: Mutation, success: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/desktop/commercial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mutation),
      });
      const body = (await response.json()) as Snapshot;
      if (!response.ok) throw new Error(body.error ?? "COMMERCIAL_MUTATION_FAILED");
      setSnapshot(body);
      setNotice(success);
      return body;
    } catch (mutationError) {
      const code =
        mutationError instanceof Error ? mutationError.message : "COMMERCIAL_MUTATION_FAILED";
      setError(errors[code] ?? "L’action n’a pas pu être enregistrée.");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const upload = useCallback(
    async (caseId: string, files: File[], category: CommercialDocumentCategory) => {
      if (!files.length) return null;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const form = new FormData();
        files.forEach((file) => form.append("files", file));
        form.set("category", category);
        form.set("isCurrent", "1");
        form.set("isSignedQuote", "0");
        const response = await fetch(`/api/desktop/commercial/${caseId}/documents`, {
          method: "POST",
          body: form,
        });
        const body = (await response.json()) as Snapshot;
        if (!response.ok) throw new Error(body.error ?? "COMMERCIAL_DOCUMENT_UPLOAD_FAILED");
        setSnapshot(body);
        setNotice(
          `${files.length} document${files.length > 1 ? "s" : ""} ajouté${files.length > 1 ? "s" : ""}.`,
        );
        return body;
      } catch (uploadError) {
        const code =
          uploadError instanceof Error ? uploadError.message : "COMMERCIAL_DOCUMENT_UPLOAD_FAILED";
        setError(errors[code] ?? "Les documents n’ont pas pu être ajoutés.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { snapshot, loading, busy, error, notice, load, mutate, upload };
}

export function CommercialWorkspaceV2({ affairId }: { affairId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focus = searchParams.get("focus");
  const { snapshot, loading, busy, error, notice, load, mutate, upload } = useCommercial();
  const [mode, setMode] = useState<CommercialListFilter>("active");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const clients = snapshot?.payload.clients ?? [];
  const cases = useMemo(() => snapshot?.payload.cases ?? [], [snapshot?.payload.cases]);
  const now = useMemo(() => new Date(snapshot?.serverNow ?? Date.now()), [snapshot?.serverNow]);
  const normalized = query.trim().toLocaleLowerCase("fr-FR");
  const visible = useMemo(() => {
    let list = filterCommercialCases(cases, mode, now);
    if (normalized) {
      list = list.filter((item) =>
        [
          item.name,
          item.clientName,
          item.siteLabel,
          item.siteAddressOverride?.addressLine1,
          item.siteAddressOverride?.addressLine2,
          item.siteAddressOverride?.postalCode,
          item.siteAddressOverride?.city,
          item.contactName,
          item.description,
          item.nextAction,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase("fr-FR").includes(normalized)),
      );
    }
    return list;
  }, [cases, mode, normalized, now]);

  const selected = affairId ? (cases.find((item) => item.id === affairId) ?? null) : null;

  useEffect(() => {
    if (affairId || !focus || !cases.some((item) => item.id === focus)) return;
    router.replace(commercialAffairHref(focus));
  }, [affairId, cases, focus, router]);

  const active = filterCommercialCases(cases, "active", now).length;
  const due = filterCommercialCases(cases, "follow-up", now).length;
  const confirmed = filterCommercialCases(cases, "confirmed", now).length;
  const archived = filterCommercialCases(cases, "archives", now).length;

  if (affairId) {
    return (
      <div className="commercialV2 commercialV2AffairPage">
        <div className="commercialV2StandaloneTop">
          <Link href="/commercial" className="commercialV2Back">
            ← Toutes les affaires
          </Link>
          <button
            className="secondaryButton"
            type="button"
            onClick={() => void load()}
            disabled={busy}
          >
            <RefreshCw size={15} /> Actualiser
          </button>
        </div>

        {error ? <div className="commercialV2Message error">{error}</div> : null}
        {notice ? <div className="commercialV2Message success">{notice}</div> : null}

        {loading && !snapshot ? (
          <div className="commercialV2Loading">
            <RefreshCw size={18} /> Chargement…
          </div>
        ) : selected && snapshot ? (
          <main className="commercialV2Detail commercialV2DetailStandalone">
            <AffairDetail
              key={selected.id}
              item={selected}
              clients={clients}
              busy={busy}
              canModify={snapshot.capabilities.canModify}
              canConfirm={snapshot.capabilities.canConfirm}
              mutate={mutate}
              upload={upload}
            />
          </main>
        ) : (
          <div className="commercialV2Empty commercialV2MissingAffair">
            <BriefcaseBusiness size={30} />
            <strong>Affaire introuvable</strong>
            <Link href="/commercial">Retour à la liste</Link>
          </div>
        )}

        <CommercialV2Styles />
      </div>
    );
  }

  return (
    <div className="commercialV2">
      <header className="commercialV2Heading">
        <div>
          <h1>Commercial · Affaires</h1>
          <p>Un client, une affaire, un suivi. Le chiffrage et le devis ont leur propre module.</p>
        </div>
        <div className="commercialV2HeadingActions">
          {snapshot?.capabilities.canCreate ? (
            <button
              className="primaryButton"
              type="button"
              onClick={() => setCreateOpen((value) => !value)}
            >
              <Plus size={16} /> Nouvelle affaire
            </button>
          ) : null}
          <button
            className="secondaryButton"
            type="button"
            onClick={() => void load()}
            disabled={busy}
          >
            <RefreshCw size={15} /> Actualiser
          </button>
        </div>
      </header>

      {error ? <div className="commercialV2Message error">{error}</div> : null}
      {notice ? <div className="commercialV2Message success">{notice}</div> : null}

      {createOpen && snapshot ? (
        <CreateAffair
          clients={clients}
          busy={busy}
          onCancel={() => setCreateOpen(false)}
          onSubmit={async (body) => {
            const result = await mutate(body, "Affaire créée.");
            if (result?.focusCaseId) {
              setMode("active");
              setCreateOpen(false);
              router.push(commercialAffairHref(result.focusCaseId));
            }
          }}
        />
      ) : null}

      <section className="commercialV2Stats">
        <Stat
          icon={BriefcaseBusiness}
          label="Actives"
          value={active}
          selected={mode === "active"}
          onClick={() => setMode("active")}
        />
        <Stat
          icon={Clock3}
          label="À relancer"
          value={due}
          alert={due > 0}
          selected={mode === "follow-up"}
          onClick={() => setMode("follow-up")}
        />
        <Stat
          icon={CheckCircle2}
          label="Validées"
          value={confirmed}
          selected={mode === "confirmed"}
          onClick={() => setMode("confirmed")}
        />
        <Stat
          icon={Archive}
          label="Archives"
          value={archived}
          selected={mode === "archives"}
          onClick={() => setMode("archives")}
        />
      </section>

      <section className="commercialV2Toolbar">
        <label className="commercialV2Search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher affaire ou client…"
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")}>
              <X size={13} />
            </button>
          ) : null}
        </label>
      </section>

      {loading && !snapshot ? (
        <div className="commercialV2Loading">
          <RefreshCw size={18} /> Chargement…
        </div>
      ) : (
        <div className="commercialV2ListShell">
          <aside className="commercialV2List commercialV2ListFull">
            {visible.length ? (
              visible.map((item) => (
                <Link
                  key={item.id}
                  href={commercialAffairHref(item.id)}
                  className="commercialV2ListRow"
                >
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.clientName || "Client à préciser"}</span>
                  </div>
                  <div className="commercialV2ListMeta">
                    <span className={`commercialV2Badge ${statusTone(item.status)}`}>
                      {COMMERCIAL_STATUS_LABELS[item.status]}
                    </span>
                    <small>{dateLabel(nextCommercialDeadline(item))}</small>
                  </div>
                </Link>
              ))
            ) : (
              <div className="commercialV2Empty">
                <BriefcaseBusiness size={28} />
                Aucune affaire ici
              </div>
            )}
          </aside>
        </div>
      )}

      <CommercialV2Styles />
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  alert = false,
  selected,
  onClick,
}: {
  icon: typeof BriefcaseBusiness;
  label: string;
  value: number;
  alert?: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${alert ? "alert " : ""}${selected ? "active" : ""}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <Icon size={18} />
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </button>
  );
}

function CreateAffair({
  clients,
  busy,
  onCancel,
  onSubmit,
}: {
  clients: CommercialClient[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Mutation) => Promise<void>;
}) {
  const [clientMode, setClientMode] = useState<"existing" | "new">(
    clients.length ? "existing" : "new",
  );
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [differentSiteAddress, setDifferentSiteAddress] = useState(false);
  const selectedClient =
    clientMode === "existing" ? clients.find((client) => client.id === clientId) : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onSubmit({
      action: "create",
      name: String(form.get("name") ?? ""),
      existingClientId: clientMode === "existing" && clientId ? clientId : undefined,
      clientName: clientMode === "new" ? String(form.get("clientName") ?? "") : "",
      siteLabel: "",
      siteAddressOverride: differentSiteAddress ? siteAddressFromForm(form) : null,
      reviewDate: String(form.get("reviewDate") ?? ""),
      description: String(form.get("description") ?? ""),
      nextAction: "",
    });
  }
  return (
    <form className="commercialV2Create" onSubmit={(event) => void submit(event)}>
      <div className="commercialV2CreateTitle">
        <strong>Nouvelle affaire</strong>
        <button type="button" onClick={onCancel}>
          <X size={14} />
        </button>
      </div>
      <label>
        <span>Client</span>
        <select
          value={clientMode}
          onChange={(event) => setClientMode(event.target.value as "existing" | "new")}
        >
          <option value="existing" disabled={!clients.length}>
            Client existant
          </option>
          <option value="new">Nouveau client</option>
        </select>
      </label>
      {clientMode === "existing" ? (
        <label>
          <span>Fiche client *</span>
          <select value={clientId} onChange={(event) => setClientId(event.target.value)} required>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.displayName}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          <span>Nouveau client</span>
          <input name="clientName" placeholder="Nom du client" required />
        </label>
      )}
      <label>
        <span>Nom de l’affaire *</span>
        <input name="name" required placeholder="Ex. Dupont · Cuisine" />
      </label>
      <label>
        <span>Prochaine revue *</span>
        <input name="reviewDate" type="date" required />
      </label>
      <label className="wide">
        <span>Description</span>
        <textarea name="description" rows={2} />
      </label>
      <SiteAddressFields
        different={differentSiteAddress}
        onDifferentChange={setDifferentSiteAddress}
        client={selectedClient}
        address={null}
        disabled={false}
      />
      <div className="wide commercialV2FormActions">
        <button className="primaryButton" disabled={busy}>
          <Plus size={14} /> Créer
        </button>
        <button className="secondaryButton" type="button" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function SiteAddressFields({
  different,
  onDifferentChange,
  client,
  address,
  disabled,
}: {
  different: boolean;
  onDifferentChange: (value: boolean) => void;
  client: CommercialClient | undefined;
  address: CommercialSiteAddress | null;
  disabled: boolean;
}) {
  return (
    <div className="wide commercialV2SiteAddress">
      <div className="commercialV2ClientAddress">
        <span>Adresse utilisée par défaut</span>
        <strong>{clientAddressLabel(client)}</strong>
      </div>
      <label className="commercialV2Checkbox">
        <input
          type="checkbox"
          checked={different}
          onChange={(event) => onDifferentChange(event.target.checked)}
          disabled={disabled}
        />
        <span>Adresse de chantier différente de l’adresse du client</span>
      </label>
      <div className="commercialV2SiteAddressGrid" hidden={!different}>
        <label className="wide">
          <span>Adresse chantier</span>
          <input
            name="siteAddressLine1"
            defaultValue={address?.addressLine1 ?? ""}
            disabled={disabled || !different}
          />
        </label>
        <label className="wide">
          <span>Complément d’adresse</span>
          <input
            name="siteAddressLine2"
            defaultValue={address?.addressLine2 ?? ""}
            disabled={disabled || !different}
          />
        </label>
        <label>
          <span>Code postal</span>
          <input
            name="sitePostalCode"
            defaultValue={address?.postalCode ?? ""}
            disabled={disabled || !different}
          />
        </label>
        <label>
          <span>Ville</span>
          <input
            name="siteCity"
            defaultValue={address?.city ?? ""}
            disabled={disabled || !different}
          />
        </label>
      </div>
    </div>
  );
}

function AffairDetail({
  item,
  clients,
  busy,
  canModify,
  canConfirm,
  mutate,
  upload,
}: {
  item: CommercialCase;
  clients: CommercialClient[];
  busy: boolean;
  canModify: boolean;
  canConfirm: boolean;
  mutate: (body: Mutation, success: string) => Promise<Snapshot | null>;
  upload: (
    caseId: string,
    files: File[],
    category: CommercialDocumentCategory,
  ) => Promise<Snapshot | null>;
}) {
  const [tab, setTab] = useState<DetailTab>("affair");
  return (
    <div>
      <header className="commercialV2DetailHeader">
        <div>
          <span className={`commercialV2Badge ${statusTone(item.status)}`}>
            {COMMERCIAL_STATUS_LABELS[item.status]}
          </span>
          <h2>{item.name}</h2>
          <p>
            {item.clientId ? (
              <a
                className="commercialV2ClientLink"
                href={clientWorkspaceHref(item.clientId)}
                title="Ouvrir la fiche client"
              >
                {item.clientName || "Fiche client"} <ExternalLink size={11} />
              </a>
            ) : (
              item.clientName || "Client à préciser"
            )}
          </p>
        </div>
      </header>
      <nav className="commercialV2Tabs">
        <button className={tab === "affair" ? "active" : ""} onClick={() => setTab("affair")}>
          <Users size={14} /> Affaire
        </button>
        <button className={tab === "follow" ? "active" : ""} onClick={() => setTab("follow")}>
          <Clock3 size={14} /> Suivi
        </button>
        <button className={tab === "documents" ? "active" : ""} onClick={() => setTab("documents")}>
          <Paperclip size={14} /> Documents <small>{item.documents.length}</small>
        </button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
          <History size={14} /> Historique
        </button>
      </nav>
      <div className="commercialV2TabBody">
        {tab === "affair" ? (
          <AffairForm
            item={item}
            clients={clients}
            busy={busy}
            canModify={canModify}
            mutate={mutate}
          />
        ) : null}
        {tab === "follow" ? (
          <FollowForm
            item={item}
            busy={busy}
            canModify={canModify}
            canConfirm={canConfirm}
            mutate={mutate}
          />
        ) : null}
        {tab === "documents" ? (
          <Documents item={item} busy={busy} canModify={canModify} upload={upload} />
        ) : null}
        {tab === "history" ? <HistoryPanel item={item} /> : null}
      </div>
    </div>
  );
}

function AffairForm({
  item,
  clients,
  busy,
  canModify,
  mutate,
}: {
  item: CommercialCase;
  clients: CommercialClient[];
  busy: boolean;
  canModify: boolean;
  mutate: (body: Mutation, success: string) => Promise<Snapshot | null>;
}) {
  const [clientId, setClientId] = useState(item.clientId ?? "");
  const [differentSiteAddress, setDifferentSiteAddress] = useState(
    item.siteAddressOverride !== null,
  );
  const selectedClient = clients.find((client) => client.id === clientId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate(
      {
        action: "updateDetails",
        caseId: item.id,
        name: item.name,
        existingClientId: clientId || undefined,
        clientName: clientId ? "" : String(form.get("clientName") ?? ""),
        siteLabel: item.siteLabel ?? "",
        siteAddressOverride: differentSiteAddress ? siteAddressFromForm(form) : null,
        contactName: item.contactName ?? "",
        contactPhone: item.contactPhone ?? "",
        contactEmail: item.contactEmail ?? "",
        description: String(form.get("description") ?? ""),
        nextAction: item.nextAction ?? "",
      },
      "Affaire mise à jour.",
    );
  }
  return (
    <form className="commercialV2Form" onSubmit={(event) => void submit(event)}>
      <label className="wide">
        <span>Client</span>
        <select
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          disabled={!canModify}
        >
          <option value="">Nouveau / à préciser</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.displayName}
            </option>
          ))}
        </select>
      </label>
      {!clientId ? (
        <label className="wide">
          <span>Nouveau client</span>
          <input name="clientName" defaultValue={item.clientName ?? ""} disabled={!canModify} />
        </label>
      ) : null}
      <label className="wide">
        <span>Description</span>
        <textarea
          name="description"
          rows={3}
          defaultValue={item.description ?? ""}
          disabled={!canModify}
        />
      </label>
      <SiteAddressFields
        different={differentSiteAddress}
        onDifferentChange={setDifferentSiteAddress}
        client={selectedClient}
        address={item.siteAddressOverride}
        disabled={!canModify}
      />
      {canModify ? (
        <button className="primaryButton wide fit" disabled={busy}>
          <Save size={14} /> Enregistrer
        </button>
      ) : null}
    </form>
  );
}

function FollowForm({
  item,
  busy,
  canModify,
  canConfirm,
  mutate,
}: {
  item: CommercialCase;
  busy: boolean;
  canModify: boolean;
  canConfirm: boolean;
  mutate: (body: Mutation, success: string) => Promise<Snapshot | null>;
}) {
  const [status, setStatus] = useState<CommercialStatus>(followStatusForUi(item.status));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [date, setDate] = useState(nextCommercialDeadline(item) ?? item.plannedInstallDate ?? "");
  const open = !isCommercialClosed(item);
  const dateTitle =
    status === "SENT"
      ? "Date de relance"
      : status === "CONFIRMED"
        ? "Pose prévue"
        : status === "FOLLOW_UP"
          ? "Pas de date obligatoire"
          : "Prochaine revue";

  async function saveStatus() {
    if (status === "LOST" || status === "ABANDONED") {
      await mutate({ action: "close", caseId: item.id, status, reason: "" }, "Affaire clôturée.");
      return;
    }
    if (status === "CONFIRMED") {
      setConfirmOpen(true);
      return;
    }
    await mutate(
      {
        action: "setStatus",
        caseId: item.id,
        status,
        reviewDate: ["PISTE", "SENT", "WAITING"].includes(status) ? date : undefined,
      },
      "Suivi commercial mis à jour.",
    );
  }

  if (!open) {
    return (
      <section className="commercialV2Section">
        <h3>Affaire clôturée</h3>
        <p>{item.closingReason || "Sans motif saisi."}</p>
        {canModify ? (
          <button
            className="secondaryButton"
            onClick={() =>
              void mutate(
                {
                  action: "reopen",
                  caseId: item.id,
                  reviewDate: new Date().toISOString().slice(0, 10),
                },
                "Affaire rouverte.",
              )
            }
          >
            Rouvrir
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <div className="commercialV2FollowGrid">
      <CommercialAffairQuotes item={item} />
      <section className="commercialV2Section">
        <h3>
          <CalendarClock size={15} /> Suivi global
        </h3>
        <label>
          <span>Statut</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as CommercialStatus)}
            disabled={!canModify}
          >
            {COMMERCIAL_FOLLOW_STATUS_OPTIONS.map((value) => (
              <option key={value} value={value} disabled={value === "CONFIRMED" && !canConfirm}>
                {COMMERCIAL_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        {status !== "FOLLOW_UP" ? (
          <label>
            <span>{dateTitle}</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={!canModify}
            />
          </label>
        ) : null}
        {canModify ? (
          <button
            className="primaryButton fit"
            type="button"
            disabled={busy}
            onClick={() => void saveStatus()}
          >
            <Save size={14} /> Enregistrer
          </button>
        ) : null}
      </section>
      <FollowUp
        item={item}
        busy={busy}
        canModify={canModify}
        canConfirm={canConfirm}
        mutate={mutate}
      />
      {confirmOpen ? (
        <CommercialConfirmationDialog
          item={item}
          plannedInstallDate={date}
          busy={busy}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={async (retainedQuoteIds, confirmWithoutQuote) => {
            const result = await mutate(
              {
                action: "setStatus",
                caseId: item.id,
                status: "CONFIRMED",
                plannedInstallDate: date,
                retainedQuoteIds,
                confirmWithoutQuote,
              },
              "Affaire confirmée avec les devis retenus.",
            );
            if (result) setConfirmOpen(false);
            return !!result;
          }}
        />
      ) : null}
    </div>
  );
}

function FollowUp({
  item,
  busy,
  canModify,
  canConfirm,
  mutate,
}: {
  item: CommercialCase;
  busy: boolean;
  canModify: boolean;
  canConfirm: boolean;
  mutate: (body: Mutation, success: string) => Promise<Snapshot | null>;
}) {
  const [summary, setSummary] = useState("");
  const [nextStatus, setNextStatus] = useState<CommercialStatus>("WAITING");
  const [nextDate, setNextDate] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function saveFollowUp() {
    if (nextStatus === "CONFIRMED") {
      setConfirmOpen(true);
      return;
    }
    await mutate(
      {
        action: "recordFollowUp",
        caseId: item.id,
        summary,
        nextStatus,
        nextDate: nextDate || undefined,
      },
      "Relance enregistrée.",
    );
  }

  return (
    <section className="commercialV2Section">
      <h3>
        <Clock3 size={15} /> Noter une relance
      </h3>
      <label>
        <span>Compte rendu</span>
        <textarea
          rows={3}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          disabled={!canModify}
        />
      </label>
      <label>
        <span>Suite</span>
        <select
          value={nextStatus}
          onChange={(event) => setNextStatus(event.target.value as CommercialStatus)}
          disabled={!canModify}
        >
          {COMMERCIAL_FOLLOW_STATUS_OPTIONS.map((value) => (
            <option key={value} value={value} disabled={value === "CONFIRMED" && !canConfirm}>
              {COMMERCIAL_STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      {nextStatus !== "FOLLOW_UP" ? (
        <label>
          <span>{nextStatus === "SENT" ? "Date de relance" : "Date suivante"}</span>
          <input
            type="date"
            value={nextDate}
            onChange={(event) => setNextDate(event.target.value)}
            disabled={!canModify}
          />
        </label>
      ) : null}
      {canModify ? (
        <button
          className="secondaryButton fit"
          disabled={busy || !summary.trim()}
          onClick={() => void saveFollowUp()}
        >
          <Clock3 size={14} /> Enregistrer la relance
        </button>
      ) : null}
      {confirmOpen ? (
        <CommercialConfirmationDialog
          item={item}
          plannedInstallDate={nextDate}
          busy={busy}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={async (retainedQuoteIds, confirmWithoutQuote) => {
            const result = await mutate(
              {
                action: "recordFollowUp",
                caseId: item.id,
                summary,
                nextStatus: "CONFIRMED",
                plannedInstallDate: nextDate,
                retainedQuoteIds,
                confirmWithoutQuote,
              },
              "Relance enregistrée et affaire confirmée.",
            );
            if (result) setConfirmOpen(false);
            return !!result;
          }}
        />
      ) : null}
    </section>
  );
}

function Documents({
  item,
  busy,
  canModify,
  upload,
}: {
  item: CommercialCase;
  busy: boolean;
  canModify: boolean;
  upload: (
    caseId: string,
    files: File[],
    category: CommercialDocumentCategory,
  ) => Promise<Snapshot | null>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [category, setCategory] = useState<CommercialDocumentCategory>("RECEIVED");
  const [filter, setFilter] = useState<CommercialDocumentFilter>("ALL");
  const [dragging, setDragging] = useState(false);
  const [previewDocumentId, setPreviewDocumentId] = useState<string | null>(null);
  const categoryLabel = COMMERCIAL_DOCUMENT_CATEGORY_LABELS[category];
  const visibleDocuments = filterCommercialDocuments(item.documents, filter).reverse();

  function uploadFiles(files: File[]) {
    if (busy || files.length === 0) return;
    void upload(item.id, files, category);
  }

  function togglePreview(documentId: string) {
    setPreviewDocumentId((current) => (current === documentId ? null : documentId));
  }

  return (
    <section className="commercialV2Section">
      <h3>
        <Paperclip size={15} /> Documents de l’affaire
      </h3>
      <p className="commercialV2Info">
        Choisis la catégorie puis glisse les fichiers ici ou utilise Ajouter. PAPOT les classe
        automatiquement dans le dossier de l’affaire.
      </p>
      <CommercialOpenFolderButton
        caseId={item.id}
        createdAt={item.createdAt}
        hasDocuments={item.documents.length > 0}
      />
      {canModify ? (
        <>
          <div className="commercialV2Upload">
            <label className="commercialV2UploadCategory">
              <span>Classer dans</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as CommercialDocumentCategory)}
                disabled={busy}
              >
                {Object.entries(COMMERCIAL_DOCUMENT_CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.currentTarget.value = "";
                uploadFiles(files);
              }}
            />
            <button
              className="secondaryButton"
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <Upload size={14} /> Ajouter
            </button>
          </div>
          <div
            className={`commercialV2DropZone${dragging ? " dragging" : ""}${busy ? " busy" : ""}`}
            aria-label={`Déposer des documents dans ${categoryLabel}`}
            aria-disabled={busy}
            onDragEnter={(event) => {
              if (busy || !Array.from(event.dataTransfer.types).includes("Files")) return;
              event.preventDefault();
              dragDepth.current += 1;
              setDragging(true);
            }}
            onDragOver={(event) => {
              if (busy || !Array.from(event.dataTransfer.types).includes("Files")) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDragLeave={(event) => {
              if (!dragging) return;
              event.preventDefault();
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              if (busy) return;
              uploadFiles(collectDroppedFiles(event.dataTransfer.items, event.dataTransfer.files));
            }}
          >
            <Upload size={24} />
            <div>
              <strong>
                {dragging ? "Dépose les fichiers ici" : "Glisse-dépose tes fichiers ici"}
              </strong>
              <span>Classement automatique : {categoryLabel}</span>
            </div>
          </div>
        </>
      ) : null}
      <label className="commercialV2UploadCategory">
        <span>Afficher</span>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as CommercialDocumentFilter)}
        >
          <option value="ALL">Tous les documents ({item.documents.length})</option>
          {Object.entries(COMMERCIAL_DOCUMENT_CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="commercialV2Docs">
        {visibleDocuments.length ? (
          visibleDocuments.map((document) => {
            const previewOpen = previewDocumentId === document.id;
            return (
              <article key={document.id}>
                <FileText size={18} />
                <div className="commercialV2DocMeta">
                  <strong>{document.fileName}</strong>
                  <span>
                    {COMMERCIAL_DOCUMENT_CATEGORY_LABELS[document.category]} ·{" "}
                    {bytes(document.sizeBytes)} · {dateTime(document.uploadedAt)}
                  </span>
                </div>
                <CommercialDocumentActions
                  caseId={item.id}
                  document={document}
                  previewOpen={previewOpen}
                  onTogglePreview={() => togglePreview(document.id)}
                />
                {previewOpen ? (
                  <div className="commercialV2DocPreview">
                    <div className="commercialV2DocPreviewFrame">
                      <iframe
                        src={`/api/desktop/affaires/${item.id}/documents/${document.id}`}
                        title={`Aperçu de ${document.fileName}`}
                      />
                    </div>
                    <small>↕ Tire le bord inférieur pour régler la hauteur de l’aperçu.</small>
                  </div>
                ) : null}
              </article>
            );
          })
        ) : (
          <div className="commercialV2Empty">
            <Paperclip size={24} />
            {item.documents.length ? "Aucun document pour ce type" : "Aucun document"}
          </div>
        )}
      </div>
    </section>
  );
}

function HistoryPanel({ item }: { item: CommercialCase }) {
  return (
    <section className="commercialV2Section">
      <h3>
        <History size={15} /> Historique
      </h3>
      <div className="commercialV2History">
        {item.history
          .slice()
          .reverse()
          .map((event) => (
            <article key={event.id}>
              <time>{dateTime(event.at)}</time>
              <div>
                <strong>{event.actorName}</strong>
                <p>{event.summary}</p>
              </div>
            </article>
          ))}
      </div>
    </section>
  );
}

function CommercialV2Styles() {
  return (
    <style jsx global>{`
      .commercialV2 {
        display: grid;
        gap: 14px;
      }
      .commercialV2Heading {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 18px;
      }
      .commercialV2Heading h1 {
        margin: 0;
        font-size: 24px;
      }
      .commercialV2Heading p {
        margin: 4px 0 0;
        color: #80798d;
        font-size: 11px;
      }
      .commercialV2HeadingActions,
      .commercialV2FormActions,
      .commercialV2Upload {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .commercialV2StandaloneTop {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .commercialV2Back {
        width: max-content;
        color: #604dc4;
        font-size: 10px;
        font-weight: 800;
        text-decoration: none;
      }
      .commercialV2Back:hover,
      .commercialV2Back:focus-visible {
        text-decoration: underline;
      }
      .commercialV2Message {
        padding: 9px 12px;
        border-radius: 9px;
        font-size: 10px;
      }
      .commercialV2Message.error {
        background: #fff1ef;
        border: 1px solid #efc6bf;
        color: #9d4438;
      }
      .commercialV2Message.success {
        background: #f1fbf5;
        border: 1px solid #c7e8d2;
        color: #2e7650;
      }
      .commercialV2Stats {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 9px;
      }
      .commercialV2Stats > button {
        min-height: 72px;
        padding: 12px;
        display: flex;
        align-items: center;
        gap: 10px;
        border: 1px solid #e6e1ed;
        border-radius: 11px;
        background: white;
        color: inherit;
        text-align: left;
      }
      .commercialV2Stats > button:hover,
      .commercialV2Stats > button:focus-visible {
        border-color: #cfc5ea;
        background: #faf8ff;
      }
      .commercialV2Stats > button.active {
        border-color: #8d7ce0;
        background: #f4f0ff;
        box-shadow: inset 0 0 0 1px #8d7ce0;
      }
      .commercialV2Stats > button.alert {
        border-color: #efc7b3;
        background: #fff9f5;
      }
      .commercialV2Stats > button.alert.active {
        border-color: #d98f69;
        box-shadow: inset 0 0 0 1px #d98f69;
      }
      .commercialV2Stats > button div {
        display: grid;
      }
      .commercialV2Stats strong {
        font-size: 20px;
      }
      .commercialV2Stats span {
        color: #81798b;
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .commercialV2Toolbar {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 12px;
      }
      .commercialV2Search {
        min-width: 300px;
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 0 9px;
        border: 1px solid #ded9e7;
        border-radius: 9px;
        background: white;
      }
      .commercialV2Search input {
        flex: 1;
        min-height: 34px;
        border: 0;
        outline: 0;
        font-size: 10px;
      }
      .commercialV2Search button {
        padding: 3px;
        border: 0;
        background: transparent;
      }
      .commercialV2ListShell,
      .commercialV2DetailStandalone {
        min-height: 520px;
        border: 1px solid #e3deea;
        border-radius: 12px;
        overflow: hidden;
        background: white;
      }
      .commercialV2List {
        background: #fbfaff;
        overflow: auto;
      }
      .commercialV2ListFull {
        min-height: 520px;
      }
      .commercialV2List > a {
        width: 100%;
        padding: 12px;
        display: grid;
        gap: 8px;
        border-bottom: 1px solid #eeeaf2;
        background: transparent;
        color: inherit;
        text-align: left;
        text-decoration: none;
      }
      .commercialV2List > a:hover,
      .commercialV2List > a:focus-visible {
        background: #f4f0ff;
        box-shadow: inset 3px 0 #7563d7;
        outline: none;
      }
      .commercialV2List > a > div:first-child {
        display: grid;
        gap: 2px;
      }
      .commercialV2List strong {
        font-size: 11px;
      }
      .commercialV2List span {
        color: #837b8b;
        font-size: 9px;
      }
      .commercialV2ListMeta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .commercialV2ListMeta small {
        color: #91899a;
        font-size: 8px;
      }
      .commercialV2Badge {
        width: max-content;
        padding: 3px 7px;
        border-radius: 999px;
        font-size: 8px;
        font-weight: 800;
      }
      .commercialV2Badge.lead {
        background: #ece8f7;
        color: #655d78;
      }
      .commercialV2Badge.quote {
        background: #f4eaff;
        color: #744ca2;
      }
      .commercialV2Badge.follow {
        background: #fff0e9;
        color: #a85c37;
      }
      .commercialV2Badge.sent {
        background: #eaf4ff;
        color: #3d6f9d;
      }
      .commercialV2Badge.likely {
        background: #fff7d9;
        color: #8c7125;
      }
      .commercialV2Badge.confirmed {
        background: #e9f8ef;
        color: #3c7955;
      }
      .commercialV2Badge.closed {
        background: #f0eef1;
        color: #77717c;
      }
      .commercialV2Badge.waiting {
        background: #f0eef8;
        color: #6d6680;
      }
      .commercialV2Detail {
        min-width: 0;
        overflow: auto;
      }
      .commercialV2DetailStandalone {
        width: 100%;
      }
      .commercialV2DetailHeader {
        padding: 18px 20px 13px;
        border-bottom: 1px solid #eeeaf2;
      }
      .commercialV2DetailHeader h2 {
        margin: 7px 0 2px;
        font-size: 19px;
      }
      .commercialV2DetailHeader p {
        margin: 0;
        color: #7f7886;
        font-size: 10px;
      }
      .commercialV2ClientLink {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        color: #604dc4;
        font-weight: 750;
        text-decoration: none;
      }
      .commercialV2ClientLink:hover,
      .commercialV2ClientLink:focus-visible {
        text-decoration: underline;
      }
      .commercialV2Tabs {
        display: flex;
        gap: 2px;
        padding: 7px 12px;
        border-bottom: 1px solid #eeeaf2;
        background: #fcfbfd;
      }
      .commercialV2Tabs button {
        padding: 7px 9px;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: #716b78;
        font-size: 9px;
      }
      .commercialV2Tabs button.active {
        background: #eee9ff;
        color: #604dc4;
      }
      .commercialV2Tabs small {
        padding: 1px 4px;
        border-radius: 6px;
        background: white;
      }
      .commercialV2TabBody {
        padding: 16px 20px 22px;
      }
      .commercialV2Form,
      .commercialV2Create {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }
      .commercialV2Create {
        padding: 14px;
        border: 1px solid #ddd5f1;
        border-radius: 11px;
        background: #fbf9ff;
      }
      .commercialV2CreateTitle {
        grid-column: 1/-1;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .commercialV2CreateTitle button {
        padding: 5px;
        border: 0;
        background: transparent;
      }
      .commercialV2Form label,
      .commercialV2Create label,
      .commercialV2Section label {
        display: grid;
        gap: 4px;
        color: #625d68;
        font-size: 9px;
        font-weight: 750;
      }
      .commercialV2Form input,
      .commercialV2Form select,
      .commercialV2Form textarea,
      .commercialV2Create input,
      .commercialV2Create select,
      .commercialV2Create textarea,
      .commercialV2Section input,
      .commercialV2Section select,
      .commercialV2Section textarea,
      .commercialV2Upload select {
        width: 100%;
        min-height: 35px;
        padding: 7px 9px;
        border: 1px solid #ddd8e5;
        border-radius: 8px;
        background: white;
        color: var(--text);
        font: inherit;
        outline: 0;
      }
      .commercialV2Form textarea,
      .commercialV2Create textarea,
      .commercialV2Section textarea {
        resize: vertical;
      }
      .commercialV2Form .wide,
      .commercialV2Create .wide {
        grid-column: 1/-1;
      }
      .commercialV2Form .fit,
      .commercialV2Section .fit {
        width: max-content;
      }
      .commercialV2SiteAddress {
        display: grid;
        gap: 9px;
        padding: 10px;
        border: 1px solid #e3deea;
        border-radius: 9px;
        background: #fcfbfe;
      }
      .commercialV2ClientAddress {
        display: grid;
        gap: 2px;
        color: #766f7d;
        font-size: 9px;
      }
      .commercialV2ClientAddress strong {
        color: #514b58;
        font-size: 10px;
      }
      .commercialV2Form .commercialV2Checkbox,
      .commercialV2Create .commercialV2Checkbox {
        display: flex;
        align-items: center;
        gap: 7px;
      }
      .commercialV2Form .commercialV2Checkbox input,
      .commercialV2Create .commercialV2Checkbox input {
        width: auto;
        min-height: 0;
        padding: 0;
      }
      .commercialV2SiteAddressGrid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 9px;
        padding-top: 2px;
      }
      .commercialV2SiteAddressGrid[hidden] {
        display: none;
      }
      .commercialV2FollowGrid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .commercialV2Section {
        display: grid;
        gap: 10px;
      }
      .commercialV2Section h3 {
        margin: 0;
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
      }
      .commercialV2Section p {
        margin: 0;
        font-size: 10px;
        color: #77717d;
      }
      .commercialV2Info {
        padding: 8px 10px;
        border: 1px solid #e1daf4;
        border-radius: 8px;
        background: #faf8ff;
        color: #74688b;
        font-size: 9px;
        line-height: 1.5;
      }
      .commercialV2Upload {
        align-items: end;
      }
      .commercialV2UploadCategory {
        width: 260px;
      }
      .commercialV2UploadCategory select {
        width: 100%;
      }
      .commercialV2DropZone {
        min-height: 108px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 18px;
        border: 1.5px dashed #cec5e8;
        border-radius: 11px;
        background: #fbf9ff;
        color: #756a8f;
        transition:
          border-color 120ms ease,
          background 120ms ease,
          transform 120ms ease;
      }
      .commercialV2DropZone.dragging {
        border-color: #7563d7;
        background: #f1edff;
        transform: scale(1.005);
      }
      .commercialV2DropZone.busy {
        opacity: 0.6;
      }
      .commercialV2DropZone > div {
        display: grid;
        gap: 3px;
      }
      .commercialV2DropZone strong {
        color: #514b63;
        font-size: 11px;
      }
      .commercialV2DropZone span {
        color: #867d99;
        font-size: 9px;
      }
      .commercialV2Docs {
        display: grid;
        gap: 6px;
      }
      .commercialV2Docs article {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 10px;
        padding: 9px;
        border: 1px solid #ece8f0;
        border-radius: 9px;
      }
      .commercialV2DocMeta {
        min-width: 0;
        display: grid;
        gap: 2px;
      }
      .commercialV2Docs strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 10px;
      }
      .commercialV2Docs span {
        color: #8b8490;
        font-size: 8px;
      }
      .commercialV2DocPreview {
        grid-column: 1 / -1;
        width: 100%;
        display: grid;
        overflow: hidden;
        border: 1px solid #ddd7e8;
        border-radius: 9px;
        background: white;
      }
      .commercialV2DocPreviewFrame {
        height: 460px;
        min-height: 220px;
        max-height: 900px;
        overflow: auto;
        resize: vertical;
        background: #ebe8ef;
      }
      .commercialV2DocPreview iframe {
        width: 100%;
        height: 100%;
        display: block;
        border: 0;
        background: white;
      }
      .commercialV2DocPreview > small {
        padding: 6px 10px;
        border-top: 1px solid #e2dce8;
        color: #81778e;
        font-size: 8px;
        text-align: center;
      }
      .commercialV2History {
        display: grid;
        gap: 0;
      }
      .commercialV2History article {
        display: grid;
        grid-template-columns: 120px 1fr;
        gap: 12px;
        padding: 9px 0;
        border-bottom: 1px solid #eeeaf2;
      }
      .commercialV2History time {
        color: #948c99;
        font-size: 8px;
      }
      .commercialV2History strong {
        font-size: 9px;
      }
      .commercialV2History p {
        margin: 2px 0 0;
        color: #67616b;
        font-size: 9px;
      }
      .commercialV2Empty,
      .commercialV2Loading {
        min-height: 150px;
        display: grid;
        place-items: center;
        align-content: center;
        gap: 8px;
        color: #918a98;
        font-size: 10px;
      }
      .commercialV2MissingAffair {
        min-height: 420px;
        border: 1px solid #e3deea;
        border-radius: 12px;
        background: white;
      }
      .commercialV2MissingAffair a {
        color: #604dc4;
        font-weight: 800;
      }
      @media (max-width: 900px) {
        .commercialV2Stats {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .commercialV2FollowGrid,
        .commercialV2Form,
        .commercialV2Create,
        .commercialV2SiteAddressGrid {
          grid-template-columns: 1fr;
        }
        .commercialV2Form .wide,
        .commercialV2Create .wide,
        .commercialV2CreateTitle {
          grid-column: 1;
        }
        .commercialV2Toolbar,
        .commercialV2Heading {
          align-items: stretch;
          flex-direction: column;
        }
        .commercialV2Search {
          min-width: 0;
        }
        .commercialV2Upload {
          align-items: stretch;
          flex-direction: column;
        }
        .commercialV2UploadCategory {
          width: 100%;
        }
      }
      @media (max-width: 700px) {
        .commercialV2StandaloneTop {
          align-items: stretch;
          flex-direction: column;
        }
        .commercialV2Docs article {
          grid-template-columns: auto 1fr;
        }
        .commercialV2Docs article > :global(.commercialDocumentRowActions) {
          grid-column: 1 / -1;
        }
      }
    `}</style>
  );
}
