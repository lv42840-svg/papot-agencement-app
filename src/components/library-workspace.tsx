"use client";

import { Boxes, Layers3, LockKeyhole, Pencil, Plus, Save, Search, Trash2, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  calculateLibraryComponentMarginPercent,
  calculateLibraryComponentSalePriceCents,
  type LibraryComponent,
} from "@/lib/library/component";
import {
  libraryComponentUsageCount,
  removeLibraryComponent,
  removeLibraryOuvrage,
  upsertLibraryComponent,
  upsertLibraryOuvrage,
} from "@/lib/library/catalog-edit";
import type { LibraryOuvrage } from "@/lib/library/ouvrage";
import {
  createInitialLibraryPayload,
  LIBRARY_RESOURCE_REF,
  parseLibraryPayload,
  type LibraryPayload,
  type LibrarySnapshot,
} from "@/lib/library/storage";

type LibraryTab = "components" | "ouvrages";

type ComponentDraft = {
  id: string;
  name: string;
  description: string;
  unit: string;
  costPriceEuros: string;
  marginPercent: string;
  salePriceEuros: string;
};

type OuvrageDraftLine = {
  id: string;
  componentId: string;
  quantity: string;
};

type OuvrageDraft = {
  id: string;
  name: string;
  description: string;
  components: OuvrageDraftLine[];
};

type EditorState =
  | { kind: "component"; mode: "new" | "edit"; draft: ComponentDraft }
  | { kind: "ouvrage"; mode: "new" | "edit"; draft: OuvrageDraft }
  | null;

type EditSession = {
  leaseId: string;
  baseVersion: number;
};

type ResourceEnvelope = {
  version: number;
  payload: unknown;
};

type OpenResourceResponse =
  | {
      status: "editable" | "read-only";
      resource: ResourceEnvelope | null;
      baseVersion: number;
      lock: { owner_display_name: string };
    }
  | { status: "error"; error: string };

type SaveResourceResponse =
  | { status: "saved"; resource: ResourceEnvelope }
  | { status: "conflict"; current: ResourceEnvelope | null }
  | { status: "error"; error: string };

const moneyFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

const errorMessages: Record<string, string> = {
  MODULE_FORBIDDEN: "Vous n’avez pas accès à la bibliothèque de chiffrage.",
  LIBRARY_STORE_INVALID: "Le fichier Bibliothèque contient des données invalides.",
  LIBRARY_COMPONENT_INVALID: "Le composant contient une information invalide ou manquante.",
  LIBRARY_COMPONENT_PRICING_INVALID: "Les prix et la marge doivent être des valeurs positives.",
  LIBRARY_COMPONENT_PRICING_MISMATCH:
    "Le prix de vente ne correspond pas au prix d’achat et à la marge.",
  LIBRARY_COMPONENT_MARGIN_UNDEFINED:
    "Une marge ne peut pas être calculée avec un prix d’achat nul et un prix de vente positif.",
  LIBRARY_COMPONENT_IN_USE:
    "Ce composant est utilisé dans au moins un ouvrage. Retire-le d’abord des ouvrages concernés.",
  LIBRARY_COMPONENT_NOT_FOUND: "Ce composant n’existe plus dans la bibliothèque.",
  LIBRARY_OUVRAGE_INVALID:
    "L’ouvrage doit avoir un nom et au moins un composant avec une quantité positive.",
  LIBRARY_OUVRAGE_COMPONENT_NOT_FOUND:
    "Un composant utilisé par cet ouvrage n’existe plus dans la bibliothèque.",
  LIBRARY_OUVRAGE_NOT_FOUND: "Cet ouvrage n’existe plus dans la bibliothèque.",
  LOCK_EXPIRED:
    "Le verrou de modification a expiré. Recharge la bibliothèque avant de recommencer.",
  LOCK_NOT_FOUND: "Le verrou de modification n’existe plus. Recharge la bibliothèque.",
  LOCK_NOT_OWNED: "La bibliothèque est maintenant modifiée depuis un autre poste.",
  LOCK_CHANGED: "Le verrou de la bibliothèque a changé. Recharge avant de recommencer.",
};

function messageForError(error: unknown, fallback: string): string {
  const code = error instanceof Error ? error.message : String(error);
  return errorMessages[code] ?? fallback;
}

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .trim();
}

function formatMoney(cents: number): string {
  return moneyFormatter.format(cents / 100);
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function parseDecimal(value: string): number {
  const parsed = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(parsed)) throw new Error("LIBRARY_COMPONENT_PRICING_INVALID");
  return parsed;
}

function eurosToCents(value: string): number {
  const euros = parseDecimal(value);
  if (euros < 0) throw new Error("LIBRARY_COMPONENT_PRICING_INVALID");
  const cents = Math.round(euros * 100);
  if (!Number.isSafeInteger(cents)) throw new Error("LIBRARY_COMPONENT_PRICING_INVALID");
  return cents;
}

function componentToDraft(component: LibraryComponent): ComponentDraft {
  return {
    id: component.id,
    name: component.name,
    description: component.description,
    unit: component.unit,
    costPriceEuros: centsToInput(component.costPriceCents),
    marginPercent: String(component.marginPercent).replace(".", ","),
    salePriceEuros: centsToInput(component.salePriceCents),
  };
}

