"use client";

import {
  Archive,
  ArchiveRestore,
  Building2,
  Plus,
  Save,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  clientDisplayName,
  matchesClientSearch,
  type ClientRecord,
  type ClientsPayload,
  type ClientType,
} from "@/lib/clients/domain";

type ClientsSnapshot = {
  payload: ClientsPayload;
  canWrite: boolean;
  focusClientId?: string;
};

type DraftContact = {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  phone: string;
  email: string;
  isPrimary: boolean;
};

type ClientDraft = {
  type: ClientType;
  companyName: string;
  firstName: string;
  lastName: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  phone: string;
  email: string;
  siret: string;
  paymentTerms: string;
  notes: string;
  contacts: DraftContact[];
};

type EditMode = "view" | "edit" | "new";

const typeLabels: Record<ClientType, string> = {
  PARTICULIER: "Particulier",
  ENTREPRISE: "Entreprise",
  COLLECTIVITE: "Collectivité",
  AUTRE: "Autre",
};

const paymentTermsOptions = [
  "Comptant",
  "À réception de facture",
  "30 jours date de facture",
  "30 jours fin de mois",
  "45 jours date de facture",
  "45 jours fin de mois",
  "60 jours date de facture",
  "60 jours fin de mois",
] as const;

function isPresetPaymentTerm(value: string): boolean {
  return paymentTermsOptions.includes(value as (typeof paymentTermsOptions)[number]);
}

const errorMessages: Record<string, string> = {
  MODULE_FORBIDDEN: "Vous n’avez pas accès au fichier clients.",
  CLIENTS_LOCKED:
    "Le fichier clients est modifié sur un autre poste. Réessaie dans quelques secondes.",
  CLIENTS_VERSION_CONFLICT: "Le fichier clients a changé sur un autre poste. Il a été rechargé.",
  CLIENTS_REQUEST_INVALID: "Certaines informations de la fiche sont invalides ou incomplètes.",
  CLIENT_REQUEST_INVALID: "Certaines informations de la fiche sont invalides ou incomplètes.",
  CLIENT_LAST_NAME_REQUIRED: "Le nom est obligatoire pour un particulier.",
  CLIENT_COMPANY_NAME_REQUIRED: "Le nom ou la raison sociale est obligatoire.",
  CLIENT_SIRET_INVALID: "Le SIRET doit contenir exactement 14 chiffres.",
  CLIENT_SIRET_EXISTS: "Ce SIRET est déjà utilisé par un autre client.",
  CLIENT_PRIMARY_CONTACT_DUPLICATE: "Un seul contact principal peut être défini par client.",
  CLIENT_NOT_FOUND: "Cette fiche client n’existe plus.",
  CLIENT_ARCHIVED: "Ce client est archivé. Réactive-le avant de le modifier.",
};

function emptyDraft(): ClientDraft {
  return {
    type: "ENTREPRISE",
    companyName: "",
    firstName: "",
    lastName: "",
    addressLine1: "",
    addressLine2: "",
    postalCode: "",
    city: "",
    phone: "",
    email: "",
    siret: "",
    paymentTerms: "",
    notes: "",
    contacts: [],
  };
}

function clientToDraft(client: ClientRecord): ClientDraft {
  return {
    type: client.type,
    companyName: client.companyName,
    firstName: client.firstName,
    lastName: client.lastName,
    addressLine1: client.addressLine1,
    addressLine2: client.addressLine2,
    postalCode: client.postalCode,
    city: client.city,
    phone: client.phone,
    email: client.email,
    siret: client.siret,
    paymentTerms: client.paymentTerms,
    notes: client.notes,
    contacts: client.contacts.map((contact) => ({ ...contact })),
  };
}

function hasContactContent(contact: DraftContact): boolean {
  return Boolean(
    contact.firstName.trim() ||
      contact.lastName.trim() ||
      contact.role.trim() ||
      contact.phone.trim() ||
      contact.email.trim(),
  );
}

function clientSubtitle(client: ClientRecord): string {
  const parts = [client.city, client.phone || client.email].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Coordonnées à compléter";
}

