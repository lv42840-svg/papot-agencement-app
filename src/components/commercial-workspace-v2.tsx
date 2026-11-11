"use client";

import Link from "next/link";
import {
  Archive,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FilePlus2,
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
  capabilities: {
    canCreate: boolean;
    canRead: boolean;
    canModify: boolean;
    canProvision: boolean;
    canConfirm: boolean;
  };
  activeUsers: Array<{ id: string; displayName: string }>;
  focusCaseId?: string;
  serverNow: string;
  error?: string;
};

type Mutation = Record<string, unknown> & { action: string };
type DetailTab = "affair" | "follow" | "documents" | "history";

const erreurs: Record<string, string> = {
  COMMERCIAL_REQUEST_INVALID: "Certains champs sont invalides.",
  COMMERCIAL_CASE_NOT_FOUND: "Cette affaire n’existe plus.",
  COMMERCIAL_CLIENT_NOT_FOUND: "Ce client n’existe plus.",
  COMMERCIAL_CLIENT_REQUIRED: "Choisis ou crée un client avant de continuer.",
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

function dateLabel(valeur: string | null): string {
  if (!valeur) return "Sans date";
  const [annee, mois, jour] = valeur.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(annee, mois - 1, jour, 12));
}

function dateTime(valeur: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(valeur),
  );
}

function bytes(valeur: number): string {
  if (valeur < 1024 * 1024) return `${Math.max(1, Math.round(valeur / 1024))} Ko`;
  return `${(valeur / (1024 * 1024)).toFixed(1)} Mo`;
}

function statusTone(statut: CommercialStatus): string {
  if (statut === "FOLLOW_UP") return "follow";
  if (statut === "SENT") return "sent";
  if (statut === "CHIFFRAGE") return "quote";
  if (statut === "LIKELY") return "likely";
  if (statut === "CONFIRMED") return "confirmed";
  if (statut === "LOST" || statut === "ABANDONED") return "closed";
  if (statut === "WAITING") return "waiting";
  return "lead";
}