function emptyComponentDraft(): ComponentDraft {
  return {
    id: crypto.randomUUID(),
    name: "",
    description: "",
    unit: "u",
    costPriceEuros: "0,00",
    marginPercent: "30",
    salePriceEuros: "0,00",
  };
}

function componentFromDraft(draft: ComponentDraft): LibraryComponent {
  const costPriceCents = eurosToCents(draft.costPriceEuros);
  const marginPercent = parseDecimal(draft.marginPercent);
  const salePriceCents = eurosToCents(draft.salePriceEuros);
  if (marginPercent < 0) throw new Error("LIBRARY_COMPONENT_PRICING_INVALID");

  return {
    id: draft.id,
    name: draft.name,
    description: draft.description,
    unit: draft.unit,
    costPriceCents,
    marginPercent,
    salePriceCents,
  };
}

function ouvrageToDraft(ouvrage: LibraryOuvrage): OuvrageDraft {
  return {
    id: ouvrage.id,
    name: ouvrage.name,
    description: ouvrage.description,
    components: ouvrage.components.map((line) => ({
      id: line.id,
      componentId: line.componentId,
      quantity: String(line.quantity).replace(".", ","),
    })),
  };
}

function emptyOuvrageDraft(payload: LibraryPayload): OuvrageDraft {
  return {
    id: crypto.randomUUID(),
    name: "",
    description: "",
    components:
      payload.components.length > 0
        ? [
            {
              id: crypto.randomUUID(),
              componentId: payload.components[0].id,
              quantity: "1",
            },
          ]
        : [],
  };
}

function ouvrageFromDraft(draft: OuvrageDraft): LibraryOuvrage {
  return {
    id: draft.id,
    name: draft.name,
    description: draft.description,
    components: draft.components.map((line) => {
      const quantity = parseDecimal(line.quantity);
      if (quantity <= 0) throw new Error("LIBRARY_OUVRAGE_INVALID");
      return {
        id: line.id,
        componentId: line.componentId,
        quantity,
      };
    }),
  };
}

function snapshotFromEnvelope(envelope: ResourceEnvelope | null): LibrarySnapshot {
  if (!envelope) {
    return { version: 0, payload: createInitialLibraryPayload() };
  }
  return {
    version: envelope.version,
    payload: parseLibraryPayload(envelope.payload),
  };
}