export function ClientsWorkspace() {
  const [snapshot, setSnapshot] = useState<ClientsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<EditMode>("view");
  const [draft, setDraft] = useState<ClientDraft>(emptyDraft);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/desktop/clients", { cache: "no-store" });
      const body = (await response.json()) as ClientsSnapshot & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "CLIENTS_LOAD_FAILED");
      setSnapshot(body);
      setSelectedId((current) => {
        if (current && body.payload.clients.some((client) => client.id === current)) return current;
        return body.payload.clients.find((client) => !client.isArchived)?.id ?? null;
      });
    } catch (loadError) {
      const code = loadError instanceof Error ? loadError.message : "CLIENTS_LOAD_FAILED";
      setError(errorMessages[code] ?? "Impossible de charger le fichier clients.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedClient = useMemo(
    () => snapshot?.payload.clients.find((client) => client.id === selectedId) ?? null,
    [selectedId, snapshot?.payload.clients],
  );

  useEffect(() => {
    if (mode !== "view" || !selectedClient) return;
    setDraft(clientToDraft(selectedClient));
  }, [mode, selectedClient]);

  const visibleClients = useMemo(() => {
    const clients = snapshot?.payload.clients ?? [];
    return clients
      .filter((client) => showArchived || !client.isArchived)
      .filter((client) => matchesClientSearch(client, query))
      .sort((a, b) => {
        if (a.isArchived !== b.isArchived) return a.isArchived ? 1 : -1;
        return clientDisplayName(a).localeCompare(clientDisplayName(b), "fr-FR", {
          sensitivity: "base",
        });
      });
  }, [query, showArchived, snapshot?.payload.clients]);

  async function mutate(body: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/desktop/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as ClientsSnapshot & {
        error?: string;
        lockedBy?: string;
      };
      if (!response.ok) {
        const base =
          errorMessages[result.error ?? ""] ?? "La fiche client n’a pas pu être enregistrée.";
        throw new Error(result.lockedBy ? `${base} Poste en cours : ${result.lockedBy}.` : base);
      }
      setSnapshot(result);
      if (result.focusClientId) {
        setSelectedId(result.focusClientId);
        const client = result.payload.clients.find((item) => item.id === result.focusClientId);
        if (client) setDraft(clientToDraft(client));
      }
      setMode("view");
      setNotice(successMessage);
      return result;
    } catch (mutationError) {
      const message =
        mutationError instanceof Error
          ? mutationError.message
          : "La fiche client n’a pas pu être enregistrée.";
      setError(message);
      if (message.includes("changé sur un autre poste")) await load();
      return null;
    } finally {
      setBusy(false);
    }
  }

  function startNew() {
    setSelectedId(null);
    setDraft(emptyDraft());
    setMode("new");
    setError(null);
    setNotice(null);
  }

  function selectClient(client: ClientRecord) {
    setSelectedId(client.id);
    setDraft(clientToDraft(client));
    setMode("view");
    setError(null);
    setNotice(null);
  }

  function cancelEdit() {
    if (selectedClient) {
      setDraft(clientToDraft(selectedClient));
      setMode("view");
      return;
    }
    setMode("view");
    setDraft(emptyDraft());
  }

  function updateDraft<K extends keyof ClientDraft>(key: K, value: ClientDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function addContact() {
    updateDraft("contacts", [
      ...draft.contacts,
      {
        id: crypto.randomUUID(),
        firstName: "",
        lastName: "",
        role: "",
        phone: "",
        email: "",
        isPrimary: draft.contacts.length === 0,
      },
    ]);
  }

  function updateContact(index: number, patch: Partial<DraftContact>) {
    setDraft((current) => ({
      ...current,
      contacts: current.contacts.map((contact, contactIndex) => {
        if (contactIndex !== index) {
          return patch.isPrimary ? { ...contact, isPrimary: false } : contact;
        }
        return { ...contact, ...patch };
      }),
    }));
  }

  function removeContact(index: number) {
    updateDraft(
      "contacts",
      draft.contacts.filter((_, contactIndex) => contactIndex !== index),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const contacts = draft.contacts.filter(hasContactContent).map((contact) => ({ ...contact }));
    const fields = { ...draft, contacts };

    if (mode === "new") {
      await mutate({ action: "create", ...fields }, "Client créé.");
      return;
    }
    if (mode === "edit" && selectedClient) {
      await mutate(
        { action: "update", clientId: selectedClient.id, ...fields },
        "Fiche client enregistrée.",
      );
    }
  }

  async function archiveSelected() {
    if (!selectedClient) return;
    const result = await mutate(
      { action: "archive", clientId: selectedClient.id },
      "Client archivé.",
    );
    if (result) setShowArchived(true);
  }

  async function reactivateSelected() {
    if (!selectedClient) return;
    await mutate({ action: "reactivate", clientId: selectedClient.id }, "Client réactivé.");
  }

  const canWrite = snapshot?.canWrite === true;
  const editable = canWrite && (mode === "edit" || mode === "new");
  const displayedClient = mode === "new" ? null : selectedClient;

  return (
    <div className="clientsPage">
      <header className="clientsPageHeader">
        <div>
          <h1>Clients</h1>
          <p className="muted">
            Référentiel unique pour les affaires, devis, chantiers et factures.
          </p>
        </div>
        {canWrite ? (
          <button className="primaryButton" type="button" onClick={startNew} disabled={busy}>
            <Plus size={15} aria-hidden="true" />
            Nouveau client
          </button>
        ) : null}
      </header>

      {error ? <div className="clientsAlert clientsAlertError">{error}</div> : null}
      {notice ? <div className="clientsAlert clientsAlertSuccess">{notice}</div> : null}

      <div className="clientsLayout">
        <section className="panel clientsListPanel" aria-label="Liste des clients">
          <div className="clientsSearch">
            <Search size={16} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher nom, téléphone, e-mail, SIRET…"
              aria-label="Rechercher un client"
            />
          </div>
          <label className="clientsArchiveToggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            Afficher les archivés
          </label>

          <div className="clientsList">
            {loading ? <p className="muted">Chargement…</p> : null}
            {!loading && visibleClients.length === 0 ? (
              <div className="clientsEmpty">
                <Building2 size={24} aria-hidden="true" />
                <span>Aucun client correspondant.</span>
              </div>
            ) : null}
            {visibleClients.map((client) => (
              <button
                type="button"
                key={client.id}
                className={`clientsListItem${selectedId === client.id ? " isSelected" : ""}`}
                onClick={() => selectClient(client)}
              >
                <span className="clientsListIdentity">
                  <strong>{clientDisplayName(client)}</strong>
                  <span>{clientSubtitle(client)}</span>
                </span>
                <span className="clientsListMeta">
                  <span className="typeBadge">{typeLabels[client.type]}</span>
                  {client.isArchived ? <span className="statusBadge">Archivé</span> : null}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel clientsDetailPanel">
          {mode === "view" && !displayedClient ? (
            <div className="clientsEmpty clientsDetailEmpty">
              <UserRound size={28} aria-hidden="true" />
              <strong>Sélectionne un client</strong>
              <span>ou crée une nouvelle fiche.</span>
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="clientsDetailHeader">
                <div>
                  <h2>
                    {mode === "new"
                      ? "Nouveau client"
                      : displayedClient
                        ? clientDisplayName(displayedClient)
                        : "Client"}
                  </h2>
                  {displayedClient ? (
                    <p className="muted">
                      Mis à jour par {displayedClient.updatedByName} ·{" "}
                      {new Date(displayedClient.updatedAt).toLocaleDateString("fr-FR")}
                    </p>
                  ) : (
                    <p className="muted">Crée la fiche maître utilisée par les autres modules.</p>
                  )}
                </div>

                <div className="buttonRow">
                  {mode === "view" && displayedClient && canWrite && !displayedClient.isArchived ? (
                    <button
                      className="secondaryButton"
                      type="button"
                      onClick={() => setMode("edit")}
                    >
                      Modifier
                    </button>
                  ) : null}
                  {mode === "view" && displayedClient && canWrite && displayedClient.isArchived ? (
                    <button
                      className="secondaryButton"
                      type="button"
                      onClick={() => void reactivateSelected()}
                      disabled={busy}
                    >
                      <ArchiveRestore size={15} aria-hidden="true" />
                      Réactiver
                    </button>
                  ) : null}
                  {mode === "view" && displayedClient && canWrite && !displayedClient.isArchived ? (
                    <button
                      className="secondaryButton"
                      type="button"
                      onClick={() => void archiveSelected()}
                      disabled={busy}
                    >
                      <Archive size={15} aria-hidden="true" />
                      Archiver
                    </button>
                  ) : null}
                  {editable ? (
                    <>
                      <button
                        className="secondaryButton"
                        type="button"
                        onClick={cancelEdit}
                        disabled={busy}
                      >
                        <X size={15} aria-hidden="true" />
                        Annuler
                      </button>
                      <button className="primaryButton" type="submit" disabled={busy}>
                        <Save size={15} aria-hidden="true" />
                        {busy ? "Enregistrement…" : "Enregistrer"}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="clientsSection">
                <h3>Identité</h3>
                <div className="clientsFormGrid">
                  <label className="clientsField">
                    Type de client
                    <select
                      value={draft.type}
                      onChange={(event) => updateDraft("type", event.target.value as ClientType)}
                      disabled={!editable}
                    >
                      {Object.entries(typeLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {draft.type === "PARTICULIER" ? (
                    <>
                      <label className="clientsField">
                        Nom
                        <input
                          value={draft.lastName}
                          onChange={(event) => updateDraft("lastName", event.target.value)}
                          disabled={!editable}
                          required
                        />
                      </label>
                      <label className="clientsField">
                        Prénom
                        <input
                          value={draft.firstName}
                          onChange={(event) => updateDraft("firstName", event.target.value)}
                          disabled={!editable}
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="clientsField clientsFieldWide">
                        Nom / raison sociale
                        <input
                          value={draft.companyName}
                          onChange={(event) => updateDraft("companyName", event.target.value)}
                          disabled={!editable}
                          required
                        />
                      </label>
                      <label className="clientsField">
                        SIRET
                        <input
                          value={draft.siret}
                          onChange={(event) => updateDraft("siret", event.target.value)}
                          disabled={!editable}
                          inputMode="numeric"
                          placeholder="14 chiffres"
                        />
                      </label>
                    </>
                  )}
                </div>
              </div>

              <div className="clientsSection">
                <h3>Coordonnées</h3>
                <div className="clientsFormGrid">
                  <label className="clientsField clientsFieldWide">
                    Adresse
                    <input
                      value={draft.addressLine1}
                      onChange={(event) => updateDraft("addressLine1", event.target.value)}
                      disabled={!editable}
                    />
                  </label>
                  <label className="clientsField clientsFieldWide">
                    Complément d’adresse
                    <input
                      value={draft.addressLine2}
                      onChange={(event) => updateDraft("addressLine2", event.target.value)}
                      disabled={!editable}
                    />
                  </label>
                  <label className="clientsField">
                    Code postal
                    <input
                      value={draft.postalCode}
                      onChange={(event) => updateDraft("postalCode", event.target.value)}
                      disabled={!editable}
                    />
                  </label>
                  <label className="clientsField">
                    Ville
                    <input
                      value={draft.city}
                      onChange={(event) => updateDraft("city", event.target.value)}
                      disabled={!editable}
                    />
                  </label>
                  <label className="clientsField">
                    Téléphone
                    <input
                      value={draft.phone}
                      onChange={(event) => updateDraft("phone", event.target.value)}
                      disabled={!editable}
                      type="tel"
                    />
                  </label>
                  <label className="clientsField">
                    E-mail
                    <input
                      value={draft.email}
                      onChange={(event) => updateDraft("email", event.target.value)}
                      disabled={!editable}
                      type="email"
                    />
                  </label>
                </div>
              </div>

              <div className="clientsSection clientsPaymentSection">
                <h3>Conditions de règlement</h3>
                <p className="muted">
                  Cette valeur servira de référence pour les futurs devis et factures du client.
                </p>
                <label className="clientsField">
                  Conditions applicables à ce client
                  <select
                    value={draft.paymentTerms}
                    onChange={(event) => updateDraft("paymentTerms", event.target.value)}
                    disabled={!editable}
                  >
                    <option value="">À définir</option>
                    {paymentTermsOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                    {draft.paymentTerms && !isPresetPaymentTerm(draft.paymentTerms) ? (
                      <option value={draft.paymentTerms}>{draft.paymentTerms}</option>
                    ) : null}
                  </select>
                </label>
              </div>

              <div className="clientsSection">
                <div className="clientsSectionHeader">
                  <div>
                    <h3>Contacts</h3>
                    <p className="muted">
                      Plusieurs interlocuteurs possibles pour une même entreprise.
                    </p>
                  </div>
                  {editable ? (
                    <button className="secondaryButton" type="button" onClick={addContact}>
                      <Plus size={15} aria-hidden="true" />
                      Ajouter un contact
                    </button>
                  ) : null}
                </div>

                {draft.contacts.length === 0 ? (
                  <p className="muted clientsNoContacts">Aucun contact secondaire renseigné.</p>
                ) : (
                  <div className="clientsContacts">
                    {draft.contacts.map((contact, index) => (
                      <div className="clientsContactRow" key={contact.id}>
                        <label className="clientsField">
                          Prénom
                          <input
                            value={contact.firstName}
                            onChange={(event) =>
                              updateContact(index, { firstName: event.target.value })
                            }
                            disabled={!editable}
                          />
                        </label>
                        <label className="clientsField">
                          Nom
                          <input
                            value={contact.lastName}
                            onChange={(event) =>
                              updateContact(index, { lastName: event.target.value })
                            }
                            disabled={!editable}
                          />
                        </label>
                        <label className="clientsField">
                          Fonction
                          <input
                            value={contact.role}
                            onChange={(event) => updateContact(index, { role: event.target.value })}
                            disabled={!editable}
                          />
                        </label>
                        <label className="clientsField">
                          Téléphone
                          <input
                            value={contact.phone}
                            onChange={(event) =>
                              updateContact(index, { phone: event.target.value })
                            }
                            disabled={!editable}
                            type="tel"
                          />
                        </label>
                        <label className="clientsField">
                          E-mail
                          <input
                            value={contact.email}
                            onChange={(event) =>
                              updateContact(index, { email: event.target.value })
                            }
                            disabled={!editable}
                            type="email"
                          />
                        </label>
                        <label className="clientsPrimaryCheck">
                          <input
                            type="checkbox"
                            checked={contact.isPrimary}
                            onChange={(event) =>
                              updateContact(index, { isPrimary: event.target.checked })
                            }
                            disabled={!editable}
                          />
                          Contact principal
                        </label>
                        {editable ? (
                          <button
                            className="iconButton clientsRemoveContact"
                            type="button"
                            onClick={() => removeContact(index)}
                            aria-label="Supprimer ce contact"
                            title="Supprimer ce contact"
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="clientsSection">
                <h3>Notes</h3>
                <label className="clientsField">
                  Informations internes
                  <textarea
                    value={draft.notes}
                    onChange={(event) => updateDraft("notes", event.target.value)}
                    disabled={!editable}
                    rows={4}
                  />
                </label>
              </div>
            </form>
          )}
        </section>
      </div>

      <style jsx global>{`
        .clientsPage {
          display: grid;
          gap: 14px;
        }
        .clientsPageHeader,
        .clientsDetailHeader,
        .clientsSectionHeader {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
        }
        .clientsPageHeader h1,
        .clientsDetailHeader h2,
        .clientsSection h3 {
          margin-bottom: 4px;
        }
        .clientsPageHeader p,
        .clientsDetailHeader p,
        .clientsSectionHeader p,
        .clientsPaymentSection > p {
          margin-bottom: 0;
        }
        .clientsAlert {
          padding: 9px 12px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: white;
        }
        .clientsAlertError {
          border-color: #f0c5c5;
          background: #fff2f2;
          color: var(--danger);
        }
        .clientsAlertSuccess {
          border-color: #bfdfcd;
          background: #f1faf5;
          color: var(--success);
        }
        .clientsLayout {
          display: grid;
          grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
          gap: 14px;
          align-items: start;
        }
        .clientsListPanel,
        .clientsDetailPanel {
          padding: 16px;
        }
        .clientsListPanel {
          position: sticky;
          top: 88px;
          display: grid;
          gap: 10px;
          max-height: calc(100vh - 104px);
          overflow: hidden;
        }
        .clientsSearch {
          position: relative;
        }
        .clientsSearch svg {
          position: absolute;
          left: 11px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--muted);
          pointer-events: none;
        }
        .clientsSearch input {
          padding-left: 34px;
        }
        .clientsArchiveToggle,
        .clientsPrimaryCheck {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .clientsList {
          min-height: 160px;
          overflow: auto;
          display: grid;
          align-content: start;
          gap: 6px;
          padding-right: 3px;
        }
        .clientsListItem {
          width: 100%;
          min-height: 62px;
          padding: 9px 10px;
          border: 1px solid var(--border);
          border-radius: 9px;
          background: white;
          color: var(--text);
          text-align: left;
          display: grid;
          gap: 7px;
        }
        .clientsListItem:hover,
        .clientsListItem.isSelected {
          border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
          background: color-mix(in srgb, var(--accent) 6%, white);
        }
        .clientsListIdentity,
        .clientsListMeta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          min-width: 0;
        }
        .clientsListIdentity strong {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .clientsListIdentity > span {
          color: var(--muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .clientsListMeta {
          justify-content: flex-start;
        }
        .clientsEmpty {
          min-height: 150px;
          display: grid;
          place-items: center;
          align-content: center;
          gap: 7px;
          color: var(--muted);
          text-align: center;
        }
        .clientsDetailEmpty {
          min-height: 420px;
        }
        .clientsDetailHeader {
          padding-bottom: 14px;
          border-bottom: 1px solid var(--border);
        }
        .clientsSection {
          margin-top: 16px;
          padding-top: 16px;
          border-top: 1px solid var(--border);
        }
        .clientsDetailHeader + .clientsSection {
          border-top: 0;
        }
        .clientsFormGrid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          margin-top: 10px;
        }
        .clientsField {
          display: grid;
          gap: 6px;
          font-weight: 650;
          color: #4d505b;
        }
        .clientsFieldWide {
          grid-column: span 2;
        }
        .clientsField textarea {
          width: 100%;
          padding: 9px 12px;
          resize: vertical;
          border: 1px solid #dcd8e4;
          border-radius: 8px;
          background: #fff;
          color: var(--text);
          outline: none;
          line-height: 1.35;
        }
        .clientsField textarea:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 13%, transparent);
        }
        .clientsField input:disabled,
        .clientsField select:disabled,
        .clientsField textarea:disabled {
          opacity: 1;
          background: #f8f7fb;
          color: #4d505b;
          cursor: default;
        }
        .clientsPaymentSection {
          padding: 14px;
          border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border));
          border-radius: 9px;
          background: color-mix(in srgb, var(--accent) 4%, white);
        }
        .clientsPaymentSection .clientsField {
          margin-top: 10px;
        }
        .clientsContacts {
          display: grid;
          gap: 9px;
          margin-top: 10px;
        }
        .clientsContactRow {
          display: grid;
          grid-template-columns:
            minmax(100px, 0.8fr) minmax(100px, 0.8fr) minmax(120px, 1fr)
            minmax(130px, 1fr) minmax(160px, 1.2fr) auto 32px;
          gap: 8px;
          align-items: end;
          padding: 10px;
          border: 1px solid var(--border);
          border-radius: 9px;
          background: var(--surface-soft);
        }
        .clientsPrimaryCheck {
          min-height: var(--papot-control-height);
          white-space: nowrap;
        }
        .clientsRemoveContact {
          align-self: end;
          color: var(--danger);
        }
        .clientsNoContacts {
          margin: 10px 0 0;
        }

        @media (max-width: 1500px) {
          .clientsFormGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .clientsContactRow {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
          .clientsPrimaryCheck,
          .clientsRemoveContact {
            align-self: center;
          }
        }

        @media (max-width: 1050px) {
          .clientsLayout {
            grid-template-columns: 1fr;
          }
          .clientsListPanel {
            position: static;
            max-height: 360px;
          }
        }
      `}</style>
    </div>
  );
}