function followStatusForUi(statut: CommercialStatus): CommercialStatus {
  if (statut === "CHIFFRAGE") return "PISTE";
  if (statut === "LIKELY") return "WAITING";
  return statut;
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
  const [chargement, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [erreur, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const reponse = await fetch("/api/desktop/commercial", { cache: "no-store" });
      const corps = (await reponse.json()) as Snapshot;
      if (!reponse.ok) throw new Error(corps.error ?? "COMMERCIAL_LOAD_FAILED");
      setSnapshot(corps);
    } catch (loadError) {
      const code = loadError instanceof Error ? loadError.message : "COMMERCIAL_LOAD_FAILED";
      setError(erreurs[code] ?? "Impossible de charger les affaires.");
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
      const reponse = await fetch("/api/desktop/commercial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mutation),
      });
      const corps = (await reponse.json()) as Snapshot;
      if (!reponse.ok) throw new Error(corps.error ?? "COMMERCIAL_MUTATION_FAILED");
      setSnapshot(corps);
      setNotice(success);
      return corps;
    } catch (mutationError) {
      const code =
        mutationError instanceof Error ? mutationError.message : "COMMERCIAL_MUTATION_FAILED";
      setError(erreurs[code] ?? "L’action n’a pas pu être enregistrée.");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const upload = useCallback(
    async (
      idAffaire: string,
      fichiers: File[],
      category: CommercialDocumentCategory,
      expectedUpdatedAt: string,
      isSignedQuote = false,
    ) => {
      if (!fichiers.length) return null;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const form = new FormData();
        fichiers.forEach((fichier) => form.append("files", fichier));
        form.set("category", category);
        form.set("isCurrent", "1");
        form.set("isSignedQuote", isSignedQuote ? "1" : "0");
        form.set("expectedUpdatedAt", expectedUpdatedAt);
        const reponse = await fetch(`/api/desktop/commercial/${idAffaire}/documents`, {
          method: "POST",
          body: form,
        });
        const corps = (await reponse.json()) as Snapshot;
        if (!reponse.ok) throw new Error(corps.error ?? "COMMERCIAL_DOCUMENT_UPLOAD_FAILED");
        setSnapshot(corps);
        setNotice(
          `${fichiers.length} document${fichiers.length > 1 ? "s" : ""} ajouté${fichiers.length > 1 ? "s" : ""}.`,
        );
        return corps;
      } catch (uploadError) {
        const code =
          uploadError instanceof Error ? uploadError.message : "COMMERCIAL_DOCUMENT_UPLOAD_FAILED";
        setError(erreurs[code] ?? "Les documents n’ont pas pu être ajoutés.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { snapshot, loading: chargement, busy, error: erreur, notice, load, mutate, upload };
}

export function CommercialWorkspaceV2({ affairId }: { affairId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focus = searchParams.get("focus");
  const {
    snapshot,
    loading: chargement,
    busy,
    error: erreur,
    notice,
    load,
    mutate,
    upload,
  } = useCommercial();
  const [mode, setMode] = useState<CommercialListFilter>("active");
  const [requeteRecherche, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const clients = snapshot?.payload.clients ?? [];
  const cases = useMemo(() => snapshot?.payload.cases ?? [], [snapshot?.payload.cases]);
  const maintenant = useMemo(
    () => new Date(snapshot?.serverNow ?? Date.now()),
    [snapshot?.serverNow],
  );
  const normalized = requeteRecherche.trim().toLocaleLowerCase("fr-FR");
  const visible = useMemo(() => {
    let list = filterCommercialCases(cases, mode, maintenant);
    if (normalized) {
      list = list.filter((element) =>
        [
          element.name,
          element.clientName,
          element.siteLabel,
          element.siteAddressOverride?.addressLine1,
          element.siteAddressOverride?.addressLine2,
          element.siteAddressOverride?.postalCode,
          element.siteAddressOverride?.city,
          element.contactName,
          element.description,
          element.nextAction,
        ]
          .filter(Boolean)
          .some((valeur) => String(valeur).toLocaleLowerCase("fr-FR").includes(normalized)),
      );
    }
    return list;
  }, [cases, mode, normalized, maintenant]);

  const selectionne = affairId ? (cases.find((element) => element.id === affairId) ?? null) : null;

  useEffect(() => {
    if (affairId || !focus || !cases.some((element) => element.id === focus)) return;
    router.replace(commercialAffairHref(focus));
  }, [affairId, cases, focus, router]);

  const active = filterCommercialCases(cases, "active", maintenant).length;
  const due = filterCommercialCases(cases, "follow-up", maintenant).length;
  const confirmed = filterCommercialCases(cases, "confirmed", maintenant).length;
  const archived = filterCommercialCases(cases, "archives", maintenant).length;

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

        {erreur ? <div className="commercialV2Message error">{erreur}</div> : null}
        {notice ? <div className="commercialV2Message success">{notice}</div> : null}

        {chargement && !snapshot ? (
          <div className="commercialV2Loading">
            <RefreshCw size={18} /> Chargement…
          </div>
        ) : selectionne && snapshot ? (
          <main className="commercialV2Detail commercialV2DetailStandalone">
            <AffairDetail
              key={selectionne.id}
              item={selectionne}
              clients={clients}
              busy={busy}
              canModify={snapshot.capabilities.canModify}
              canConfirm={snapshot.capabilities.canConfirm}
              canProvision={snapshot.capabilities.canProvision}
              mutate={(corps, success) =>
                mutate({ ...corps, expectedUpdatedAt: selectionne.updatedAt }, success)
              }
              upload={(idAffaire, fichiers, category, isSignedQuote) =>
                upload(idAffaire, fichiers, category, selectionne.updatedAt, isSignedQuote)
              }
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
              onClick={() => setCreateOpen((valeur) => !valeur)}
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

      {erreur ? <div className="commercialV2Message error">{erreur}</div> : null}
      {notice ? <div className="commercialV2Message success">{notice}</div> : null}

      {createOpen && snapshot ? (
        <CreateAffair
          clients={clients}
          busy={busy}
          onCancel={() => setCreateOpen(false)}
          onSubmit={async (corps) => {
            const resultat = await mutate(corps, "Affaire créée.");
            if (resultat?.focusCaseId) {
              setMode("active");
              setCreateOpen(false);
              router.push(commercialAffairHref(resultat.focusCaseId));
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
            value={requeteRecherche}
            onChange={(evenement) => setQuery(evenement.target.value)}
            placeholder="Rechercher affaire ou client…"
          />
          {requeteRecherche ? (
            <button type="button" onClick={() => setQuery("")}>
              <X size={13} />
            </button>
          ) : null}
        </label>
      </section>

      {chargement && !snapshot ? (
        <div className="commercialV2Loading">
          <RefreshCw size={18} /> Chargement…
        </div>
      ) : (
        <div className="commercialV2ListShell">
          <aside className="commercialV2List commercialV2ListFull">
            {visible.length ? (
              visible.map((element) => (
                <Link
                  key={element.id}
                  href={commercialAffairHref(element.id)}
                  className="commercialV2ListRow"
                >
                  <div>
                    <strong>{element.name}</strong>
                    <span>{element.clientName || "Client à préciser"}</span>
                  </div>
                  <div className="commercialV2ListMeta">
                    <span className={`commercialV2Badge ${statusTone(element.status)}`}>
                      {COMMERCIAL_STATUS_LABELS[element.status]}
                    </span>
                    <small>{dateLabel(nextCommercialDeadline(element))}</small>
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
  label: libelle,
  value: valeur,
  alert = false,
  selected: selectionne,
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
      className={`${alert ? "alert " : ""}${selectionne ? "active" : ""}`}
      aria-pressed={selectionne}
      onClick={onClick}
    >
      <Icon size={18} />
      <div>
        <strong>{valeur}</strong>
        <span>{libelle}</span>
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
  onSubmit: (corps: Mutation) => Promise<void>;
}) {
  const [clientMode, setClientMode] = useState<"existing" | "new">(
    clients.length ? "existing" : "new",
  );
  const [idClient, setClientId] = useState(clients[0]?.id ?? "");
  const [differentSiteAddress, setDifferentSiteAddress] = useState(false);
  const selectedClient =
    clientMode === "existing" ? clients.find((client) => client.id === idClient) : undefined;

  async function submit(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    const form = new FormData(evenement.currentTarget);
    await onSubmit({
      action: "create",
      name: String(form.get("name") ?? ""),
      existingClientId: clientMode === "existing" && idClient ? idClient : undefined,
      clientName: clientMode === "new" ? String(form.get("clientName") ?? "") : "",
      siteLabel: "",
      siteAddressOverride: differentSiteAddress ? siteAddressFromForm(form) : null,
      reviewDate: String(form.get("reviewDate") ?? ""),
      description: String(form.get("description") ?? ""),
      nextAction: "",
    });
  }
  return (
    <form className="commercialV2Create" onSubmit={(evenement) => void submit(evenement)}>
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
          onChange={(evenement) => setClientMode(evenement.target.value as "existing" | "new")}
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
          <select
            value={idClient}
            onChange={(evenement) => setClientId(evenement.target.value)}
            required
          >
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
  address: adresse,
  disabled: desactive,
}: {
  different: boolean;
  onDifferentChange: (valeur: boolean) => void;
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
          onChange={(evenement) => onDifferentChange(evenement.target.checked)}
          disabled={desactive}
        />
        <span>Adresse de chantier différente de l’adresse du client</span>
      </label>
      <div className="commercialV2SiteAddressGrid" hidden={!different}>
        <label className="wide">
          <span>Adresse chantier</span>
          <input
            name="siteAddressLine1"
            defaultValue={adresse?.addressLine1 ?? ""}
            disabled={desactive || !different}
          />
        </label>
        <label className="wide">
          <span>Complément d’adresse</span>
          <input
            name="siteAddressLine2"
            defaultValue={adresse?.addressLine2 ?? ""}
            disabled={desactive || !different}
          />
        </label>
        <label>
          <span>Code postal</span>
          <input
            name="sitePostalCode"
            defaultValue={adresse?.postalCode ?? ""}
            disabled={desactive || !different}
          />
        </label>
        <label>
          <span>Ville</span>
          <input
            name="siteCity"
            defaultValue={adresse?.city ?? ""}
            disabled={desactive || !different}
          />
        </label>
      </div>
    </div>
  );
}

function AffairDetail({
  item: element,
  clients,
  busy,
  canModify,
  canConfirm,
  canProvision,
  mutate,
  upload,
}: {
  item: CommercialCase;
  clients: CommercialClient[];
  busy: boolean;
  canModify: boolean;
  canConfirm: boolean;
  canProvision: boolean;
  mutate: (corps: Mutation, success: string) => Promise<Snapshot | null>;
  upload: (
    idAffaire: string,
    fichiers: File[],
    category: CommercialDocumentCategory,
    isSignedQuote?: boolean,
  ) => Promise<Snapshot | null>;
}) {
  const [tab, setTab] = useState<DetailTab>("affair");
  return (
    <div>
      <header className="commercialV2DetailHeader">
        <div>
          <span className={`commercialV2Badge ${statusTone(element.status)}`}>
            {COMMERCIAL_STATUS_LABELS[element.status]}
          </span>
          <h2>{element.name}</h2>
          <p>
            {element.clientId ? (
              <a
                className="commercialV2ClientLink"
                href={clientWorkspaceHref(element.clientId)}
                title="Ouvrir la fiche client"
              >
                {element.clientName || "Fiche client"} <ExternalLink size={11} />
              </a>
            ) : (
              element.clientName || "Client à préciser"
            )}
          </p>
        </div>
        {element.clientId && !isCommercialClosed(element) ? (
          <Link
            href={`/devis/nouveau?affaire=${encodeURIComponent(element.id)}`}
            className="primaryButton commercialV2CreateQuote"
          >
            <FilePlus2 size={14} /> Créer un devis
          </Link>
        ) : null}
      </header>
      <nav className="commercialV2Tabs">
        <button className={tab === "affair" ? "active" : ""} onClick={() => setTab("affair")}>
          <Users size={14} /> Affaire
        </button>
        <button className={tab === "follow" ? "active" : ""} onClick={() => setTab("follow")}>
          <Clock3 size={14} /> Suivi
        </button>
        <button className={tab === "documents" ? "active" : ""} onClick={() => setTab("documents")}>
          <Paperclip size={14} /> Documents <small>{element.documents.length}</small>
        </button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
          <History size={14} /> Historique
        </button>
      </nav>
      <div className="commercialV2TabBody">
        {tab === "affair" ? (
          <AffairForm
            item={element}
            clients={clients}
            busy={busy}
            canModify={canModify}
            mutate={mutate}
          />
        ) : null}
        {tab === "follow" ? (
          <FollowForm
            item={element}
            busy={busy}
            canModify={canModify}
            canConfirm={canConfirm}
            canProvision={canProvision}
            mutate={mutate}
          />
        ) : null}
        {tab === "documents" ? (
          <Documents item={element} busy={busy} canModify={canModify} upload={upload} />
        ) : null}
        {tab === "history" ? <HistoryPanel item={element} /> : null}
      </div>
    </div>
  );
}

function AffairForm({
  item: element,
  clients,
  busy,
  canModify,
  mutate,
}: {
  item: CommercialCase;
  clients: CommercialClient[];
  busy: boolean;
  canModify: boolean;
  mutate: (corps: Mutation, success: string) => Promise<Snapshot | null>;
}) {
  const [idClient, setClientId] = useState(element.clientId ?? "");
  const [differentSiteAddress, setDifferentSiteAddress] = useState(
    element.siteAddressOverride !== null,
  );
  const selectedClient = clients.find((client) => client.id === idClient);

  async function submit(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    const form = new FormData(evenement.currentTarget);
    await mutate(
      {
        action: "updateDetails",
        caseId: element.id,
        name: element.name,
        existingClientId: idClient || undefined,
        clientName: idClient ? "" : String(form.get("clientName") ?? ""),
        siteLabel: element.siteLabel ?? "",
        siteAddressOverride: differentSiteAddress ? siteAddressFromForm(form) : null,
        contactName: element.contactName ?? "",
        contactPhone: element.contactPhone ?? "",
        contactEmail: element.contactEmail ?? "",
        description: String(form.get("description") ?? ""),
        nextAction: element.nextAction ?? "",
      },
      "Affaire mise à jour.",
    );
  }
  return (
    <form className="commercialV2Form" onSubmit={(evenement) => void submit(evenement)}>
      <label className="wide">
        <span>Client</span>
        <select
          value={idClient}
          onChange={(evenement) => setClientId(evenement.target.value)}
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
      {!idClient ? (
        <label className="wide">
          <span>Nouveau client</span>
          <input name="clientName" defaultValue={element.clientName ?? ""} disabled={!canModify} />
        </label>
      ) : null}
      <label className="wide">
        <span>Description</span>
        <textarea
          name="description"
          rows={3}
          defaultValue={element.description ?? ""}
          disabled={!canModify}
        />
      </label>
      <SiteAddressFields
        different={differentSiteAddress}
        onDifferentChange={setDifferentSiteAddress}
        client={selectedClient}
        address={element.siteAddressOverride}
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
  item: element,
  busy,
  canModify,
  canConfirm,
  canProvision,
  mutate,
}: {
  item: CommercialCase;
  busy: boolean;
  canModify: boolean;
  canConfirm: boolean;
  canProvision: boolean;
  mutate: (corps: Mutation, success: string) => Promise<Snapshot | null>;
}) {
  const [statut, setStatus] = useState<CommercialStatus>(followStatusForUi(element.status));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [date, setDate] = useState(
    nextCommercialDeadline(element) ?? element.plannedInstallDate ?? "",
  );
  const open = !isCommercialClosed(element);
  const dateTitle =
    statut === "SENT"
      ? "Date de relance"
      : statut === "CONFIRMED"
        ? "Pose prévue"
        : statut === "FOLLOW_UP"
          ? "Pas de date obligatoire"
          : "Prochaine revue";

  async function saveStatus() {
    if (statut === "LOST" || statut === "ABANDONED") {
      await mutate(
        { action: "close", caseId: element.id, status: statut, reason: "" },
        "Affaire clôturée.",
      );
      return;
    }
    if (statut === "CONFIRMED") {
      setConfirmOpen(true);
      return;
    }
    await mutate(
      {
        action: "setStatus",
        caseId: element.id,
        status: statut,
        reviewDate: ["PISTE", "SENT", "WAITING"].includes(statut) ? date : undefined,
      },
      "Suivi commercial mis à jour.",
    );
  }

  if (!open) {
    return (
      <section className="commercialV2Section">
        <h3>Affaire clôturée</h3>
        <p>{element.closingReason || "Sans motif saisi."}</p>
        {canModify ? (
          <button
            className="secondaryButton"
            onClick={() =>
              void mutate(
                {
                  action: "reopen",
                  caseId: element.id,
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
      <CommercialAffairQuotes
        item={element}
        busy={busy}
        canProvision={canProvision}
        mutate={mutate}
      />
      <section className="commercialV2Section">
        <h3>
          <CalendarClock size={15} /> Suivi global
        </h3>
        <label>
          <span>Statut</span>
          <select
            value={statut}
            onChange={(evenement) => setStatus(evenement.target.value as CommercialStatus)}
            disabled={!canModify}
          >
            {COMMERCIAL_FOLLOW_STATUS_OPTIONS.map((valeur) => (
              <option key={valeur} value={valeur} disabled={valeur === "CONFIRMED" && !canConfirm}>
                {COMMERCIAL_STATUS_LABELS[valeur]}
              </option>
            ))}
          </select>
        </label>
        {statut !== "FOLLOW_UP" ? (
          <label>
            <span>{dateTitle}</span>
            <input
              type="date"
              value={date}
              onChange={(evenement) => setDate(evenement.target.value)}
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
        item={element}
        busy={busy}
        canModify={canModify}
        canConfirm={canConfirm}
        mutate={mutate}
      />
      {confirmOpen ? (
        <CommercialConfirmationDialog
          item={element}
          plannedInstallDate={date}
          busy={busy}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={async (retainedQuoteIds, confirmWithoutQuote) => {
            const resultat = await mutate(
              {
                action: "setStatus",
                caseId: element.id,
                status: "CONFIRMED",
                plannedInstallDate: date,
                retainedQuoteIds,
                confirmWithoutQuote,
              },
              "Affaire confirmée avec les devis retenus.",
            );
            if (resultat) setConfirmOpen(false);
            return !!resultat;
          }}
        />
      ) : null}
    </div>
  );
}

function FollowUp({
  item: element,
  busy,
  canModify,
  canConfirm,
  mutate,
}: {
  item: CommercialCase;
  busy: boolean;
  canModify: boolean;
  canConfirm: boolean;
  mutate: (corps: Mutation, success: string) => Promise<Snapshot | null>;
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
        caseId: element.id,
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
          onChange={(evenement) => setSummary(evenement.target.value)}
          disabled={!canModify}
        />
      </label>
      <label>
        <span>Suite</span>
        <select
          value={nextStatus}
          onChange={(evenement) => setNextStatus(evenement.target.value as CommercialStatus)}
          disabled={!canModify}
        >
          {COMMERCIAL_FOLLOW_STATUS_OPTIONS.map((valeur) => (
            <option key={valeur} value={valeur} disabled={valeur === "CONFIRMED" && !canConfirm}>
              {COMMERCIAL_STATUS_LABELS[valeur]}
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
            onChange={(evenement) => setNextDate(evenement.target.value)}
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
          item={element}
          plannedInstallDate={nextDate}
          busy={busy}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={async (retainedQuoteIds, confirmWithoutQuote) => {
            const resultat = await mutate(
              {
                action: "recordFollowUp",
                caseId: element.id,
                summary,
                nextStatus: "CONFIRMED",
                plannedInstallDate: nextDate,
                retainedQuoteIds,
                confirmWithoutQuote,
              },
              "Relance enregistrée et affaire confirmée.",
            );
            if (resultat) setConfirmOpen(false);
            return !!resultat;
          }}
        />
      ) : null}
    </section>
  );
}

function Documents({
  item: element,
  busy,
  canModify,
  upload,
}: {
  item: CommercialCase;
  busy: boolean;
  canModify: boolean;
  upload: (
    idAffaire: string,
    fichiers: File[],
    category: CommercialDocumentCategory,
    isSignedQuote?: boolean,
  ) => Promise<Snapshot | null>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [category, setCategory] = useState<CommercialDocumentCategory>("RECEIVED");
  const [filtre, setFilter] = useState<CommercialDocumentFilter>("ALL");
  const [isSignedQuote, setIsSignedQuote] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [previewDocumentId, setPreviewDocumentId] = useState<string | null>(null);
  const categoryLabel = COMMERCIAL_DOCUMENT_CATEGORY_LABELS[category];
  const visibleDocuments = filterCommercialDocuments(element.documents, filtre).reverse();

  function uploadFiles(fichiers: File[]) {
    if (busy || fichiers.length === 0) return;
    void upload(element.id, fichiers, category, category === "QUOTE" && isSignedQuote);
  }

  function togglePreview(idDocument: string) {
    setPreviewDocumentId((courant) => (courant === idDocument ? null : idDocument));
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
        caseId={element.id}
        createdAt={element.createdAt}
        hasDocuments={element.documents.length > 0}
      />
      {canModify ? (
        <>
          <div className="commercialV2Upload">
            <label className="commercialV2UploadCategory">
              <span>Classer dans</span>
              <select
                value={category}
                onChange={(evenement) => {
                  const nextCategory = evenement.target.value as CommercialDocumentCategory;
                  setCategory(nextCategory);
                  if (nextCategory !== "QUOTE") setIsSignedQuote(false);
                }}
                disabled={busy}
              >
                {Object.entries(COMMERCIAL_DOCUMENT_CATEGORY_LABELS).map(([valeur, libelle]) => (
                  <option key={valeur} value={valeur}>
                    {libelle}
                  </option>
                ))}
              </select>
            </label>
            {category === "QUOTE" ? (
              <label className="commercialV2UploadCategory">
                <span>Type de devis</span>
                <select
                  value={isSignedQuote ? "SIGNED" : "UNSIGNED"}
                  onChange={(evenement) => setIsSignedQuote(evenement.target.value === "SIGNED")}
                  disabled={busy}
                >
                  <option value="UNSIGNED">Devis</option>
                  <option value="SIGNED">Devis signé</option>
                </select>
              </label>
            ) : null}
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              onChange={(evenement) => {
                const fichiers = Array.from(evenement.target.files ?? []);
                evenement.currentTarget.value = "";
                uploadFiles(fichiers);
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
            onDragEnter={(evenement) => {
              if (busy || !Array.from(evenement.dataTransfer.types).includes("Files")) return;
              evenement.preventDefault();
              dragDepth.current += 1;
              setDragging(true);
            }}
            onDragOver={(evenement) => {
              if (busy || !Array.from(evenement.dataTransfer.types).includes("Files")) return;
              evenement.preventDefault();
              evenement.dataTransfer.dropEffect = "copy";
            }}
            onDragLeave={(evenement) => {
              if (!dragging) return;
              evenement.preventDefault();
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDragging(false);
            }}
            onDrop={(evenement) => {
              evenement.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              if (busy) return;
              uploadFiles(
                collectDroppedFiles(evenement.dataTransfer.items, evenement.dataTransfer.files),
              );
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
          value={filtre}
          onChange={(evenement) => setFilter(evenement.target.value as CommercialDocumentFilter)}
        >
          <option value="ALL">Tous les documents ({element.documents.length})</option>
          {Object.entries(COMMERCIAL_DOCUMENT_CATEGORY_LABELS).map(([valeur, libelle]) => (
            <option key={valeur} value={valeur}>
              {libelle}
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
                  caseId={element.id}
                  document={document}
                  previewOpen={previewOpen}
                  onTogglePreview={() => togglePreview(document.id)}
                />
                {previewOpen ? (
                  <div className="commercialV2DocPreview">
                    <div className="commercialV2DocPreviewFrame">
                      <iframe
                        src={`/api/desktop/affaires/${element.id}/documents/${document.id}`}
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
            {element.documents.length ? "Aucun document pour ce type" : "Aucun document"}
          </div>
        )}
      </div>
    </section>
  );
}

function HistoryPanel({ item: element }: { item: CommercialCase }) {
  return (
    <section className="commercialV2Section">
      <h3>
        <History size={15} /> Historique
      </h3>
      <div className="commercialV2History">
        {element.history
          .slice()
          .reverse()
          .map((evenement) => (
            <article key={evenement.id}>
              <time>{dateTime(evenement.at)}</time>
              <div>
                <strong>{evenement.actorName}</strong>
                <p>{evenement.summary}</p>
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
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 14px;
        border-bottom: 1px solid #eeeaf2;
      }
      .commercialV2CreateQuote {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        text-decoration: none;
        white-space: nowrap;
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