async function sharedResourceRequest(body: Record<string, unknown>) {
  const response = await fetch("/api/desktop/library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as { status?: string; error?: string };
  if (!response.ok) throw new Error(result.error ?? "LIBRARY_REQUEST_FAILED");
  return result;
}

export function LibraryWorkspace({
  initialSnapshot,
  canWrite,
}: {
  initialSnapshot: LibrarySnapshot;
  canWrite: boolean;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [activeTab, setActiveTab] = useState<LibraryTab>("components");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditorState>(null);
  const [session, setSession] = useState<EditSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const normalizedQuery = normalizeSearch(query);

  const visibleComponents = useMemo(
    () =>
      snapshot.payload.components
        .filter((component) =>
          normalizeSearch(
            [component.name, component.description, component.unit].join(" "),
          ).includes(normalizedQuery),
        )
        .sort((a, b) => a.name.localeCompare(b.name, "fr-FR", { sensitivity: "base" })),
    [normalizedQuery, snapshot.payload.components],
  );

  const visibleOuvrages = useMemo(
    () =>
      snapshot.payload.ouvrages
        .filter((ouvrage) => {
          const componentNames = ouvrage.components.map(
            (line) =>
              snapshot.payload.components.find((component) => component.id === line.componentId)
                ?.name ?? "",
          );
          return normalizeSearch(
            [ouvrage.name, ouvrage.description, ...componentNames].join(" "),
          ).includes(normalizedQuery);
        })
        .sort((a, b) => a.name.localeCompare(b.name, "fr-FR", { sensitivity: "base" })),
    [normalizedQuery, snapshot.payload.components, snapshot.payload.ouvrages],
  );

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!session) return;
    const current = session;
    const interval = window.setInterval(() => {
      void sharedResourceRequest({
        action: "renew",
        resource: LIBRARY_RESOURCE_REF,
        leaseId: current.leaseId,
      }).catch((renewError) => {
        setError(
          messageForError(
            renewError,
            "La session de modification a expiré. Recharge la bibliothèque avant de recommencer.",
          ),
        );
        setEditor(null);
        setSession((active) => (active?.leaseId === current.leaseId ? null : active));
      });
    }, 120_000);
    return () => window.clearInterval(interval);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const current = session;
    return () => {
      void fetch("/api/desktop/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "release",
          resource: LIBRARY_RESOURCE_REF,
          leaseId: current.leaseId,
        }),
        keepalive: true,
      });
    };
  }, [session]);

  async function acquireEditSession(): Promise<{
    session: EditSession;
    snapshot: LibrarySnapshot;
  } | null> {
    if (!canWrite) return null;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const leaseId = crypto.randomUUID();
      const result = (await sharedResourceRequest({
        action: "open",
        resource: LIBRARY_RESOURCE_REF,
        leaseId,
      })) as OpenResourceResponse;

      if (result.status === "error") throw new Error(result.error);
      if (result.status === "read-only") {
        setError(
          `Bibliothèque en cours de modification par ${result.lock.owner_display_name}. Réessaie dans quelques instants.`,
        );
        return null;
      }

      const latest = snapshotFromEnvelope(result.resource);
      const nextSession = { leaseId, baseVersion: result.baseVersion };
      setSnapshot(latest);
      setSession(nextSession);
      return { session: nextSession, snapshot: latest };
    } catch (openError) {
      setError(messageForError(openError, "Impossible d’ouvrir la bibliothèque en modification."));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function releaseLease(editSession: EditSession): Promise<void> {
    try {
      await sharedResourceRequest({
        action: "release",
        resource: LIBRARY_RESOURCE_REF,
        leaseId: editSession.leaseId,
      });
    } catch {
      // The lease expires automatically. A failed best-effort release must not hide a successful save.
    }
  }

  async function finishEditing(): Promise<void> {
    if (session) await releaseLease(session);
    setEditor(null);
    setSession(null);
  }

  async function persistPayload(
    nextPayload: LibraryPayload,
    successMessage: string,
    editSession: EditSession | null = session,
    releaseOnError = false,
  ) {
    if (!editSession) return false;
    const currentSession = editSession;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = (await sharedResourceRequest({
        action: "save",
        resource: LIBRARY_RESOURCE_REF,
        leaseId: currentSession.leaseId,
        expectedVersion: currentSession.baseVersion,
        payload: nextPayload,
      })) as SaveResourceResponse;

      if (result.status === "error") throw new Error(result.error);
      if (result.status === "conflict") {
        setSnapshot(snapshotFromEnvelope(result.current));
        setError(
          "La bibliothèque a changé sur un autre poste. La version la plus récente a été rechargée.",
        );
        await releaseLease(currentSession);
        setEditor(null);
        setSession(null);
        return false;
      }

      setSnapshot(snapshotFromEnvelope(result.resource));
      await releaseLease(currentSession);
      setEditor(null);
      setSession(null);
      setNotice(successMessage);
      return true;
    } catch (saveError) {
      setError(messageForError(saveError, "La bibliothèque n’a pas pu être enregistrée."));
      if (releaseOnError) {
        await releaseLease(currentSession);
        setEditor(null);
        setSession(null);
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function startNewComponent() {
    const acquired = await acquireEditSession();
    if (!acquired) return;
    setActiveTab("components");
    setEditor({ kind: "component", mode: "new", draft: emptyComponentDraft() });
  }

  async function startEditComponent(componentId: string) {
    const acquired = await acquireEditSession();
    if (!acquired) return;
    const component = acquired.snapshot.payload.components.find((item) => item.id === componentId);
    if (!component) {
      await releaseLease(acquired.session);
      setSession(null);
      setError("Ce composant n’existe plus. La bibliothèque a été rechargée.");
      return;
    }
    setActiveTab("components");
    setEditor({ kind: "component", mode: "edit", draft: componentToDraft(component) });
  }

  async function startNewOuvrage() {
    if (snapshot.payload.components.length === 0) {
      setError("Crée d’abord au moins un composant avant de créer un ouvrage.");
      return;
    }
    const acquired = await acquireEditSession();
    if (!acquired) return;
    if (acquired.snapshot.payload.components.length === 0) {
      await releaseLease(acquired.session);
      setSession(null);
      setError("Crée d’abord au moins un composant avant de créer un ouvrage.");
      return;
    }
    setActiveTab("ouvrages");
    setEditor({
      kind: "ouvrage",
      mode: "new",
      draft: emptyOuvrageDraft(acquired.snapshot.payload),
    });
  }

  async function startEditOuvrage(ouvrageId: string) {
    const acquired = await acquireEditSession();
    if (!acquired) return;
    const ouvrage = acquired.snapshot.payload.ouvrages.find((item) => item.id === ouvrageId);
    if (!ouvrage) {
      await releaseLease(acquired.session);
      setSession(null);
      setError("Cet ouvrage n’existe plus. La bibliothèque a été rechargée.");
      return;
    }
    setActiveTab("ouvrages");
    setEditor({ kind: "ouvrage", mode: "edit", draft: ouvrageToDraft(ouvrage) });
  }

  async function deleteComponent(component: LibraryComponent) {
    if (!window.confirm(`Supprimer définitivement le composant « ${component.name} » ?`)) return;
    const acquired = await acquireEditSession();
    if (!acquired) return;
    try {
      const nextPayload = removeLibraryComponent(acquired.snapshot.payload, component.id);
      await persistPayload(nextPayload, "Composant supprimé.", acquired.session, true);
    } catch (deleteError) {
      setError(messageForError(deleteError, "Le composant n’a pas pu être supprimé."));
      await releaseLease(acquired.session);
      setEditor(null);
      setSession(null);
    }
  }

  async function deleteOuvrage(ouvrage: LibraryOuvrage) {
    if (!window.confirm(`Supprimer définitivement l’ouvrage « ${ouvrage.name} » ?`)) return;
    const acquired = await acquireEditSession();
    if (!acquired) return;
    try {
      const nextPayload = removeLibraryOuvrage(acquired.snapshot.payload, ouvrage.id);
      await persistPayload(nextPayload, "Ouvrage supprimé.", acquired.session, true);
    } catch (deleteError) {
      setError(messageForError(deleteError, "L’ouvrage n’a pas pu être supprimé."));
      await releaseLease(acquired.session);
      setEditor(null);
      setSession(null);
    }
  }

  function updateComponentDraft(patch: Partial<ComponentDraft>) {
    if (editor?.kind !== "component") return;
    setEditor({ ...editor, draft: { ...editor.draft, ...patch } });
  }

  function updateComponentCost(value: string) {
    if (editor?.kind !== "component") return;
    const next = { ...editor.draft, costPriceEuros: value };
    try {
      const salePriceCents = calculateLibraryComponentSalePriceCents(
        eurosToCents(value),
        parseDecimal(next.marginPercent),
      );
      next.salePriceEuros = centsToInput(salePriceCents);
    } catch {
      // Keep the user's partial value while typing. Validation happens on save.
    }
    setEditor({ ...editor, draft: next });
  }

  function updateComponentMargin(value: string) {
    if (editor?.kind !== "component") return;
    const next = { ...editor.draft, marginPercent: value };
    try {
      const salePriceCents = calculateLibraryComponentSalePriceCents(
        eurosToCents(next.costPriceEuros),
        parseDecimal(value),
      );
      next.salePriceEuros = centsToInput(salePriceCents);
    } catch {
      // Keep the user's partial value while typing. Validation happens on save.
    }
    setEditor({ ...editor, draft: next });
  }

  function updateComponentSalePrice(value: string) {
    if (editor?.kind !== "component") return;
    const next = { ...editor.draft, salePriceEuros: value };
    try {
      const marginPercent = calculateLibraryComponentMarginPercent(
        eurosToCents(next.costPriceEuros),
        eurosToCents(value),
      );
      next.marginPercent = String(marginPercent).replace(".", ",");
    } catch {
      // Keep the user's partial value while typing. Validation happens on save.
    }
    setEditor({ ...editor, draft: next });
  }

  function updateOuvrageDraft(patch: Partial<OuvrageDraft>) {
    if (editor?.kind !== "ouvrage") return;
    setEditor({ ...editor, draft: { ...editor.draft, ...patch } });
  }

  function updateOuvrageLine(index: number, patch: Partial<OuvrageDraftLine>) {
    if (editor?.kind !== "ouvrage") return;
    updateOuvrageDraft({
      components: editor.draft.components.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...patch } : line,
      ),
    });
  }

  function addOuvrageLine() {
    if (editor?.kind !== "ouvrage" || snapshot.payload.components.length === 0) return;
    updateOuvrageDraft({
      components: [
        ...editor.draft.components,
        {
          id: crypto.randomUUID(),
          componentId: snapshot.payload.components[0].id,
          quantity: "1",
        },
      ],
    });
  }

  function removeOuvrageLine(index: number) {
    if (editor?.kind !== "ouvrage") return;
    updateOuvrageDraft({
      components: editor.draft.components.filter((_, lineIndex) => lineIndex !== index),
    });
  }

  async function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || !session) return;
    try {
      if (editor.kind === "component") {
        const nextPayload = upsertLibraryComponent(
          snapshot.payload,
          componentFromDraft(editor.draft),
        );
        await persistPayload(
          nextPayload,
          editor.mode === "new" ? "Composant créé." : "Composant enregistré.",
        );
        return;
      }

      const nextPayload = upsertLibraryOuvrage(snapshot.payload, ouvrageFromDraft(editor.draft));
      await persistPayload(
        nextPayload,
        editor.mode === "new" ? "Ouvrage créé." : "Ouvrage enregistré.",
      );
    } catch (submitError) {
      setError(messageForError(submitError, "Les informations saisies ne sont pas valides."));
    }
  }

  const newAction = activeTab === "components" ? startNewComponent : startNewOuvrage;
  const newActionLabel = activeTab === "components" ? "Nouveau composant" : "Nouvel ouvrage";
  const newActionDisabled =
    busy || (activeTab === "ouvrages" && snapshot.payload.components.length === 0);

  return (
    <div className="libraryPage">
      <header className="libraryHeader">
        <div>
          <h1>Bibliothèque</h1>
          <p className="muted">Composants et ouvrages réutilisables pour le chiffrage.</p>
        </div>
        {canWrite ? (
          <button
            className="primaryButton"
            type="button"
            onClick={() => void newAction()}
            disabled={newActionDisabled}
            title={
              activeTab === "ouvrages" && snapshot.payload.components.length === 0
                ? "Crée d’abord un composant"
                : undefined
            }
          >
            <Plus size={15} aria-hidden="true" />
            {newActionLabel}
          </button>
        ) : (
          <span className="libraryReadOnlyBadge">Lecture seule</span>
        )}
      </header>

      {error ? <div className="libraryAlert libraryAlertError">{error}</div> : null}
      {notice ? <div className="libraryAlert libraryAlertSuccess">{notice}</div> : null}

      <div className="libraryTabs" role="tablist" aria-label="Type de bibliothèque">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "components"}
          className={activeTab === "components" ? "isActive" : undefined}
          onClick={() => {
            setActiveTab("components");
            setQuery("");
          }}
          disabled={Boolean(editor)}
        >
          <Boxes size={16} aria-hidden="true" />
          Composants
          <span>{snapshot.payload.components.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "ouvrages"}
          className={activeTab === "ouvrages" ? "isActive" : undefined}
          onClick={() => {
            setActiveTab("ouvrages");
            setQuery("");
          }}
          disabled={Boolean(editor)}
        >
          <Layers3 size={16} aria-hidden="true" />
          Ouvrages
          <span>{snapshot.payload.ouvrages.length}</span>
        </button>
      </div>

      <div className={`libraryWorkspace${editor ? " hasEditor" : ""}`}>
        <section className="panel libraryListPanel">
          <div className="libraryToolbar">
            <div className="librarySearch">
              <Search size={16} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={
                  activeTab === "components" ? "Rechercher un composant…" : "Rechercher un ouvrage…"
                }
                aria-label={
                  activeTab === "components" ? "Rechercher un composant" : "Rechercher un ouvrage"
                }
              />
            </div>
            <span className="libraryVersion">Version {snapshot.version}</span>
          </div>

          {activeTab === "components" ? (
            visibleComponents.length === 0 ? (
              <div className="libraryEmpty">
                <Boxes size={28} aria-hidden="true" />
                <strong>{query ? "Aucun composant trouvé" : "Aucun composant"}</strong>
                <span>
                  {query
                    ? "Modifie la recherche pour afficher d’autres résultats."
                    : "Ajoute les matières, quincailleries, heures ou prestations réutilisables."}
                </span>
                {!query && canWrite ? (
                  <button
                    className="secondaryButton"
                    type="button"
                    onClick={() => void startNewComponent()}
                  >
                    <Plus size={15} aria-hidden="true" />
                    Créer le premier composant
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="libraryTableWrap">
                <table className="libraryTable">
                  <thead>
                    <tr>
                      <th>Composant</th>
                      <th>Unité</th>
                      <th className="numeric">Achat HT</th>
                      <th className="numeric">Marge</th>
                      <th className="numeric">Vente HT</th>
                      <th className="numeric">Utilisé</th>
                      {canWrite ? <th className="libraryActionsHeader">Actions</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleComponents.map((component) => (
                      <tr key={component.id}>
                        <td>
                          <strong>{component.name}</strong>
                          {component.description ? <small>{component.description}</small> : null}
                        </td>
                        <td>{component.unit}</td>
                        <td className="numeric">{formatMoney(component.costPriceCents)}</td>
                        <td className="numeric">
                          {component.marginPercent.toLocaleString("fr-FR")} %
                        </td>
                        <td className="numeric librarySalePrice">
                          {formatMoney(component.salePriceCents)}
                        </td>
                        <td className="numeric">
                          {libraryComponentUsageCount(snapshot.payload.ouvrages, component)}{" "}
                          ouvrage(s)
                        </td>
                        {canWrite ? (
                          <td className="libraryActions">
                            <button
                              className="iconButton"
                              type="button"
                              onClick={() => void startEditComponent(component.id)}
                              disabled={busy || Boolean(editor)}
                              aria-label={`Modifier ${component.name}`}
                              title="Modifier"
                            >
                              <Pencil size={15} aria-hidden="true" />
                            </button>
                            <button
                              className="iconButton libraryDeleteButton"
                              type="button"
                              onClick={() => void deleteComponent(component)}
                              disabled={busy || Boolean(editor)}
                              aria-label={`Supprimer ${component.name}`}
                              title="Supprimer"
                            >
                              <Trash2 size={15} aria-hidden="true" />
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : visibleOuvrages.length === 0 ? (
            <div className="libraryEmpty">
              <Layers3 size={28} aria-hidden="true" />
              <strong>{query ? "Aucun ouvrage trouvé" : "Aucun ouvrage"}</strong>
              <span>
                {query
                  ? "Modifie la recherche pour afficher d’autres résultats."
                  : snapshot.payload.components.length === 0
                    ? "Crée d’abord un composant, puis compose ton premier ouvrage."
                    : "Crée des ensembles réutilisables à partir des composants de la bibliothèque."}
              </span>
              {!query && canWrite ? (
                <button
                  className="secondaryButton"
                  type="button"
                  onClick={() => void startNewOuvrage()}
                  disabled={snapshot.payload.components.length === 0}
                >
                  <Plus size={15} aria-hidden="true" />
                  Créer le premier ouvrage
                </button>
              ) : null}
            </div>
          ) : (
            <div className="libraryTableWrap">
              <table className="libraryTable">
                <thead>
                  <tr>
                    <th>Ouvrage</th>
                    <th>Composition</th>
                    <th className="numeric">Lignes</th>
                    {canWrite ? <th className="libraryActionsHeader">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visibleOuvrages.map((ouvrage) => {
                    const names = ouvrage.components
                      .map(
                        (line) =>
                          snapshot.payload.components.find(
                            (component) => component.id === line.componentId,
                          )?.name ?? "Composant manquant",
                      )
                      .slice(0, 3);
                    return (
                      <tr key={ouvrage.id}>
                        <td>
                          <strong>{ouvrage.name}</strong>
                          {ouvrage.description ? <small>{ouvrage.description}</small> : null}
                        </td>
                        <td>
                          {names.join(" · ")}
                          {ouvrage.components.length > 3
                            ? ` · +${ouvrage.components.length - 3}`
                            : ""}
                        </td>
                        <td className="numeric">{ouvrage.components.length}</td>
                        {canWrite ? (
                          <td className="libraryActions">
                            <button
                              className="iconButton"
                              type="button"
                              onClick={() => void startEditOuvrage(ouvrage.id)}
                              disabled={busy || Boolean(editor)}
                              aria-label={`Modifier ${ouvrage.name}`}
                              title="Modifier"
                            >
                              <Pencil size={15} aria-hidden="true" />
                            </button>
                            <button
                              className="iconButton libraryDeleteButton"
                              type="button"
                              onClick={() => void deleteOuvrage(ouvrage)}
                              disabled={busy || Boolean(editor)}
                              aria-label={`Supprimer ${ouvrage.name}`}
                              title="Supprimer"
                            >
                              <Trash2 size={15} aria-hidden="true" />
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {editor ? (
          <section className="panel libraryEditorPanel">
            <form onSubmit={(event) => void submitEditor(event)}>
              <div className="libraryEditorHeader">
                <div>
                  <span className="libraryEditorEyebrow">
                    <LockKeyhole size={13} aria-hidden="true" />
                    Modification verrouillée sur ce poste
                  </span>
                  <h2>
                    {editor.kind === "component"
                      ? editor.mode === "new"
                        ? "Nouveau composant"
                        : "Modifier le composant"
                      : editor.mode === "new"
                        ? "Nouvel ouvrage"
                        : "Modifier l’ouvrage"}
                  </h2>
                </div>
                <button
                  className="iconButton"
                  type="button"
                  onClick={() => void finishEditing()}
                  disabled={busy}
                  aria-label="Fermer sans enregistrer"
                  title="Annuler"
                >
                  <X size={17} aria-hidden="true" />
                </button>
              </div>

              {editor.kind === "component" ? (
                <div className="libraryEditorBody">
                  <label className="libraryField">
                    Nom du composant
                    <input
                      value={editor.draft.name}
                      onChange={(event) => updateComponentDraft({ name: event.target.value })}
                      required
                      maxLength={240}
                      autoFocus
                    />
                  </label>

                  <div className="libraryFormGrid">
                    <label className="libraryField">
                      Unité
                      <input
                        value={editor.draft.unit}
                        onChange={(event) => updateComponentDraft({ unit: event.target.value })}
                        required
                        maxLength={40}
                        placeholder="u, m², ml, h…"
                      />
                    </label>
                    <label className="libraryField">
                      Prix d’achat HT
                      <input
                        value={editor.draft.costPriceEuros}
                        onChange={(event) => updateComponentCost(event.target.value)}
                        inputMode="decimal"
                        required
                      />
                    </label>
                    <label className="libraryField">
                      Marge
                      <div className="libraryInputSuffix">
                        <input
                          value={editor.draft.marginPercent}
                          onChange={(event) => updateComponentMargin(event.target.value)}
                          inputMode="decimal"
                          required
                        />
                        <span>%</span>
                      </div>
                    </label>
                    <label className="libraryField">
                      Prix de vente HT
                      <div className="libraryInputSuffix">
                        <input
                          value={editor.draft.salePriceEuros}
                          onChange={(event) => updateComponentSalePrice(event.target.value)}
                          inputMode="decimal"
                          required
                        />
                        <span>€</span>
                      </div>
                    </label>
                  </div>

                  <p className="libraryPricingHint">
                    Modifier la marge recalcule le prix de vente. Modifier le prix de vente
                    recalcule la marge.
                  </p>

                  <label className="libraryField">
                    Description
                    <textarea
                      value={editor.draft.description}
                      onChange={(event) =>
                        updateComponentDraft({ description: event.target.value })
                      }
                      rows={4}
                      maxLength={4000}
                    />
                  </label>
                </div>
              ) : (
                <div className="libraryEditorBody">
                  <label className="libraryField">
                    Nom de l’ouvrage
                    <input
                      value={editor.draft.name}
                      onChange={(event) => updateOuvrageDraft({ name: event.target.value })}
                      required
                      maxLength={240}
                      autoFocus
                    />
                  </label>

                  <label className="libraryField">
                    Description
                    <textarea
                      value={editor.draft.description}
                      onChange={(event) => updateOuvrageDraft({ description: event.target.value })}
                      rows={3}
                      maxLength={4000}
                    />
                  </label>

                  <div className="libraryCompositionHeader">
                    <div>
                      <h3>Composition</h3>
                      <p className="muted">Choisis les composants et leurs quantités.</p>
                    </div>
                    <button className="secondaryButton" type="button" onClick={addOuvrageLine}>
                      <Plus size={15} aria-hidden="true" />
                      Ajouter
                    </button>
                  </div>

                  <div className="libraryComposition">
                    {editor.draft.components.map((line, index) => {
                      const component = snapshot.payload.components.find(
                        (item) => item.id === line.componentId,
                      );
                      return (
                        <div className="libraryCompositionRow" key={line.id}>
                          <label className="libraryField">
                            Composant
                            <select
                              value={line.componentId}
                              onChange={(event) =>
                                updateOuvrageLine(index, { componentId: event.target.value })
                              }
                              required
                            >
                              {snapshot.payload.components.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name} · {item.unit} · {formatMoney(item.salePriceCents)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="libraryField libraryQuantityField">
                            Quantité
                            <input
                              value={line.quantity}
                              onChange={(event) =>
                                updateOuvrageLine(index, { quantity: event.target.value })
                              }
                              inputMode="decimal"
                              required
                            />
                          </label>
                          <div className="libraryLineValue">
                            <span>Vente HT ligne</span>
                            <strong>
                              {component
                                ? (() => {
                                    try {
                                      return formatMoney(
                                        Math.round(
                                          component.salePriceCents * parseDecimal(line.quantity),
                                        ),
                                      );
                                    } catch {
                                      return "—";
                                    }
                                  })()
                                : "—"}
                            </strong>
                          </div>
                          <button
                            className="iconButton libraryDeleteButton"
                            type="button"
                            onClick={() => removeOuvrageLine(index)}
                            disabled={editor.draft.components.length <= 1}
                            aria-label="Retirer ce composant"
                            title="Retirer"
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="libraryEditorFooter">
                <button
                  className="secondaryButton"
                  type="button"
                  onClick={() => void finishEditing()}
                  disabled={busy}
                >
                  Annuler
                </button>
                <button className="primaryButton" type="submit" disabled={busy}>
                  <Save size={15} aria-hidden="true" />
                  {busy ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            </form>
          </section>
        ) : null}
      </div>

      <style jsx global>{`
        .libraryPage {
          display: grid;
          gap: 14px;
        }
        .libraryHeader,
        .libraryToolbar,
        .libraryEditorHeader,
        .libraryCompositionHeader,
        .libraryEditorFooter {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
        }
        .libraryHeader {
          align-items: flex-start;
        }
        .libraryHeader h1,
        .libraryEditorHeader h2,
        .libraryCompositionHeader h3 {
          margin-bottom: 4px;
        }
        .libraryHeader p,
        .libraryCompositionHeader p {
          margin-bottom: 0;
        }
        .libraryReadOnlyBadge,
        .libraryVersion {
          display: inline-flex;
          align-items: center;
          min-height: 28px;
          padding: 4px 9px;
          border: 1px solid var(--border);
          border-radius: 999px;
          background: var(--surface-soft);
          color: var(--muted);
          font-size: 12px;
          font-weight: 650;
        }
        .libraryAlert {
          padding: 9px 12px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: white;
        }
        .libraryAlertError {
          border-color: #f0c5c5;
          background: #fff2f2;
          color: var(--danger);
        }
        .libraryAlertSuccess {
          border-color: #bfdfcd;
          background: #f1faf5;
          color: var(--success);
        }
        .libraryTabs {
          display: flex;
          align-items: center;
          gap: 6px;
          width: fit-content;
          padding: 4px;
          border: 1px solid var(--border);
          border-radius: 10px;
          background: white;
        }
        .libraryTabs button {
          min-height: 34px;
          padding: 6px 11px;
          border: 0;
          border-radius: 7px;
          background: transparent;
          color: var(--muted);
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-weight: 700;
        }
        .libraryTabs button > span {
          min-width: 21px;
          padding: 1px 6px;
          border-radius: 999px;
          background: var(--surface-soft);
          color: var(--muted);
          font-size: 11px;
          text-align: center;
        }
        .libraryTabs button.isActive {
          background: color-mix(in srgb, var(--accent) 10%, white);
          color: var(--accent);
        }
        .libraryTabs button.isActive > span {
          background: color-mix(in srgb, var(--accent) 14%, white);
          color: var(--accent);
        }
        .libraryWorkspace {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 14px;
          align-items: start;
        }
        .libraryWorkspace.hasEditor {
          grid-template-columns: minmax(0, 1.35fr) minmax(360px, 0.65fr);
        }
        .libraryListPanel,
        .libraryEditorPanel {
          padding: 14px;
        }
        .libraryListPanel {
          min-width: 0;
        }
        .libraryToolbar {
          margin-bottom: 12px;
        }
        .librarySearch {
          position: relative;
          width: min(420px, 100%);
        }
        .librarySearch svg {
          position: absolute;
          left: 11px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--muted);
          pointer-events: none;
        }
        .librarySearch input {
          padding-left: 34px;
        }
        .libraryTableWrap {
          overflow-x: auto;
          border: 1px solid var(--border);
          border-radius: 9px;
        }
        .libraryTable {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .libraryTable th,
        .libraryTable td {
          padding: 9px 10px;
          border-bottom: 1px solid var(--border);
          text-align: left;
          vertical-align: middle;
        }
        .libraryTable th {
          background: color-mix(in srgb, var(--accent) 3%, var(--surface-soft));
          color: #555865;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .libraryTable tbody tr:last-child td {
          border-bottom: 0;
        }
        .libraryTable tbody tr:hover td {
          background: color-mix(in srgb, var(--accent) 2.5%, white);
        }
        .libraryTable td strong,
        .libraryTable td small {
          display: block;
        }
        .libraryTable td small {
          max-width: 420px;
          margin-top: 2px;
          color: var(--muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .libraryTable .numeric {
          text-align: right;
          white-space: nowrap;
        }
        .librarySalePrice {
          font-weight: 750;
          color: var(--text);
        }
        .libraryActionsHeader {
          width: 78px;
          text-align: center !important;
        }
        .libraryActions {
          display: flex;
          justify-content: flex-end;
          gap: 4px;
          white-space: nowrap;
        }
        .libraryDeleteButton {
          color: var(--danger);
        }
        .libraryEmpty {
          min-height: 330px;
          display: grid;
          place-items: center;
          align-content: center;
          gap: 8px;
          padding: 28px;
          color: var(--muted);
          text-align: center;
        }
        .libraryEmpty strong {
          color: var(--text);
          font-size: 15px;
        }
        .libraryEmpty span {
          max-width: 430px;
        }
        .libraryEmpty button {
          margin-top: 6px;
        }
        .libraryEditorPanel {
          position: sticky;
          top: 88px;
          max-height: calc(100vh - 104px);
          overflow: auto;
        }
        .libraryEditorHeader {
          align-items: flex-start;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--border);
        }
        .libraryEditorEyebrow {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          margin-bottom: 5px;
          color: var(--accent);
          font-size: 11px;
          font-weight: 750;
        }
        .libraryEditorBody {
          display: grid;
          gap: 13px;
          padding: 14px 0;
        }
        .libraryField {
          display: grid;
          gap: 6px;
          color: #4d505b;
          font-weight: 650;
        }
        .libraryField textarea {
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
        .libraryField textarea:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 13%, transparent);
        }
        .libraryFormGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .libraryInputSuffix {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 30px;
          align-items: center;
          border: 1px solid #dcd8e4;
          border-radius: 8px;
          background: white;
          overflow: hidden;
        }
        .libraryInputSuffix:focus-within {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 13%, transparent);
        }
        .libraryInputSuffix input {
          border: 0 !important;
          border-radius: 0 !important;
          box-shadow: none !important;
        }
        .libraryInputSuffix span {
          color: var(--muted);
          text-align: center;
          font-weight: 700;
        }
        .libraryPricingHint {
          margin: -3px 0 0;
          padding: 8px 10px;
          border-radius: 8px;
          background: color-mix(in srgb, var(--accent) 5%, white);
          color: var(--muted);
          font-size: 12px;
        }
        .libraryCompositionHeader {
          align-items: flex-start;
          margin-top: 2px;
          padding-top: 13px;
          border-top: 1px solid var(--border);
        }
        .libraryComposition {
          display: grid;
          gap: 8px;
        }
        .libraryCompositionRow {
          display: grid;
          grid-template-columns: minmax(180px, 1fr) 92px 110px 32px;
          gap: 8px;
          align-items: end;
          padding: 9px;
          border: 1px solid var(--border);
          border-radius: 9px;
          background: var(--surface-soft);
        }
        .libraryQuantityField input {
          text-align: right;
        }
        .libraryLineValue {
          min-height: var(--papot-control-height);
          display: grid;
          align-content: center;
          gap: 1px;
          text-align: right;
        }
        .libraryLineValue span {
          color: var(--muted);
          font-size: 10px;
        }
        .libraryLineValue strong {
          font-size: 12px;
        }
        .libraryEditorFooter {
          position: sticky;
          bottom: -14px;
          justify-content: flex-end;
          padding: 12px 0 0;
          border-top: 1px solid var(--border);
          background: white;
        }
        @media (max-width: 1180px) {
          .libraryWorkspace.hasEditor {
            grid-template-columns: minmax(0, 1fr);
          }
          .libraryEditorPanel {
            position: static;
            max-height: none;
          }
        }
        @media (max-width: 760px) {
          .libraryHeader,
          .libraryToolbar {
            align-items: stretch;
            flex-direction: column;
          }
          .libraryTabs {
            width: 100%;
          }
          .libraryTabs button {
            flex: 1;
            justify-content: center;
          }
          .librarySearch {
            width: 100%;
          }
          .libraryFormGrid,
          .libraryCompositionRow {
            grid-template-columns: minmax(0, 1fr);
          }
          .libraryLineValue {
            text-align: left;
          }
        }
      `}</style>
    </div>
  );
}
