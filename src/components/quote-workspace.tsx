"use client";

import Link from "next/link";
import { BookOpen, Boxes, FileText, Layers3, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { clientDisplayName, parseClientsPayload, type ClientRecord } from "@/lib/clients/domain";
import type { LibraryPayload } from "@/lib/library/storage";
import {
  appendFreeQuoteLine,
  appendQuoteComment,
  appendQuoteSection,
  appendQuoteSubsection,
  createQuoteDraft,
  eurosInputToQuoteCents,
  quoteLineHtCents,
  quoteTotalHtCents,
  removeQuoteItemTree,
  replaceQuoteItem,
  updateQuoteLineQuantityInput,
} from "@/lib/quotes/draft";
import {
  insertLibraryComponentIntoQuote,
  insertLibraryOuvrageIntoQuote,
} from "@/lib/quotes/library-link";
import {
  parseQuoteModel,
  type QuoteItem,
  type QuoteLine,
  type QuoteModel,
} from "@/lib/quotes/model";

type ClientsResponse = {
  payload?: unknown;
  error?: string;
};

const moneyFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

const errorMessages: Record<string, string> = {
  MODULE_FORBIDDEN: "Vous n’avez pas accès au module Clients nécessaire pour choisir un client.",
  QUOTE_MODEL_INVALID: "Le devis contient une information obligatoire invalide ou vide.",
  QUOTE_ITEM_PARENT_NOT_FOUND: "La section parente de cet élément n’existe plus.",
  QUOTE_ITEM_PARENT_INVALID: "Cet élément ne peut pas être placé à cet endroit du devis.",
  QUOTE_LINE_FORMULA_INVALID: "La formule de quantité n’est pas valide.",
  QUOTE_LINE_FORMULA_MISMATCH: "La formule ne correspond pas à la quantité calculée.",
  QUOTE_QUANTITY_EXPRESSION_INVALID: "La quantité ou sa formule n’est pas valide.",
  QUOTE_QUANTITY_DIVISION_BY_ZERO: "La formule de quantité contient une division par zéro.",
  QUOTE_QUANTITY_INVALID: "La quantité doit être strictement positive.",
  QUOTE_MONEY_INVALID: "Le prix doit être un montant positif valide.",
  QUOTE_LIBRARY_COMPONENT_NOT_FOUND: "Ce composant n’existe plus dans la bibliothèque.",
  QUOTE_LIBRARY_OUVRAGE_NOT_FOUND: "Cet ouvrage n’existe plus dans la bibliothèque.",
};

function messageForError(error: unknown, fallback: string): string {
  const code = error instanceof Error ? error.message : String(error);
  return errorMessages[code] ?? fallback;
}

function todayLocal(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMoney(cents: number): string {
  return moneyFormatter.format(cents / 100);
}

function centsInput(cents: number | undefined): string {
  return ((cents ?? 0) / 100).toFixed(2).replace(".", ",");
}

function itemLabel(item: QuoteItem): string {
  if (item.kind === "SECTION") return item.title;
  if (item.kind === "SUBSECTION") return item.title;
  if (item.kind === "LINE") return item.description;
  return item.text;
}

function itemKindLabel(item: QuoteItem): string {
  if (item.kind === "SECTION") return "Section";
  if (item.kind === "SUBSECTION") return "Sous-section";
  if (item.kind === "COMMENT") return "Commentaire";
  if (!item.librarySource) return "Ligne libre";
  return item.librarySource.kind === "COMPONENT" ? "Composant" : "Ouvrage";
}

export function QuoteWorkspace({
  initialLibrary,
  canWrite,
}: {
  initialLibrary: LibraryPayload;
  canWrite: boolean;
}) {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [quote, setQuote] = useState<QuoteModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryTab, setLibraryTab] = useState<"components" | "ouvrages">("components");
  const [quantityInputs, setQuantityInputs] = useState<Record<string, string>>({});
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    async function loadClients() {
      try {
        const response = await fetch("/api/desktop/clients", { cache: "no-store" });
        const result = (await response.json()) as ClientsResponse;
        if (!response.ok) throw new Error(result.error ?? "CLIENTS_LOAD_FAILED");
        const payload = parseClientsPayload(result.payload);
        const activeClients = payload.clients
          .filter((client) => !client.isArchived)
          .sort((left, right) =>
            clientDisplayName(left).localeCompare(clientDisplayName(right), "fr"),
          );
        if (cancelled) return;
        setClients(activeClients);
        if (activeClients.length > 0) {
          const first = activeClients[0];
          setQuote(
            createQuoteDraft({
              id: crypto.randomUUID(),
              clientId: first.id,
              issueDate: todayLocal(),
              paymentTerms: first.paymentTerms,
            }),
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(messageForError(loadError, "Impossible de charger les clients."));
        }
      } finally {
        if (!cancelled) setClientsLoading(false);
      }
    }

    void loadClients();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === quote?.clientId) ?? null,
    [clients, quote?.clientId],
  );

  const sections = useMemo(
    () => quote?.items.filter((item) => item.kind === "SECTION") ?? [],
    [quote],
  );

  const quoteTotal = useMemo(() => {
    if (!quote) return 0;
    try {
      return quoteTotalHtCents(quote);
    } catch {
      return 0;
    }
  }, [quote]);

  const visibleComponents = useMemo(() => {
    const query = libraryQuery.trim().toLocaleLowerCase("fr-FR");
    return initialLibrary.components.filter((component) => {
      if (!query) return true;
      return `${component.name} ${component.description} ${component.unit}`
        .toLocaleLowerCase("fr-FR")
        .includes(query);
    });
  }, [initialLibrary.components, libraryQuery]);

  const visibleOuvrages = useMemo(() => {
    const query = libraryQuery.trim().toLocaleLowerCase("fr-FR");
    return initialLibrary.ouvrages.filter((ouvrage) => {
      if (!query) return true;
      return `${ouvrage.name} ${ouvrage.description}`.toLocaleLowerCase("fr-FR").includes(query);
    });
  }, [initialLibrary.ouvrages, libraryQuery]);

  function clearMessages() {
    setError(null);
    setNotice(null);
  }

  function resetTransientInputs(nextQuote: QuoteModel) {
    const quantities: Record<string, string> = {};
    const prices: Record<string, string> = {};
    for (const item of nextQuote.items) {
      if (item.kind !== "LINE") continue;
      quantities[item.id] = item.quantityFormula ?? String(item.quantity).replace(".", ",");
      prices[item.id] = centsInput(item.unitPriceCents);
    }
    setQuantityInputs(quantities);
    setPriceInputs(prices);
  }

  function newQuote(clientId = quote?.clientId ?? clients[0]?.id) {
    if (!clientId) return;
    const client = clients.find((candidate) => candidate.id === clientId);
    if (!client) return;
    clearMessages();
    const next = createQuoteDraft({
      id: crypto.randomUUID(),
      clientId: client.id,
      issueDate: todayLocal(),
      paymentTerms: client.paymentTerms,
    });
    setQuote(next);
    resetTransientInputs(next);
    setLibraryOpen(false);
  }

  function updateHeader(patch: Partial<QuoteModel>) {
    if (!quote || !canWrite) return;
    clearMessages();
    setQuote({ ...quote, ...patch });
  }

  function selectClient(clientId: string) {
    if (!quote || !canWrite) return;
    const client = clients.find((candidate) => candidate.id === clientId);
    if (!client) return;
    updateHeader({
      clientId,
      paymentTerms: client.paymentTerms.trim() || "À définir",
    });
  }

  function addSection() {
    if (!quote || !canWrite) return;
    try {
      const next = appendQuoteSection(quote, { id: crypto.randomUUID() });
      setQuote(next);
      clearMessages();
    } catch (addError) {
      setError(messageForError(addError, "Impossible d’ajouter la section."));
    }
  }

  function addSubsection() {
    if (!quote || !canWrite) return;
    const parent = [...quote.items].reverse().find((item) => item.kind === "SECTION");
    if (!parent || parent.kind !== "SECTION") {
      setError("Ajoute d’abord une section avant de créer une sous-section.");
      return;
    }
    try {
      const next = appendQuoteSubsection(quote, {
        id: crypto.randomUUID(),
        parentId: parent.id,
      });
      setQuote(next);
      clearMessages();
    } catch (addError) {
      setError(messageForError(addError, "Impossible d’ajouter la sous-section."));
    }
  }

  function addFreeLine() {
    if (!quote || !canWrite) return;
    try {
      const lineId = crypto.randomUUID();
      const next = appendFreeQuoteLine(quote, { id: lineId });
      setQuote(next);
      setQuantityInputs((current) => ({ ...current, [lineId]: "1" }));
      setPriceInputs((current) => ({ ...current, [lineId]: "0,00" }));
      clearMessages();
    } catch (addError) {
      setError(messageForError(addError, "Impossible d’ajouter la ligne."));
    }
  }

  function addComment() {
    if (!quote || !canWrite) return;
    try {
      const next = appendQuoteComment(quote, { id: crypto.randomUUID() });
      setQuote(next);
      clearMessages();
    } catch (addError) {
      setError(messageForError(addError, "Impossible d’ajouter le commentaire."));
    }
  }

  function updateItemRaw(itemId: string, patch: Record<string, unknown>) {
    if (!quote || !canWrite) return;
    clearMessages();
    setQuote({
      ...quote,
      items: quote.items.map((item) =>
        item.id === itemId ? ({ ...item, ...patch } as QuoteItem) : item,
      ),
    });
  }

  function normalizeRequiredText(item: QuoteItem) {
    if (!quote || !canWrite) return;
    const value = itemLabel(item).trim();
    if (value) return;
    const fallback =
      item.kind === "SECTION"
        ? "Nouvelle section"
        : item.kind === "SUBSECTION"
          ? "Nouvelle sous-section"
          : item.kind === "LINE"
            ? "Nouvelle ligne"
            : "Nouveau commentaire";
    updateItemRaw(
      item.id,
      item.kind === "COMMENT"
        ? { text: fallback }
        : item.kind === "LINE"
          ? { description: fallback }
          : { title: fallback },
    );
  }

  function deleteItem(itemId: string) {
    if (!quote || !canWrite) return;
    const item = quote.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    const hasChildren = quote.items.some(
      (candidate) => candidate.kind !== "SECTION" && candidate.parentId === itemId,
    );
    const prompt = hasChildren
      ? `Supprimer « ${itemLabel(item)} » et tous ses éléments ?`
      : `Supprimer « ${itemLabel(item)} » ?`;
    if (!window.confirm(prompt)) return;
    try {
      const next = removeQuoteItemTree(quote, itemId);
      setQuote(next);
      setQuantityInputs((current) => {
        const copy = { ...current };
        delete copy[itemId];
        return copy;
      });
      setPriceInputs((current) => {
        const copy = { ...current };
        delete copy[itemId];
        return copy;
      });
      clearMessages();
    } catch (deleteError) {
      setError(messageForError(deleteError, "Impossible de supprimer cet élément."));
    }
  }

  function commitQuantity(line: QuoteLine) {
    if (!quote || !canWrite) return;
    const input = quantityInputs[line.id] ?? line.quantityFormula ?? String(line.quantity);
    try {
      const next = updateQuoteLineQuantityInput(quote, line.id, input);
      setQuote(next);
      const updated = next.items.find((item) => item.id === line.id);
      if (updated?.kind === "LINE") {
        setQuantityInputs((current) => ({
          ...current,
          [line.id]: updated.quantityFormula ?? String(updated.quantity).replace(".", ","),
        }));
      }
      clearMessages();
    } catch (quantityError) {
      setError(messageForError(quantityError, "La quantité n’est pas valide."));
      setQuantityInputs((current) => ({
        ...current,
        [line.id]: line.quantityFormula ?? String(line.quantity).replace(".", ","),
      }));
    }
  }

  function commitPrice(line: QuoteLine) {
    if (!quote || !canWrite) return;
    const input = priceInputs[line.id] ?? centsInput(line.unitPriceCents);
    try {
      const unitPriceCents = eurosInputToQuoteCents(input);
      const next = replaceQuoteItem(quote, { ...line, unitPriceCents });
      setQuote(next);
      setPriceInputs((current) => ({ ...current, [line.id]: centsInput(unitPriceCents) }));
      clearMessages();
    } catch (priceError) {
      setError(messageForError(priceError, "Le prix de vente HT n’est pas valide."));
      setPriceInputs((current) => ({ ...current, [line.id]: centsInput(line.unitPriceCents) }));
    }
  }

  function addLibraryComponent(componentId: string) {
    if (!quote || !canWrite) return;
    try {
      const lineId = crypto.randomUUID();
      const next = insertLibraryComponentIntoQuote({
        quote,
        library: initialLibrary,
        componentId,
        lineId,
      });
      setQuote(next);
      const line = next.items.find((item) => item.id === lineId);
      if (line?.kind === "LINE") {
        setQuantityInputs((current) => ({ ...current, [lineId]: "1" }));
        setPriceInputs((current) => ({ ...current, [lineId]: centsInput(line.unitPriceCents) }));
      }
      setNotice("Composant copié dans le devis. Sa valeur est maintenant figée dans ce brouillon.");
      setError(null);
      setLibraryOpen(false);
    } catch (insertError) {
      setError(messageForError(insertError, "Impossible d’insérer ce composant."));
    }
  }

  function addLibraryOuvrage(ouvrageId: string) {
    if (!quote || !canWrite) return;
    try {
      const lineId = crypto.randomUUID();
      const next = insertLibraryOuvrageIntoQuote({
        quote,
        library: initialLibrary,
        ouvrageId,
        lineId,
      });
      setQuote(next);
      const line = next.items.find((item) => item.id === lineId);
      if (line?.kind === "LINE") {
        setQuantityInputs((current) => ({ ...current, [lineId]: "1" }));
        setPriceInputs((current) => ({ ...current, [lineId]: centsInput(line.unitPriceCents) }));
      }
      setNotice("Ouvrage copié dans le devis avec sa composition et ses prix figés.");
      setError(null);
      setLibraryOpen(false);
    } catch (insertError) {
      setError(messageForError(insertError, "Impossible d’insérer cet ouvrage."));
    }
  }

  function validateDraft() {
    if (!quote) return;
    try {
      const valid = parseQuoteModel(quote);
      setQuote(valid);
      resetTransientInputs(valid);
      setNotice("Brouillon valide. Le moteur Devis accepte toutes les informations affichées.");
      setError(null);
    } catch (validationError) {
      setError(messageForError(validationError, "Le brouillon contient encore une erreur."));
      setNotice(null);
    }
  }

  if (clientsLoading) {
    return (
      <div className="quotePage">
        <header className="quoteHeader">
          <div>
            <h1>Devis</h1>
            <p className="muted">Chargement du premier éditeur natif…</p>
          </div>
        </header>
        <section className="panel quoteLoading">
          Chargement des clients et de la bibliothèque…
        </section>
      </div>
    );
  }

  if (clients.length === 0 || !quote) {
    return (
      <div className="quotePage">
        <header className="quoteHeader">
          <div>
            <h1>Devis</h1>
            <p className="muted">Premier éditeur natif de chiffrage PAPOT.</p>
          </div>
        </header>
        {error ? <div className="quoteAlert quoteAlertError">{error}</div> : null}
        <section className="panel quoteNoClient">
          <FileText size={30} aria-hidden="true" />
          <h2>Aucun client disponible</h2>
          <p className="muted">Crée au moins un client actif avant de préparer un devis.</p>
          <Link className="primaryButton" href="/clients">
            Ouvrir les clients
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="quotePage">
      <header className="quoteHeader">
        <div>
          <div className="quoteTitleLine">
            <h1>Devis</h1>
            <span className="quoteDraftBadge">Brouillon non enregistré</span>
          </div>
          <p className="muted">
            Construis le devis natif. Le stockage partagé viendra dans une brique dédiée.
          </p>
        </div>
        <div className="quoteHeaderActions">
          <button
            className="secondaryButton"
            type="button"
            onClick={() => newQuote()}
            disabled={!canWrite}
          >
            <Plus size={15} aria-hidden="true" />
            Nouveau devis
          </button>
          <button className="primaryButton" type="button" onClick={validateDraft}>
            <FileText size={15} aria-hidden="true" />
            Contrôler le brouillon
          </button>
        </div>
      </header>

      {!canWrite ? (
        <div className="quoteAlert">Lecture seule : le droit Devis / Chiffrage est en lecture.</div>
      ) : null}
      {error ? <div className="quoteAlert quoteAlertError">{error}</div> : null}
      {notice ? <div className="quoteAlert quoteAlertSuccess">{notice}</div> : null}

      <section className="panel quoteIdentityPanel">
        <div className="quoteIdentityGrid">
          <label className="quoteField quoteClientField">
            Client
            <select
              value={quote.clientId}
              onChange={(event) => selectClient(event.target.value)}
              disabled={!canWrite}
            >
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {clientDisplayName(client)}
                </option>
              ))}
            </select>
          </label>
          <label className="quoteField quoteSubjectField">
            Objet du devis
            <input
              value={quote.subject}
              onChange={(event) => updateHeader({ subject: event.target.value })}
              onBlur={() => {
                if (!quote.subject.trim()) updateHeader({ subject: "Nouveau devis" });
              }}
              maxLength={240}
              disabled={!canWrite}
            />
          </label>
          <label className="quoteField">
            Date
            <input
              type="date"
              value={quote.issueDate}
              onChange={(event) => updateHeader({ issueDate: event.target.value })}
              disabled={!canWrite}
            />
          </label>
          <label className="quoteField quoteValidityField">
            Validité
            <div className="quoteInputSuffix">
              <input
                type="number"
                min={1}
                max={365}
                value={quote.validityDays}
                onChange={(event) => updateHeader({ validityDays: Number(event.target.value) })}
                disabled={!canWrite}
              />
              <span>jours</span>
            </div>
          </label>
          <label className="quoteField quoteTermsField">
            Conditions de règlement
            <input
              value={quote.paymentTerms}
              onChange={(event) => updateHeader({ paymentTerms: event.target.value })}
              onBlur={() => {
                if (!quote.paymentTerms.trim()) updateHeader({ paymentTerms: "À définir" });
              }}
              maxLength={1000}
              disabled={!canWrite}
            />
          </label>
        </div>
        {selectedClient ? (
          <div className="quoteClientHint">
            <strong>{clientDisplayName(selectedClient)}</strong>
            <span>
              {[selectedClient.addressLine1, selectedClient.postalCode, selectedClient.city]
                .filter(Boolean)
                .join(" · ") || "Adresse à compléter"}
            </span>
          </div>
        ) : null}
      </section>

      <div className="quoteWorkspace">
        <section className="panel quoteEditorPanel">
          <div className="quoteEditorToolbar">
            <div>
              <h2>Contenu du devis</h2>
              <p className="muted">
                Sections, lignes libres, commentaires et éléments de bibliothèque.
              </p>
            </div>
            <div className="quoteAddActions">
              <button
                className="secondaryButton"
                type="button"
                onClick={addSection}
                disabled={!canWrite}
              >
                <Plus size={14} aria-hidden="true" /> Section
              </button>
              <button
                className="secondaryButton"
                type="button"
                onClick={addSubsection}
                disabled={!canWrite || sections.length === 0}
              >
                <Plus size={14} aria-hidden="true" /> Sous-section
              </button>
              <button
                className="secondaryButton"
                type="button"
                onClick={addFreeLine}
                disabled={!canWrite}
              >
                <Plus size={14} aria-hidden="true" /> Ligne libre
              </button>
              <button
                className="secondaryButton"
                type="button"
                onClick={addComment}
                disabled={!canWrite}
              >
                <Plus size={14} aria-hidden="true" /> Commentaire
              </button>
              <button
                className="primaryButton"
                type="button"
                onClick={() => setLibraryOpen(true)}
                disabled={!canWrite}
              >
                <BookOpen size={14} aria-hidden="true" /> Bibliothèque
              </button>
            </div>
          </div>

          {quote.items.length === 0 ? (
            <div className="quoteEmpty">
              <FileText size={30} aria-hidden="true" />
              <strong>Le devis est vide</strong>
              <span>Ajoute une section, une ligne libre ou un élément de la bibliothèque.</span>
              {canWrite ? (
                <button
                  className="primaryButton"
                  type="button"
                  onClick={() => setLibraryOpen(true)}
                >
                  <BookOpen size={15} aria-hidden="true" /> Choisir dans la bibliothèque
                </button>
              ) : null}
            </div>
          ) : (
            <div className="quoteItems">
              <div className="quoteTableHead">
                <span>Désignation</span>
                <span>Unité</span>
                <span>Quantité</span>
                <span>Prix unitaire HT</span>
                <span>Total HT</span>
                <span />
              </div>
              {quote.items.map((item) => {
                const depth =
                  item.kind === "SUBSECTION"
                    ? 1
                    : item.kind === "LINE" || item.kind === "COMMENT"
                      ? item.parentId
                        ? 1
                        : 0
                      : 0;
                if (item.kind === "SECTION" || item.kind === "SUBSECTION") {
                  return (
                    <div className={`quoteItem quoteGroup quoteDepth${depth}`} key={item.id}>
                      <div className="quoteGroupMain">
                        <span className="quoteKindBadge">{itemKindLabel(item)}</span>
                        <input
                          value={item.title}
                          onChange={(event) =>
                            updateItemRaw(item.id, { title: event.target.value })
                          }
                          onBlur={() => normalizeRequiredText(item)}
                          maxLength={500}
                          disabled={!canWrite}
                          aria-label={`${itemKindLabel(item)} : titre`}
                        />
                      </div>
                      <span className="quoteGroupRule" />
                      <button
                        className="iconButton quoteDeleteButton"
                        type="button"
                        onClick={() => deleteItem(item.id)}
                        disabled={!canWrite}
                        aria-label={`Supprimer ${item.title}`}
                        title="Supprimer"
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>
                  );
                }

                if (item.kind === "COMMENT") {
                  return (
                    <div className={`quoteItem quoteComment quoteDepth${depth}`} key={item.id}>
                      <div className="quoteCommentMain">
                        <span className="quoteKindBadge">Commentaire</span>
                        <textarea
                          value={item.text}
                          onChange={(event) => updateItemRaw(item.id, { text: event.target.value })}
                          onBlur={() => normalizeRequiredText(item)}
                          rows={2}
                          maxLength={4000}
                          disabled={!canWrite}
                        />
                      </div>
                      <button
                        className="iconButton quoteDeleteButton"
                        type="button"
                        onClick={() => deleteItem(item.id)}
                        disabled={!canWrite}
                        aria-label="Supprimer le commentaire"
                        title="Supprimer"
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>
                  );
                }

                const quantityValue =
                  quantityInputs[item.id] ??
                  item.quantityFormula ??
                  String(item.quantity).replace(".", ",");
                const priceValue = priceInputs[item.id] ?? centsInput(item.unitPriceCents);
                return (
                  <div className={`quoteItem quoteLine quoteDepth${depth}`} key={item.id}>
                    <div className="quoteLineDescription">
                      <span className={`quoteKindBadge${item.librarySource ? " fromLibrary" : ""}`}>
                        {itemKindLabel(item)}
                      </span>
                      <input
                        value={item.description}
                        onChange={(event) =>
                          updateItemRaw(item.id, { description: event.target.value })
                        }
                        onBlur={() => normalizeRequiredText(item)}
                        maxLength={4000}
                        disabled={!canWrite}
                        aria-label="Désignation"
                      />
                      {item.librarySource ? (
                        <small>Copie figée depuis la bibliothèque</small>
                      ) : null}
                    </div>
                    <input
                      className="quoteCompactInput"
                      value={item.unit}
                      onChange={(event) => updateItemRaw(item.id, { unit: event.target.value })}
                      maxLength={40}
                      disabled={!canWrite}
                      aria-label="Unité"
                    />
                    <input
                      className="quoteCompactInput"
                      value={quantityValue}
                      onChange={(event) =>
                        setQuantityInputs((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))
                      }
                      onBlur={() => commitQuantity(item)}
                      inputMode="decimal"
                      disabled={!canWrite}
                      aria-label="Quantité ou formule"
                      title="Une formule telle que 2+6+4+9 est acceptée"
                    />
                    <div className="quotePriceInput">
                      <input
                        className="quoteCompactInput"
                        value={priceValue}
                        onChange={(event) =>
                          setPriceInputs((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                        onBlur={() => commitPrice(item)}
                        inputMode="decimal"
                        disabled={!canWrite}
                        aria-label="Prix unitaire HT"
                      />
                      <span>€</span>
                    </div>
                    <strong className="quoteLineTotal">
                      {formatMoney(quoteLineHtCents(item))}
                    </strong>
                    <button
                      className="iconButton quoteDeleteButton"
                      type="button"
                      onClick={() => deleteItem(item.id)}
                      disabled={!canWrite}
                      aria-label={`Supprimer ${item.description}`}
                      title="Supprimer"
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="quoteSummary">
          <section className="panel quoteSummaryCard">
            <span className="quoteSummaryLabel">Total HT provisoire</span>
            <strong>{formatMoney(quoteTotal)}</strong>
            <div className="quoteSummaryStats">
              <span>
                <b>{quote.items.filter((item) => item.kind === "LINE").length}</b> ligne(s)
              </span>
              <span>
                <b>{sections.length}</b> section(s)
              </span>
            </div>
          </section>
          <section className="panel quoteScopeCard">
            <strong>Dans cette première version</strong>
            <p>Le devis est interactif mais volontairement non enregistré.</p>
            <p>
              TVA, remises, déplacement avancé des lignes, PDF et envoi viendront dans les briques
              suivantes.
            </p>
          </section>
        </aside>
      </div>

      {libraryOpen ? (
        <div
          className="quoteLibraryBackdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLibraryOpen(false);
          }}
        >
          <section
            className="quoteLibraryPicker"
            role="dialog"
            aria-modal="true"
            aria-label="Ajouter depuis la bibliothèque"
          >
            <div className="quoteLibraryHeader">
              <div>
                <h2>Ajouter depuis la bibliothèque</h2>
                <p className="muted">L’élément sera copié et figé dans le devis.</p>
              </div>
              <button
                className="iconButton"
                type="button"
                onClick={() => setLibraryOpen(false)}
                aria-label="Fermer la bibliothèque"
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>
            <div className="quoteLibraryTabs">
              <button
                type="button"
                className={libraryTab === "components" ? "isActive" : undefined}
                onClick={() => setLibraryTab("components")}
              >
                <Boxes size={15} aria-hidden="true" /> Composants{" "}
                <span>{initialLibrary.components.length}</span>
              </button>
              <button
                type="button"
                className={libraryTab === "ouvrages" ? "isActive" : undefined}
                onClick={() => setLibraryTab("ouvrages")}
              >
                <Layers3 size={15} aria-hidden="true" /> Ouvrages{" "}
                <span>{initialLibrary.ouvrages.length}</span>
              </button>
            </div>
            <label className="quoteLibrarySearch">
              <Search size={15} aria-hidden="true" />
              <input
                value={libraryQuery}
                onChange={(event) => setLibraryQuery(event.target.value)}
                placeholder="Rechercher…"
                autoFocus
              />
            </label>
            <div className="quoteLibraryResults">
              {libraryTab === "components" ? (
                visibleComponents.length === 0 ? (
                  <div className="quoteLibraryEmpty">Aucun composant trouvé.</div>
                ) : (
                  visibleComponents.map((component) => (
                    <button
                      className="quoteLibraryRow"
                      type="button"
                      key={component.id}
                      onClick={() => addLibraryComponent(component.id)}
                    >
                      <span>
                        <strong>{component.name}</strong>
                        <small>{component.description || component.unit}</small>
                      </span>
                      <span>{component.unit}</span>
                      <strong>{formatMoney(component.salePriceCents)}</strong>
                      <Plus size={16} aria-hidden="true" />
                    </button>
                  ))
                )
              ) : visibleOuvrages.length === 0 ? (
                <div className="quoteLibraryEmpty">Aucun ouvrage trouvé.</div>
              ) : (
                visibleOuvrages.map((ouvrage) => {
                  const salePrice = ouvrage.components.reduce((total, line) => {
                    const component = initialLibrary.components.find(
                      (candidate) => candidate.id === line.componentId,
                    );
                    return total + Math.round((component?.salePriceCents ?? 0) * line.quantity);
                  }, 0);
                  return (
                    <button
                      className="quoteLibraryRow"
                      type="button"
                      key={ouvrage.id}
                      onClick={() => addLibraryOuvrage(ouvrage.id)}
                    >
                      <span>
                        <strong>{ouvrage.name}</strong>
                        <small>{ouvrage.components.length} composant(s)</small>
                      </span>
                      <span>Ouvrage</span>
                      <strong>{formatMoney(salePrice)}</strong>
                      <Plus size={16} aria-hidden="true" />
                    </button>
                  );
                })
              )}
            </div>
          </section>
        </div>
      ) : null}

      <style jsx global>{`
        .quotePage {
          display: grid;
          gap: 14px;
        }
        .quoteHeader,
        .quoteTitleLine,
        .quoteHeaderActions,
        .quoteEditorToolbar,
        .quoteAddActions,
        .quoteClientHint,
        .quoteGroupMain,
        .quoteLibraryHeader,
        .quoteLibraryTabs,
        .quoteLibrarySearch,
        .quoteSummaryStats {
          display: flex;
          align-items: center;
        }
        .quoteHeader,
        .quoteEditorToolbar,
        .quoteLibraryHeader {
          justify-content: space-between;
          gap: 18px;
        }
        .quoteHeader h1,
        .quoteEditorToolbar h2,
        .quoteLibraryHeader h2 {
          margin-bottom: 4px;
        }
        .quoteTitleLine {
          gap: 10px;
          align-items: baseline;
        }
        .quoteDraftBadge {
          padding: 5px 8px;
          border-radius: 999px;
          background: #fff2dd;
          color: #955c12;
          font-size: 11px;
          font-weight: 800;
        }
        .quoteHeaderActions,
        .quoteAddActions {
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .quoteAlert {
          padding: 11px 13px;
          border: 1px solid #ddd7f4;
          border-radius: 9px;
          background: #f8f6ff;
          color: #554c82;
          font-size: 13px;
        }
        .quoteAlertError {
          border-color: #f0caca;
          background: #fff5f5;
          color: #a33737;
        }
        .quoteAlertSuccess {
          border-color: #bfe4cf;
          background: #f1fbf5;
          color: #28764b;
        }
        .quoteIdentityPanel {
          padding: 16px 18px;
        }
        .quoteIdentityGrid {
          display: grid;
          grid-template-columns: minmax(210px, 1.1fr) minmax(280px, 2fr) 150px 120px minmax(
              240px,
              1.4fr
            );
          gap: 12px;
          align-items: end;
        }
        .quoteField {
          display: grid;
          gap: 6px;
          color: #4d505b;
          font-size: 11px;
          font-weight: 800;
        }
        .quoteField input,
        .quoteField select,
        .quoteCompactInput,
        .quoteGroup input,
        .quoteComment textarea,
        .quoteLibrarySearch input {
          min-height: 38px;
          border: 1px solid #ded9e8;
          border-radius: 8px;
          background: #fff;
          outline: none;
        }
        .quoteField input,
        .quoteField select,
        .quoteGroup input,
        .quoteComment textarea {
          padding: 0 10px;
        }
        .quoteField input:focus,
        .quoteField select:focus,
        .quoteCompactInput:focus,
        .quoteGroup input:focus,
        .quoteComment textarea:focus,
        .quoteLibrarySearch input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent);
        }
        .quoteInputSuffix,
        .quotePriceInput {
          position: relative;
        }
        .quoteInputSuffix span,
        .quotePriceInput span {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--muted);
          font-size: 11px;
          pointer-events: none;
        }
        .quoteInputSuffix input,
        .quotePriceInput input {
          padding-right: 38px;
        }
        .quoteClientHint {
          gap: 9px;
          margin-top: 10px;
          color: var(--muted);
          font-size: 12px;
        }
        .quoteClientHint strong {
          color: #454856;
        }
        .quoteWorkspace {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 245px;
          gap: 14px;
          align-items: start;
        }
        .quoteEditorPanel {
          padding: 0;
          overflow: hidden;
        }
        .quoteEditorToolbar {
          padding: 15px 16px;
          border-bottom: 1px solid var(--border);
        }
        .quoteEditorToolbar p,
        .quoteLibraryHeader p {
          margin: 0;
          font-size: 12px;
        }
        .quoteAddActions .primaryButton,
        .quoteAddActions .secondaryButton {
          min-height: 34px;
          padding: 0 10px;
          font-size: 12px;
        }
        .quoteEmpty,
        .quoteNoClient,
        .quoteLoading {
          min-height: 260px;
          display: grid;
          place-items: center;
          align-content: center;
          gap: 9px;
          text-align: center;
          color: var(--muted);
        }
        .quoteEmpty strong,
        .quoteNoClient h2 {
          color: var(--text);
        }
        .quoteEmpty span {
          font-size: 13px;
        }
        .quoteItems {
          min-width: 780px;
          overflow-x: auto;
        }
        .quoteTableHead,
        .quoteLine {
          display: grid;
          grid-template-columns: minmax(300px, 1fr) 82px 110px 130px 120px 38px;
          gap: 8px;
          align-items: center;
        }
        .quoteTableHead {
          min-height: 38px;
          padding: 0 12px;
          background: #faf9fd;
          color: #8a8697;
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .quoteItem {
          border-top: 1px solid #f0edf5;
        }
        .quoteGroup {
          min-height: 48px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(30px, 0.35fr) 38px;
          gap: 10px;
          align-items: center;
          padding: 7px 12px;
          background: color-mix(in srgb, var(--accent) 5%, white);
        }
        .quoteDepth1 {
          padding-left: 30px;
        }
        .quoteGroupMain {
          gap: 9px;
          min-width: 0;
        }
        .quoteGroupMain input {
          width: min(480px, 100%);
          min-height: 32px;
          background: transparent;
          border-color: transparent;
          font-weight: 800;
        }
        .quoteGroupMain input:hover,
        .quoteGroupMain input:focus {
          background: #fff;
          border-color: #ded9e8;
        }
        .quoteGroupRule {
          height: 1px;
          background: color-mix(in srgb, var(--accent) 18%, var(--border));
        }
        .quoteKindBadge {
          flex: 0 0 auto;
          display: inline-flex;
          width: max-content;
          padding: 4px 7px;
          border-radius: 6px;
          background: #f1eff6;
          color: #696474;
          font-size: 10px;
          font-weight: 800;
        }
        .quoteKindBadge.fromLibrary {
          background: color-mix(in srgb, var(--accent) 12%, white);
          color: var(--accent);
        }
        .quoteLine {
          min-height: 64px;
          padding: 8px 12px;
          background: #fff;
        }
        .quoteLineDescription {
          min-width: 0;
          display: grid;
          grid-template-columns: max-content minmax(0, 1fr);
          gap: 5px 8px;
          align-items: center;
        }
        .quoteLineDescription input {
          width: 100%;
          min-height: 36px;
          padding: 0 9px;
          border: 1px solid transparent;
          border-radius: 7px;
          outline: none;
          font-weight: 650;
        }
        .quoteLineDescription input:hover,
        .quoteLineDescription input:focus {
          border-color: #ded9e8;
          background: #fff;
        }
        .quoteLineDescription small {
          grid-column: 2;
          color: var(--muted);
          font-size: 10px;
        }
        .quoteCompactInput {
          width: 100%;
          min-height: 34px;
          padding: 0 8px;
          font-size: 12px;
        }
        .quoteLineTotal {
          text-align: right;
          font-size: 13px;
        }
        .quoteDeleteButton {
          color: #a25a5a;
        }
        .quoteComment {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 38px;
          gap: 10px;
          padding: 9px 12px;
          background: #fcfbfe;
        }
        .quoteCommentMain {
          display: grid;
          grid-template-columns: max-content minmax(0, 1fr);
          gap: 8px;
          align-items: start;
        }
        .quoteComment textarea {
          width: 100%;
          padding: 8px 10px;
          resize: vertical;
        }
        .quoteSummary {
          display: grid;
          gap: 12px;
          position: sticky;
          top: 82px;
        }
        .quoteSummaryCard,
        .quoteScopeCard {
          padding: 16px;
        }
        .quoteSummaryLabel {
          display: block;
          color: var(--muted);
          font-size: 11px;
          font-weight: 750;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .quoteSummaryCard > strong {
          display: block;
          margin: 6px 0 12px;
          color: var(--accent);
          font-size: 26px;
          letter-spacing: -0.03em;
        }
        .quoteSummaryStats {
          justify-content: space-between;
          gap: 10px;
          padding-top: 10px;
          border-top: 1px solid var(--border);
          color: var(--muted);
          font-size: 11px;
        }
        .quoteScopeCard strong {
          display: block;
          margin-bottom: 8px;
          font-size: 13px;
        }
        .quoteScopeCard p {
          margin: 0 0 8px;
          color: var(--muted);
          font-size: 11px;
          line-height: 1.45;
        }
        .quoteLibraryBackdrop {
          position: fixed;
          inset: 0;
          z-index: 50;
          display: grid;
          place-items: center;
          padding: 28px;
          background: rgb(31 24 55 / 0.28);
          backdrop-filter: blur(2px);
        }
        .quoteLibraryPicker {
          width: min(760px, 96vw);
          max-height: min(720px, 88vh);
          display: grid;
          grid-template-rows: auto auto auto minmax(0, 1fr);
          overflow: hidden;
          border: 1px solid #ded9ee;
          border-radius: 14px;
          background: #fff;
          box-shadow: 0 24px 80px rgb(40 30 75 / 0.25);
        }
        .quoteLibraryHeader {
          padding: 16px 18px;
          border-bottom: 1px solid var(--border);
        }
        .quoteLibraryTabs {
          gap: 6px;
          padding: 10px 18px 0;
        }
        .quoteLibraryTabs button {
          min-height: 34px;
          padding: 0 11px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1px solid #ddd9e7;
          border-radius: 8px;
          background: #fff;
          color: #595c68;
          font-size: 12px;
          font-weight: 750;
        }
        .quoteLibraryTabs button.isActive {
          border-color: color-mix(in srgb, var(--accent) 45%, white);
          background: color-mix(in srgb, var(--accent) 10%, white);
          color: var(--accent);
        }
        .quoteLibraryTabs button span {
          min-width: 20px;
          padding: 2px 5px;
          border-radius: 999px;
          background: #f0edf8;
          text-align: center;
          font-size: 10px;
        }
        .quoteLibrarySearch {
          gap: 7px;
          margin: 10px 18px;
          padding: 0 10px;
          border: 1px solid #ded9e8;
          border-radius: 8px;
          color: var(--muted);
        }
        .quoteLibrarySearch input {
          flex: 1;
          min-height: 38px;
          padding: 0;
          border: 0;
          box-shadow: none;
        }
        .quoteLibraryResults {
          overflow-y: auto;
          padding: 0 18px 18px;
        }
        .quoteLibraryRow {
          width: 100%;
          min-height: 58px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 90px 110px 28px;
          gap: 10px;
          align-items: center;
          padding: 8px 10px;
          border: 0;
          border-top: 1px solid #f0edf5;
          background: #fff;
          color: var(--text);
          text-align: left;
        }
        .quoteLibraryRow:hover {
          background: #faf9fd;
        }
        .quoteLibraryRow > span:first-child {
          min-width: 0;
          display: grid;
          gap: 3px;
        }
        .quoteLibraryRow small {
          overflow: hidden;
          color: var(--muted);
          font-size: 11px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .quoteLibraryRow > span:nth-child(2) {
          color: var(--muted);
          font-size: 11px;
        }
        .quoteLibraryRow > strong {
          text-align: right;
          font-size: 12px;
        }
        .quoteLibraryRow svg {
          color: var(--accent);
        }
        .quoteLibraryEmpty {
          min-height: 180px;
          display: grid;
          place-items: center;
          color: var(--muted);
          font-size: 13px;
        }
        @media (max-width: 1180px) {
          .quoteIdentityGrid {
            grid-template-columns: 1fr 1.5fr 140px 120px;
          }
          .quoteTermsField {
            grid-column: 1 / -1;
          }
          .quoteWorkspace {
            grid-template-columns: minmax(0, 1fr);
          }
          .quoteSummary {
            grid-template-columns: 1fr 1fr;
            position: static;
          }
        }
        @media (max-width: 900px) {
          .quoteHeader,
          .quoteEditorToolbar {
            align-items: flex-start;
            flex-direction: column;
          }
          .quoteHeaderActions,
          .quoteAddActions {
            justify-content: flex-start;
          }
          .quoteIdentityGrid {
            grid-template-columns: 1fr 1fr;
          }
          .quoteClientField,
          .quoteSubjectField,
          .quoteTermsField {
            grid-column: 1 / -1;
          }
          .quoteSummary {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
