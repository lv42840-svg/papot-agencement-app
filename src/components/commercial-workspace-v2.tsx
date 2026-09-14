"use client";

import {
  Archive,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Download,
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
import { useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommercialAffairQuotes } from "@/components/commercial-affair-quotes";
import {
  COMMERCIAL_DOCUMENT_CATEGORY_LABELS,
  COMMERCIAL_STATUS_LABELS,
  commercialNeedsFollowUp,
  isCommercialClosed,
  nextCommercialDeadline,
  type CommercialCase,
  type CommercialClient,
  type CommercialDocumentCategory,
  type CommercialPayload,
  type CommercialSiteAddress,
  type CommercialStatus,
} from "@/lib/commercial/domain";

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
type Mode = "active" | "confirmed" | "archives";
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
  COMMERCIAL_SOURCE_TASK_ALREADY_LINKED: "Cette entrée est déjà rattachée à une affaire.",
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
  if (status === "CHIFFRAGE") return "quote";
  if (status === "LIKELY") return "likely";
  if (status === "CONFIRMED") return "confirmed";
  if (status === "LOST" || status === "ABANDONED") return "closed";
  if (status === "WAITING") return "waiting";
  return "lead";
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

export function CommercialWorkspaceV2() {
  const searchParams = useSearchParams();
  const focus = searchParams.get("focus");
  const { snapshot, loading, busy, error, notice, load, mutate, upload } = useCommercial();
  const [mode, setMode] = useState<Mode>("active");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(focus);
  const [createOpen, setCreateOpen] = useState(false);

  const clients = snapshot?.payload.clients ?? [];
  const cases = useMemo(() => snapshot?.payload.cases ?? [], [snapshot?.payload.cases]);
  const now = useMemo(() => new Date(snapshot?.serverNow ?? Date.now()), [snapshot?.serverNow]);
  const normalized = query.trim().toLocaleLowerCase("fr-FR");
  const visible = useMemo(() => {
    let list = cases;
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
    } else if (mode === "archives") {
      list = list.filter(isCommercialClosed);
    } else if (mode === "confirmed") {
      list = list.filter((item) => item.status === "CONFIRMED");
    } else {
      list = list.filter((item) => !isCommercialClosed(item) && item.status !== "CONFIRMED");
    }
    return list;
  }, [cases, mode, normalized]);

  const selected = cases.find((item) => item.id === selectedId) ?? visible[0] ?? null;
  useEffect(() => {
    if (focus && cases.some((item) => item.id === focus)) setSelectedId(focus);
    else if (!selectedId || !cases.some((item) => item.id === selectedId))
      setSelectedId(visible[0]?.id ?? null);
  }, [cases, focus, selectedId, visible]);

  const active = cases.filter(
    (item) => !isCommercialClosed(item) && item.status !== "CONFIRMED",
  ).length;
  const due = cases.filter(
    (item) => !isCommercialClosed(item) && commercialNeedsFollowUp(item, now),
  ).length;
  const confirmed = cases.filter((item) => item.status === "CONFIRMED").length;
  const archived = cases.filter(isCommercialClosed).length;

  return (
    <div className="commercialV2">
      <header className="commercialV2Heading">
        <div>
          <h1>Commercial · Affaires</h1>
          <p>
            Un client, une affaire, un suivi. Le chiffrage et le devis auront leur propre module.
          </p>
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
              setSelectedId(result.focusCaseId);
              setMode("active");
              setCreateOpen(false);
            }
          }}
        />
      ) : null}

      <section className="commercialV2Stats">
        <Stat icon={BriefcaseBusiness} label="Actives" value={active} />
        <Stat icon={Clock3} label="À suivre" value={due} alert={due > 0} />
        <Stat icon={CheckCircle2} label="Confirmées" value={confirmed} />
        <Stat icon={Archive} label="Archives" value={archived} />
      </section>

      <section className="commercialV2Toolbar">
        <div className="commercialV2Modes">
          <button className={mode === "active" ? "active" : ""} onClick={() => setMode("active")}>
            Actives
          </button>
          <button
            className={mode === "confirmed" ? "active" : ""}
            onClick={() => setMode("confirmed")}
          >
            Confirmées
          </button>
          <button
            className={mode === "archives" ? "active" : ""}
            onClick={() => setMode("archives")}
          >
            Archives
          </button>
        </div>
        <label className="commercialV2Search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher affaire, client, lieu…"
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
        <div className="commercialV2Grid">
          <aside className="commercialV2List">
            {visible.length ? (
              visible.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={selected?.id === item.id ? "selected" : ""}
                  onClick={() => setSelectedId(item.id)}
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
                </button>
              ))
            ) : (
              <div className="commercialV2Empty">
                <BriefcaseBusiness size={28} />
                Aucune affaire ici
              </div>
            )}
          </aside>

          <main className="commercialV2Detail">
            {selected && snapshot ? (
              <AffairDetail
                key={selected.id}
                item={selected}
                clients={clients}
                busy={busy}
                canModify={snapshot.capabilities.canModify}
                mutate={mutate}
                upload={upload}
              />
            ) : (
              <div className="commercialV2Empty">
                <BriefcaseBusiness size={30} />
                Sélectionne une affaire
              </div>
            )}
          </main>
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
}: {
  icon: typeof BriefcaseBusiness;
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <article className={alert ? "alert" : ""}>
      <Icon size={18} />
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </article>
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
      siteLabel: String(form.get("siteLabel") ?? ""),
      siteAddressOverride: differentSiteAddress ? siteAddressFromForm(form) : null,
      reviewDate: String(form.get("reviewDate") ?? ""),
      description: String(form.get("description") ?? ""),
      nextAction: String(form.get("nextAction") ?? ""),
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
        <span>Lieu chantier</span>
        <input name="siteLabel" />
      </label>
      <SiteAddressFields
        different={differentSiteAddress}
        onDifferentChange={setDifferentSiteAddress}
        client={selectedClient}
        address={null}
        disabled={false}
      />
      <label>
        <span>Prochaine revue *</span>
        <input name="reviewDate" type="date" required />
      </label>
      <label className="wide">
        <span>Description</span>
        <textarea name="description" rows={2} />
      </label>
      <label className="wide">
        <span>Prochaine action</span>
        <input name="nextAction" />
      </label>
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
  mutate,
  upload,
}: {
  item: CommercialCase;
  clients: CommercialClient[];
  busy: boolean;
  canModify: boolean;
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
            {item.clientName || "Client à préciser"}
            {item.siteLabel ? ` · ${item.siteLabel}` : ""}
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
          <FollowForm item={item} busy={busy} canModify={canModify} mutate={mutate} />
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
        name: String(form.get("name") ?? ""),
        existingClientId: clientId || undefined,
        clientName: clientId ? "" : String(form.get("clientName") ?? ""),
        siteLabel: String(form.get("siteLabel") ?? ""),
        siteAddressOverride: differentSiteAddress ? siteAddressFromForm(form) : null,
        contactName: item.contactName ?? "",
        contactPhone: item.contactPhone ?? "",
        contactEmail: item.contactEmail ?? "",
        description: String(form.get("description") ?? ""),
        nextAction: String(form.get("nextAction") ?? ""),
      },
      "Affaire mise à jour.",
    );
  }
  return (
    <form className="commercialV2Form" onSubmit={(event) => void submit(event)}>
      <label>
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
        <label>
          <span>Nouveau client</span>
          <input name="clientName" defaultValue={item.clientName ?? ""} disabled={!canModify} />
        </label>
      ) : null}
      <label>
        <span>Nom affaire</span>
        <input name="name" defaultValue={item.name} disabled={!canModify} required />
      </label>
      <label>
        <span>Lieu chantier</span>
        <input name="siteLabel" defaultValue={item.siteLabel ?? ""} disabled={!canModify} />
      </label>
      <SiteAddressFields
        different={differentSiteAddress}
        onDifferentChange={setDifferentSiteAddress}
        client={selectedClient}
        address={item.siteAddressOverride}
        disabled={!canModify}
      />
      <label className="wide">
        <span>Description</span>
        <textarea
          name="description"
          rows={3}
          defaultValue={item.description ?? ""}
          disabled={!canModify}
        />
      </label>
      <label className="wide">
        <span>Prochaine action</span>
        <input name="nextAction" defaultValue={item.nextAction ?? ""} disabled={!canModify} />
      </label>
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
  mutate,
}: {
  item: CommercialCase;
  busy: boolean;
  canModify: boolean;
  mutate: (body: Mutation, success: string) => Promise<Snapshot | null>;
}) {
  const [status, setStatus] = useState<CommercialStatus>(item.status);
  const [date, setDate] = useState(nextCommercialDeadline(item) ?? item.plannedInstallDate ?? "");
  const open = !isCommercialClosed(item);
  const dateTitle =
    status === "LIKELY"
      ? "Confirmation prévue"
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
    await mutate(
      {
        action: "setStatus",
        caseId: item.id,
        status,
        reviewDate: ["PISTE", "WAITING", "CHIFFRAGE"].includes(status) ? date : undefined,
        expectedConfirmationDate: status === "LIKELY" ? date : undefined,
        plannedInstallDate: status === "CONFIRMED" ? date : undefined,
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
          <CalendarClock size={15} /> Statut et prochaine échéance
        </h3>
        <label>
          <span>Statut</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as CommercialStatus)}
            disabled={!canModify}
          >
            {Object.entries(COMMERCIAL_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {status !== "FOLLOW_UP" && status !== "LOST" && status !== "ABANDONED" ? (
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
        {status === "CHIFFRAGE" ? (
          <div className="commercialV2Info">
            Le détail du chiffrage n’est plus stocké ici. Le futur module Devis / Chiffrage prendra
            le relais.
          </div>
        ) : null}
      </section>
      <FollowUp item={item} busy={busy} canModify={canModify} mutate={mutate} />
    </div>
  );
}

function FollowUp({
  item,
  busy,
  canModify,
  mutate,
}: {
  item: CommercialCase;
  busy: boolean;
  canModify: boolean;
  mutate: (body: Mutation, success: string) => Promise<Snapshot | null>;
}) {
  const [summary, setSummary] = useState("");
  const [nextStatus, setNextStatus] = useState<CommercialStatus>("WAITING");
  const [nextDate, setNextDate] = useState("");
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
          {Object.entries(COMMERCIAL_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {nextStatus !== "FOLLOW_UP" && nextStatus !== "LOST" && nextStatus !== "ABANDONED" ? (
        <label>
          <span>Date suivante</span>
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
          onClick={() =>
            void mutate(
              {
                action: "recordFollowUp",
                caseId: item.id,
                summary,
                nextStatus,
                nextDate: nextDate || undefined,
                plannedInstallDate: nextStatus === "CONFIRMED" ? nextDate || undefined : undefined,
              },
              "Relance enregistrée.",
            )
          }
        >
          <Clock3 size={14} /> Enregistrer la relance
        </button>
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
  const [category, setCategory] = useState<CommercialDocumentCategory>("RECEIVED");
  return (
    <section className="commercialV2Section">
      <h3>
        <Paperclip size={15} /> Documents de l’affaire
      </h3>
      <p className="commercialV2Info">
        Nextcloud stocke les fichiers et les métadonnées de l’affaire. Les anciens devis et
        déboursés restent consultables comme documents historiques.
      </p>
      {canModify ? (
        <div className="commercialV2Upload">
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as CommercialDocumentCategory)}
          >
            {Object.entries(COMMERCIAL_DOCUMENT_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.currentTarget.value = "";
              void upload(item.id, files, category);
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
      ) : null}
      <div className="commercialV2Docs">
        {item.documents.length ? (
          item.documents
            .slice()
            .reverse()
            .map((document) => (
              <article key={document.id}>
                <FileText size={18} />
                <div>
                  <strong>{document.fileName}</strong>
                  <span>
                    {COMMERCIAL_DOCUMENT_CATEGORY_LABELS[document.category]} ·{" "}
                    {bytes(document.sizeBytes)} · {dateTime(document.uploadedAt)}
                  </span>
                </div>
                <a
                  className="secondaryButton"
                  href={`/api/desktop/affaires/${item.id}/documents/${document.id}?download=1`}
                >
                  <Download size={13} /> Télécharger
                </a>
              </article>
            ))
        ) : (
          <div className="commercialV2Empty">
            <Paperclip size={24} />
            Aucun document
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
      .commercialV2Stats article {
        min-height: 72px;
        padding: 12px;
        display: flex;
        align-items: center;
        gap: 10px;
        border: 1px solid #e6e1ed;
        border-radius: 11px;
        background: white;
      }
      .commercialV2Stats article.alert {
        border-color: #efc7b3;
        background: #fff9f5;
      }
      .commercialV2Stats article div {
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
        justify-content: space-between;
        gap: 12px;
      }
      .commercialV2Modes {
        display: flex;
        padding: 3px;
        border: 1px solid #e1dce9;
        border-radius: 9px;
        background: #f8f6fb;
      }
      .commercialV2Modes button {
        padding: 7px 12px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: #746e7c;
        font-size: 10px;
      }
      .commercialV2Modes button.active {
        background: white;
        color: #5f4cc7;
        box-shadow: 0 1px 5px rgb(60 45 95 / 0.1);
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
      .commercialV2Grid {
        min-height: 520px;
        display: grid;
        grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
        border: 1px solid #e3deea;
        border-radius: 12px;
        overflow: hidden;
        background: white;
      }
      .commercialV2List {
        border-right: 1px solid #e8e3ed;
        background: #fbfaff;
        overflow: auto;
      }
      .commercialV2List > button {
        width: 100%;
        padding: 12px;
        display: grid;
        gap: 8px;
        border: 0;
        border-bottom: 1px solid #eeeaf2;
        background: transparent;
        text-align: left;
      }
      .commercialV2List > button.selected {
        background: #f1edff;
        box-shadow: inset 3px 0 #7563d7;
      }
      .commercialV2List > button > div:first-child {
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
        background: #eaf4ff;
        color: #3d6f9d;
      }
      .commercialV2Detail {
        min-width: 0;
        overflow: auto;
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
      .commercialV2Upload select {
        width: 260px;
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
      .commercialV2Docs article > div {
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
      .commercialV2Docs a {
        min-height: 30px;
        font-size: 8px;
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
      @media (max-width: 900px) {
        .commercialV2Stats {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .commercialV2Grid {
          grid-template-columns: 1fr;
        }
        .commercialV2List {
          max-height: 260px;
          border-right: 0;
          border-bottom: 1px solid #e8e3ed;
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
      }
    `}</style>
  );
}
