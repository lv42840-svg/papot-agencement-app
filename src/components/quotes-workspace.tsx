"use client";

import Link from "next/link";
import { Plus, Save, Search, Trash2, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { clientDisplayName, type ClientRecord, type ClientsPayload } from "@/lib/clients/domain";
import type { CommercialCase, CommercialPayload } from "@/lib/commercial/domain";
import {
  applySequentialQuoteDiscounts,
  parseQuoteQuantityInput,
  percentageAmountCents,
} from "@/lib/quotes/domain";
import type { QuoteRecord, QuotesPayload, QuoteVatRate } from "@/lib/quotes/model";

type QuotesSnapshot = {
  payload: QuotesPayload;
  canWrite: boolean;
  focusQuoteId?: string;
};

type ClientsSnapshot = { payload: ClientsPayload };
type CommercialSnapshot = { payload: CommercialPayload };

type DraftSection = {
  id: string;
  kind: "SECTION";
  title: string;
  discountPercent: string;
};

type DraftSubsection = {
  id: string;
  kind: "SUBSECTION";
  parentId: string;
  title: string;
  discountPercent: string;
};

type DraftLine = {
  id: string;
  kind: "LINE";
  parentId: string;
  description: string;
  unit: string;
  quantityInput: string;
  unitPriceEuros: string;
  discountPercent: string;
  vatRatePercent: QuoteVatRate;
};

type DraftComment = {
  id: string;
  kind: "COMMENT";
  parentId: string;
  text: string;
};

type DraftItem = DraftSection | DraftSubsection | DraftLine | DraftComment;

type QuoteDraft = {
  clientId: string;
  commercialCaseId: string;
  subject: string;
  issueDate: string;
  validityDays: string;
  paymentTerms: string;
  globalDiscountPercent: string;
  notes: string;
  items: DraftItem[];
};

type NewQuoteDraft = {
  clientId: string;
  commercialCaseId: string;
  subject: string;
};

type LineAmounts = {
  valid: boolean;
  quantity: number;
  netCents: number;
  vatCents: number;
  ttcCents: number;
};

const PAYMENT_TERMS = [
  "Comptant",
  "À réception de facture",
  "30 jours date de facture",
  "30 jours fin de mois",
  "45 jours date de facture",
  "45 jours fin de mois",
  "60 jours date de facture",
  "60 jours fin de mois",
] as const;

const STATUS_LABELS: Record<QuoteRecord["status"], string> = {
  DRAFT: "Brouillon",
  SENT: "Finalisé",
  ACCEPTED: "Accepté",
  REJECTED: "Refusé",
  CANCELLED: "Annulé",
};

const ERROR_MESSAGES: Record<string, string> = {
  MODULE_FORBIDDEN: "Vous n’avez pas accès au module Devis.",
  QUOTES_LOCKED:
    "Le fichier devis est modifié sur un autre poste. Réessaie dans quelques secondes.",
  QUOTES_VERSION_CONFLICT: "Le fichier devis a changé sur un autre poste. Il a été rechargé.",
  QUOTES_REQUEST_INVALID: "Certaines informations du devis sont invalides.",
  QUOTE_NOT_FOUND: "Ce devis n’existe plus.",
  QUOTE_NOT_DRAFT: "Ce devis est finalisé et ne peut plus être modifié.",
  QUOTE_EMPTY: "Ajoute au moins une ligne chiffrée avant de finaliser le devis.",
  QUOTE_PAYMENT_TERMS_REQUIRED: "Les conditions de règlement sont obligatoires avant finalisation.",
  QUOTE_CLIENT_INCOMPLETE:
    "La fiche client doit être complète avant finalisation : identité, adresse, CP, ville, conditions de règlement et SIRET pour les professionnels.",
  QUOTE_COMMERCIAL_CLIENT_MISMATCH:
    "L’affaire commerciale sélectionnée n’appartient pas au même client.",
  CLIENT_ARCHIVED: "Le client sélectionné est archivé.",
  CLIENT_NOT_FOUND: "Le client sélectionné n’existe plus.",
  COMMERCIAL_CASE_NOT_FOUND: "L’affaire commerciale sélectionnée n’existe plus.",
};

function euro(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

function decimal(value: string, fallback = 0): number {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function priceCents(value: string): number {
  return Math.max(0, Math.round(decimal(value) * 100));
}

function percent(value: string): number {
  return Math.min(100, Math.max(0, decimal(value)));
}

function moneyInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function errorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? "Le module Devis a rencontré une erreur.";
}

function quoteToDraft(quote: QuoteRecord): QuoteDraft {
  return {
    clientId: quote.clientId,
    commercialCaseId: quote.commercialCaseId ?? "",
    subject: quote.subject,
    issueDate: quote.issueDate,
    validityDays: String(quote.validityDays),
    paymentTerms: quote.paymentTerms,
    globalDiscountPercent: String(quote.globalDiscountPercent),
    notes: quote.notes,
    items: quote.items.map((item): DraftItem => {
      if (item.kind === "SECTION") {
        return {
          id: item.id,
          kind: "SECTION",
          title: item.title,
          discountPercent: String(item.discountPercent),
        };
      }
      if (item.kind === "SUBSECTION") {
        return {
          id: item.id,
          kind: "SUBSECTION",
          parentId: item.parentId,
          title: item.title,
          discountPercent: String(item.discountPercent),
        };
      }
      if (item.kind === "COMMENT") {
        return {
          id: item.id,
          kind: "COMMENT",
          parentId: item.parentId ?? "",
          text: item.text,
        };
      }
      return {
        id: item.id,
        kind: "LINE",
        parentId: item.parentId ?? "",
        description: item.description,
        unit: item.unit,
        quantityInput: item.quantityFormula ?? String(item.quantity).replace(".", ","),
        unitPriceEuros: moneyInput(item.unitPriceCents),
        discountPercent: String(item.discountPercent),
        vatRatePercent: item.vatRatePercent,
      };
    }),
  };
}

function clientSearchText(client: ClientRecord): string {
  return [clientDisplayName(client), client.city, client.phone, client.email, client.siret]
    .join(" ")
    .toLocaleLowerCase("fr-FR");
}

function parentDiscounts(items: DraftItem[], line: DraftLine): number[] {
  if (!line.parentId) return [];
  const parent = items.find((item) => item.id === line.parentId);
  if (!parent || parent.kind === "LINE" || parent.kind === "COMMENT") return [];
  if (parent.kind === "SECTION") return [percent(parent.discountPercent)];

  const section = items.find((item) => item.kind === "SECTION" && item.id === parent.parentId) as
    | DraftSection
    | undefined;
  return [percent(parent.discountPercent), ...(section ? [percent(section.discountPercent)] : [])];
}

function lineAmounts(items: DraftItem[], line: DraftLine, globalDiscount: number): LineAmounts {
  try {
    const quantity = parseQuoteQuantityInput(line.quantityInput).quantity;
    const grossCents = Math.round(quantity * priceCents(line.unitPriceEuros));
    const discounts = [
      { kind: "LINE" as const, percent: percent(line.discountPercent) },
      ...parentDiscounts(items, line).map((value) => ({
        kind: "SECTION" as const,
        percent: value,
      })),
      { kind: "GLOBAL" as const, percent: globalDiscount },
    ].filter((discount) => discount.percent > 0);
    const netCents = applySequentialQuoteDiscounts(grossCents, discounts).finalCents;
    const vatCents = percentageAmountCents(netCents, line.vatRatePercent);
    return { valid: true, quantity, netCents, vatCents, ttcCents: netCents + vatCents };
  } catch {
    return { valid: false, quantity: 0, netCents: 0, vatCents: 0, ttcCents: 0 };
  }
}

function serializeItems(items: DraftItem[]) {
  return items.map((item) => {
    if (item.kind === "SECTION") {
      return {
        id: item.id,
        kind: item.kind,
        title: item.title,
        discountPercent: percent(item.discountPercent),
      };
    }
    if (item.kind === "SUBSECTION") {
      return {
        id: item.id,
        kind: item.kind,
        parentId: item.parentId,
        title: item.title,
        discountPercent: percent(item.discountPercent),
      };
    }
    if (item.kind === "COMMENT") {
      return {
        id: item.id,
        kind: item.kind,
        parentId: item.parentId || null,
        text: item.text,
      };
    }
    return {
      id: item.id,
      kind: item.kind,
      parentId: item.parentId || null,
      description: item.description,
      unit: item.unit,
      quantityInput: item.quantityInput,
      unitPriceCents: priceCents(item.unitPriceEuros),
      discountPercent: percent(item.discountPercent),
      vatRatePercent: item.vatRatePercent,
    };
  });
}

export function QuotesWorkspace() {
  const [snapshot, setSnapshot] = useState<QuotesSnapshot | null>(null);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [commercialCases, setCommercialCases] = useState<CommercialCase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<QuoteDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [newQuote, setNewQuote] = useState<NewQuoteDraft>({
    clientId: "",
    commercialCaseId: "",
    subject: "",
  });
  const [query, setQuery] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [quotesResponse, clientsResponse, commercialResponse] = await Promise.all([
          fetch("/api/desktop/quotes", { cache: "no-store" }),
          fetch("/api/desktop/clients", { cache: "no-store" }),
          fetch("/api/desktop/commercial", { cache: "no-store" }),
        ]);

        const quotesBody = (await quotesResponse.json()) as QuotesSnapshot & { error?: string };
        if (!quotesResponse.ok) throw new Error(quotesBody.error ?? "QUOTES_LOAD_FAILED");
        const clientsBody = (await clientsResponse.json()) as ClientsSnapshot & { error?: string };
        if (!clientsResponse.ok) throw new Error(clientsBody.error ?? "CLIENTS_LOAD_FAILED");
        const commercialBody = (await commercialResponse.json()) as CommercialSnapshot & {
          error?: string;
        };
        if (cancelled) return;

        const activeClients = clientsBody.payload.clients.filter((client) => !client.isArchived);
        const firstQuote = quotesBody.payload.quotes[0] ?? null;
        setSnapshot(quotesBody);
        setClients(activeClients);
        setCommercialCases(commercialResponse.ok ? commercialBody.payload.cases : []);
        setSelectedId(firstQuote?.id ?? null);
        setDraft(firstQuote ? quoteToDraft(firstQuote) : null);
      } catch (loadError) {
        if (cancelled) return;
        const code = loadError instanceof Error ? loadError.message : "QUOTES_LOAD_FAILED";
        setError(errorMessage(code));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedQuote = useMemo(
    () => snapshot?.payload.quotes.find((quote) => quote.id === selectedId) ?? null,
    [selectedId, snapshot?.payload.quotes],
  );

  const clientById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients],
  );

  const visibleQuotes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("fr-FR");
    return (snapshot?.payload.quotes ?? []).filter((quote) => {
      if (!normalized) return true;
      const client = clientById.get(quote.clientId);
      return [
        quote.quoteNumber ?? "Brouillon",
        quote.subject,
        client ? clientDisplayName(client) : "",
      ]
        .join(" ")
        .toLocaleLowerCase("fr-FR")
        .includes(normalized);
    });
  }, [clientById, query, snapshot?.payload.quotes]);

  const filteredClients = useMemo(() => {
    const normalized = clientQuery.trim().toLocaleLowerCase("fr-FR");
    return clients.filter((client) => !normalized || clientSearchText(client).includes(normalized));
  }, [clientQuery, clients]);

  const relatedCases = useMemo(() => {
    const clientId = creating ? newQuote.clientId : draft?.clientId;
    if (!clientId) return [];
    return commercialCases.filter((item) => item.clientId === clientId);
  }, [commercialCases, creating, draft?.clientId, newQuote.clientId]);

  const totals = useMemo(() => {
    if (!draft) return { ht: 0, vat: 0, ttc: 0, invalidLines: 0 };
    const globalDiscount = percent(draft.globalDiscountPercent);
    return draft.items.reduce(
      (result, item) => {
        if (item.kind !== "LINE") return result;
        const amounts = lineAmounts(draft.items, item, globalDiscount);
        if (!amounts.valid) result.invalidLines += 1;
        result.ht += amounts.netCents;
        result.vat += amounts.vatCents;
        result.ttc += amounts.ttcCents;
        return result;
      },
      { ht: 0, vat: 0, ttc: 0, invalidLines: 0 },
    );
  }, [draft]);

  async function mutate(body: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/desktop/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as QuotesSnapshot & {
        error?: string;
        lockedBy?: string;
      };
      if (!response.ok) {
        const base = errorMessage(result.error ?? "QUOTES_MUTATION_FAILED");
        throw new Error(result.lockedBy ? `${base} Poste en cours : ${result.lockedBy}.` : base);
      }

      setSnapshot(result);
      const quoteId = result.focusQuoteId ?? selectedId;
      const quote = result.payload.quotes.find((item) => item.id === quoteId) ?? null;
      setSelectedId(quote?.id ?? null);
      setDraft(quote ? quoteToDraft(quote) : null);
      setCreating(false);
      setNotice(successMessage);
      return result;
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Le devis n’a pas pu être enregistré.",
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  function selectQuote(quote: QuoteRecord) {
    setSelectedId(quote.id);
    setDraft(quoteToDraft(quote));
    setCreating(false);
    setError(null);
    setNotice(null);
  }

  function startCreate() {
    setCreating(true);
    setSelectedId(null);
    setDraft(null);
    setNewQuote({ clientId: clients[0]?.id ?? "", commercialCaseId: "", subject: "" });
    setClientQuery("");
    setError(null);
    setNotice(null);
  }

  async function createQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newQuote.clientId || !newQuote.subject.trim()) {
      setError("Choisis un client et saisis l’objet du devis.");
      return;
    }
    await mutate(
      {
        action: "create",
        clientId: newQuote.clientId,
        commercialCaseId: newQuote.commercialCaseId || null,
        subject: newQuote.subject.trim(),
      },
      "Brouillon de devis créé.",
    );
  }

  function updateDraft<K extends keyof QuoteDraft>(key: K, value: QuoteDraft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function updateItem(itemId: string, patch: Partial<DraftItem>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) =>
              item.id === itemId ? ({ ...item, ...patch } as DraftItem) : item,
            ),
          }
        : current,
    );
  }

  function appendItem(item: DraftItem) {
    if (!draft) return;
    updateDraft("items", [...draft.items, item]);
  }

  function addSection() {
    appendItem({
      id: crypto.randomUUID(),
      kind: "SECTION",
      title: "Nouvelle section",
      discountPercent: "0",
    });
  }

  function addSubsection() {
    if (!draft) return;
    const section = draft.items.find((item): item is DraftSection => item.kind === "SECTION");
    if (!section) {
      setError("Ajoute d’abord une section avant de créer une sous-section.");
      return;
    }
    appendItem({
      id: crypto.randomUUID(),
      kind: "SUBSECTION",
      parentId: section.id,
      title: "Nouvelle sous-section",
      discountPercent: "0",
    });
  }

  function addLine() {
    appendItem({
      id: crypto.randomUUID(),
      kind: "LINE",
      parentId: "",
      description: "",
      unit: "",
      quantityInput: "1",
      unitPriceEuros: "0,00",
      discountPercent: "0",
      vatRatePercent: 20,
    });
  }

  function addComment() {
    appendItem({
      id: crypto.randomUUID(),
      kind: "COMMENT",
      parentId: "",
      text: "",
    });
  }

  function removeItem(itemId: string) {
    if (!draft) return;
    const removedIds = new Set([itemId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of draft.items) {
        if (
          "parentId" in item &&
          item.parentId &&
          removedIds.has(item.parentId) &&
          !removedIds.has(item.id)
        ) {
          removedIds.add(item.id);
          changed = true;
        }
      }
    }
    updateDraft(
      "items",
      draft.items.filter((item) => !removedIds.has(item.id)),
    );
  }

  function moveItem(itemId: string, direction: -1 | 1) {
    if (!draft) return;
    const index = draft.items.findIndex((item) => item.id === itemId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= draft.items.length) return;
    const items = [...draft.items];
    [items[index], items[target]] = [items[target], items[index]];
    updateDraft("items", items);
  }

  function duplicateItem(item: DraftItem) {
    if (!draft) return;
    const duplicate = { ...item, id: crypto.randomUUID() } as DraftItem;
    const index = draft.items.findIndex((candidate) => candidate.id === item.id);
    const items = [...draft.items];
    items.splice(index + 1, 0, duplicate);
    updateDraft("items", items);
  }

  function draftMutation(quoteId: string) {
    if (!draft) return null;
    return {
      action: "update",
      quoteId,
      clientId: draft.clientId,
      commercialCaseId: draft.commercialCaseId || null,
      subject: draft.subject.trim(),
      issueDate: draft.issueDate,
      validityDays: Math.max(1, Math.round(decimal(draft.validityDays, 30))),
      paymentTerms: draft.paymentTerms,
      globalDiscountPercent: percent(draft.globalDiscountPercent),
      items: serializeItems(draft.items),
      notes: draft.notes,
    };
  }

  function validateBeforeSave(): boolean {
    if (!draft?.subject.trim()) {
      setError("L’objet du devis est obligatoire.");
      return false;
    }
    if (totals.invalidLines > 0) {
      setError("Une quantité contient un calcul invalide. Corrige-la avant d’enregistrer.");
      return false;
    }
    return true;
  }

  async function saveDraft() {
    if (!selectedQuote || !validateBeforeSave()) return;
    const body = draftMutation(selectedQuote.id);
    if (!body) return;
    await mutate(body, "Devis enregistré.");
  }

  async function finalizeQuote() {
    if (!selectedQuote || !validateBeforeSave()) return;
    const body = draftMutation(selectedQuote.id);
    if (!body) return;
    const saved = await mutate(body, "Brouillon enregistré avant finalisation.");
    if (!saved) return;
    await mutate({ action: "send", quoteId: selectedQuote.id }, "Devis finalisé et numéroté.");
  }

  const readOnly = !snapshot?.canWrite || selectedQuote?.status !== "DRAFT";
  const parentOptions = draft?.items.filter(
    (item): item is DraftSection | DraftSubsection =>
      item.kind === "SECTION" || item.kind === "SUBSECTION",
  );
  const sectionOptions = draft?.items.filter(
    (item): item is DraftSection => item.kind === "SECTION",
  );

  return (
    <section className="quotesPage">
      <div className="dashboardHeading quotesHeading">
        <div>
          <h1>Devis</h1>
          <p className="muted">
            Devis natifs PAPOT, liés aux clients et aux affaires commerciales.
          </p>
        </div>
        <button
          type="button"
          className="primaryButton"
          onClick={startCreate}
          disabled={!snapshot?.canWrite || clients.length === 0}
        >
          <Plus size={16} aria-hidden="true" />
          Nouveau devis
        </button>
      </div>

      {error && (
        <div className="quotesAlert isError" role="alert">
          <span>{error}</span>
          <button type="button" className="iconButton" onClick={() => setError(null)}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}
      {notice && <div className="quotesAlert isNotice">{notice}</div>}

      {clients.length === 0 && !loading && (
        <div className="quotesAlert isNotice">
          Aucun client actif. <Link href="/clients">Créer un client</Link> avant de faire un devis.
        </div>
      )}

      <div className="quotesLayout">
        <aside className="quotesListPanel">
          <label className="quotesSearch">
            <Search size={15} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher un devis"
            />
          </label>
          <div className="quotesList">
            {loading ? (
              <p className="muted">Chargement…</p>
            ) : visibleQuotes.length === 0 ? (
              <p className="muted">Aucun devis.</p>
            ) : (
              visibleQuotes.map((quote) => {
                const client = clientById.get(quote.clientId);
                return (
                  <button
                    key={quote.id}
                    type="button"
                    className={`quoteListRow${quote.id === selectedId ? " isActive" : ""}`}
                    onClick={() => selectQuote(quote)}
                  >
                    <span className="quoteListTopline">
                      <strong>{quote.quoteNumber ?? "Brouillon"}</strong>
                      <span className={`quoteStatus is-${quote.status.toLowerCase()}`}>
                        {STATUS_LABELS[quote.status]}
                      </span>
                    </span>
                    <span>{quote.subject}</span>
                    <small className="muted">
                      {client ? clientDisplayName(client) : "Client introuvable"} ·{" "}
                      {quote.issueDate}
                    </small>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <main className="quoteEditorPanel">
          {creating ? (
            <form className="quoteCreateCard" onSubmit={createQuote}>
              <div>
                <h2>Nouveau devis</h2>
                <p className="muted">
                  Le numéro définitif sera attribué uniquement lors de la finalisation.
                </p>
              </div>
              <label>
                Rechercher un client
                <input
                  value={clientQuery}
                  onChange={(event) => setClientQuery(event.target.value)}
                  placeholder="Nom, ville, téléphone, e-mail, SIRET"
                />
              </label>
              <label>
                Client
                <select
                  required
                  value={newQuote.clientId}
                  onChange={(event) =>
                    setNewQuote({
                      ...newQuote,
                      clientId: event.target.value,
                      commercialCaseId: "",
                    })
                  }
                >
                  <option value="">Choisir un client</option>
                  {filteredClients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {clientDisplayName(client)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Affaire commerciale liée
                <select
                  value={newQuote.commercialCaseId}
                  onChange={(event) =>
                    setNewQuote({ ...newQuote, commercialCaseId: event.target.value })
                  }
                >
                  <option value="">Aucune affaire</option>
                  {relatedCases.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Objet du devis
                <input
                  required
                  value={newQuote.subject}
                  onChange={(event) => setNewQuote({ ...newQuote, subject: event.target.value })}
                  placeholder="Ex. Agencement accueil"
                />
              </label>
              <div className="quoteCreateActions">
                <button
                  type="button"
                  className="secondaryButton"
                  onClick={() => setCreating(false)}
                >
                  Annuler
                </button>
                <button type="submit" className="primaryButton" disabled={busy}>
                  Créer le brouillon
                </button>
              </div>
            </form>
          ) : selectedQuote && draft ? (
            <QuoteEditor
              quote={selectedQuote}
              draft={draft}
              clients={clients}
              relatedCases={relatedCases}
              readOnly={readOnly}
              busy={busy}
              totals={totals}
              parentOptions={parentOptions ?? []}
              sectionOptions={sectionOptions ?? []}
              onDraftChange={updateDraft}
              onItemChange={updateItem}
              onAddSection={addSection}
              onAddSubsection={addSubsection}
              onAddLine={addLine}
              onAddComment={addComment}
              onMoveItem={moveItem}
              onDuplicateItem={duplicateItem}
              onRemoveItem={removeItem}
              onSave={() => void saveDraft()}
              onFinalize={() => void finalizeQuote()}
            />
          ) : (
            <div className="quoteEmptyEditor">
              <h2>Devis PAPOT</h2>
              <p className="muted">Sélectionne un devis ou crée un nouveau brouillon.</p>
            </div>
          )}
        </main>
      </div>

      <QuotesStyles />
    </section>
  );
}

function QuoteEditor({
  quote,
  draft,
  clients,
  relatedCases,
  readOnly,
  busy,
  totals,
  parentOptions,
  sectionOptions,
  onDraftChange,
  onItemChange,
  onAddSection,
  onAddSubsection,
  onAddLine,
  onAddComment,
  onMoveItem,
  onDuplicateItem,
  onRemoveItem,
  onSave,
  onFinalize,
}: {
  quote: QuoteRecord;
  draft: QuoteDraft;
  clients: ClientRecord[];
  relatedCases: CommercialCase[];
  readOnly: boolean;
  busy: boolean;
  totals: { ht: number; vat: number; ttc: number; invalidLines: number };
  parentOptions: Array<DraftSection | DraftSubsection>;
  sectionOptions: DraftSection[];
  onDraftChange: <K extends keyof QuoteDraft>(key: K, value: QuoteDraft[K]) => void;
  onItemChange: (itemId: string, patch: Partial<DraftItem>) => void;
  onAddSection: () => void;
  onAddSubsection: () => void;
  onAddLine: () => void;
  onAddComment: () => void;
  onMoveItem: (itemId: string, direction: -1 | 1) => void;
  onDuplicateItem: (item: DraftItem) => void;
  onRemoveItem: (itemId: string) => void;
  onSave: () => void;
  onFinalize: () => void;
}) {
  return (
    <div className="quoteEditor">
      <div className="quoteEditorHeader">
        <div>
          <div className="quoteEditorNumber">
            <strong>{quote.quoteNumber ?? "Brouillon non numéroté"}</strong>
            <span className={`quoteStatus is-${quote.status.toLowerCase()}`}>
              {STATUS_LABELS[quote.status]}
            </span>
          </div>
          <h2>{draft.subject}</h2>
        </div>
        {!readOnly && (
          <div className="quoteEditorActions">
            <button type="button" className="secondaryButton" disabled={busy} onClick={onSave}>
              <Save size={15} aria-hidden="true" />
              Enregistrer
            </button>
            <button
              type="button"
              className="primaryButton"
              disabled={busy || totals.invalidLines > 0}
              onClick={onFinalize}
            >
              Finaliser / numéroter
            </button>
          </div>
        )}
      </div>

      <div className="quoteMetaGrid">
        <label>
          Client
          <select
            value={draft.clientId}
            disabled={readOnly}
            onChange={(event) => {
              onDraftChange("clientId", event.target.value);
              onDraftChange("commercialCaseId", "");
            }}
          >
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {clientDisplayName(client)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Affaire commerciale
          <select
            value={draft.commercialCaseId}
            disabled={readOnly}
            onChange={(event) => onDraftChange("commercialCaseId", event.target.value)}
          >
            <option value="">Aucune affaire</option>
            {relatedCases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date du devis
          <input
            type="date"
            value={draft.issueDate}
            disabled={readOnly}
            onChange={(event) => onDraftChange("issueDate", event.target.value)}
          />
        </label>
        <label>
          Validité en jours
          <input
            type="number"
            min={1}
            max={365}
            value={draft.validityDays}
            disabled={readOnly}
            onChange={(event) => onDraftChange("validityDays", event.target.value)}
          />
        </label>
        <label className="quoteSubjectField">
          Objet
          <input
            value={draft.subject}
            disabled={readOnly}
            onChange={(event) => onDraftChange("subject", event.target.value)}
          />
        </label>
        <label>
          Remise globale %
          <input
            inputMode="decimal"
            value={draft.globalDiscountPercent}
            disabled={readOnly}
            onChange={(event) => onDraftChange("globalDiscountPercent", event.target.value)}
          />
        </label>
        <label className="quotePaymentField">
          Conditions de règlement
          <select
            value={draft.paymentTerms}
            disabled={readOnly}
            onChange={(event) => onDraftChange("paymentTerms", event.target.value)}
          >
            <option value="">À définir</option>
            {draft.paymentTerms &&
              !PAYMENT_TERMS.includes(draft.paymentTerms as (typeof PAYMENT_TERMS)[number]) && (
                <option value={draft.paymentTerms}>{draft.paymentTerms}</option>
              )}
            {PAYMENT_TERMS.map((term) => (
              <option key={term} value={term}>
                {term}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!readOnly && (
        <div className="quoteItemToolbar">
          <button type="button" className="secondaryButton" onClick={onAddSection}>
            <Plus size={14} aria-hidden="true" /> Section
          </button>
          <button type="button" className="secondaryButton" onClick={onAddSubsection}>
            <Plus size={14} aria-hidden="true" /> Sous-section
          </button>
          <button type="button" className="secondaryButton" onClick={onAddLine}>
            <Plus size={14} aria-hidden="true" /> Ligne
          </button>
          <button type="button" className="secondaryButton" onClick={onAddComment}>
            <Plus size={14} aria-hidden="true" /> Commentaire
          </button>
        </div>
      )}

      <div className="quoteItems">
        {draft.items.length === 0 ? (
          <div className="quoteEmptyItems">
            <p>Aucune ligne pour l’instant.</p>
            <p className="muted">Ajoute une section ou directement une ligne chiffrée.</p>
          </div>
        ) : (
          draft.items.map((item, index) => (
            <QuoteItemRow
              key={item.id}
              item={item}
              index={index}
              count={draft.items.length}
              allItems={draft.items}
              globalDiscount={percent(draft.globalDiscountPercent)}
              parentOptions={parentOptions}
              sectionOptions={sectionOptions}
              readOnly={readOnly}
              onChange={(patch) => onItemChange(item.id, patch)}
              onMove={(direction) => onMoveItem(item.id, direction)}
              onDuplicate={() => onDuplicateItem(item)}
              onDelete={() => onRemoveItem(item.id)}
            />
          ))
        )}
      </div>

      <div className="quoteBottomGrid">
        <label>
          Notes internes
          <textarea
            rows={4}
            value={draft.notes}
            disabled={readOnly}
            onChange={(event) => onDraftChange("notes", event.target.value)}
          />
        </label>
        <div className="quoteTotals">
          {totals.invalidLines > 0 && (
            <p className="quoteTotalWarning">
              {totals.invalidLines} ligne(s) avec une quantité invalide.
            </p>
          )}
          <div>
            <span>Total HT</span>
            <strong>{euro(totals.ht)}</strong>
          </div>
          <div>
            <span>TVA</span>
            <strong>{euro(totals.vat)}</strong>
          </div>
          <div className="quoteGrandTotal">
            <span>Total TTC</span>
            <strong>{euro(totals.ttc)}</strong>
          </div>
        </div>
      </div>

      {quote.status !== "DRAFT" && (
        <p className="quoteFrozenNotice">
          Ce devis est figé depuis sa finalisation. Le client et les conditions enregistrés à cet
          instant restent attachés au document.
        </p>
      )}
    </div>
  );
}

function QuoteItemRow({
  item,
  index,
  count,
  allItems,
  globalDiscount,
  parentOptions,
  sectionOptions,
  readOnly,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
}: {
  item: DraftItem;
  index: number;
  count: number;
  allItems: DraftItem[];
  globalDiscount: number;
  parentOptions: Array<DraftSection | DraftSubsection>;
  sectionOptions: DraftSection[];
  readOnly: boolean;
  onChange: (patch: Partial<DraftItem>) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const actions = !readOnly && (
    <QuoteItemActions
      index={index}
      count={count}
      onMove={onMove}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
    />
  );

  if (item.kind === "SECTION") {
    return (
      <div className="quoteItem quoteSection">
        <div className="quoteItemMain">
          <strong>Section</strong>
          <input
            value={item.title}
            disabled={readOnly}
            onChange={(event) => onChange({ title: event.target.value })}
          />
        </div>
        <label>
          Remise %
          <input
            value={item.discountPercent}
            disabled={readOnly}
            onChange={(event) => onChange({ discountPercent: event.target.value })}
          />
        </label>
        {actions}
      </div>
    );
  }

  if (item.kind === "SUBSECTION") {
    return (
      <div className="quoteItem quoteSubsection">
        <div className="quoteItemMain">
          <strong>Sous-section</strong>
          <input
            value={item.title}
            disabled={readOnly}
            onChange={(event) => onChange({ title: event.target.value })}
          />
        </div>
        <label>
          Section parente
          <select
            value={item.parentId}
            disabled={readOnly}
            onChange={(event) => onChange({ parentId: event.target.value })}
          >
            {sectionOptions.map((section) => (
              <option key={section.id} value={section.id}>
                {section.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Remise %
          <input
            value={item.discountPercent}
            disabled={readOnly}
            onChange={(event) => onChange({ discountPercent: event.target.value })}
          />
        </label>
        {actions}
      </div>
    );
  }

  if (item.kind === "COMMENT") {
    return (
      <div className="quoteItem quoteComment">
        <label className="quoteCommentText">
          Commentaire
          <textarea
            rows={2}
            value={item.text}
            disabled={readOnly}
            onChange={(event) => onChange({ text: event.target.value })}
          />
        </label>
        <ParentSelector
          value={item.parentId}
          options={parentOptions}
          disabled={readOnly}
          onChange={(value) => onChange({ parentId: value })}
        />
        {actions}
      </div>
    );
  }

  const amounts = lineAmounts(allItems, item, globalDiscount);
  return (
    <div className={`quoteItem quoteLine${amounts.valid ? "" : " hasError"}`}>
      <label className="quoteLineDescription">
        Désignation
        <input
          value={item.description}
          disabled={readOnly}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </label>
      <ParentSelector
        value={item.parentId}
        options={parentOptions}
        disabled={readOnly}
        onChange={(value) => onChange({ parentId: value })}
      />
      <label>
        Unité
        <input
          value={item.unit}
          disabled={readOnly}
          onChange={(event) => onChange({ unit: event.target.value })}
        />
      </label>
      <label>
        Quantité / calcul
        <input
          value={item.quantityInput}
          disabled={readOnly}
          className={amounts.valid ? undefined : "inputError"}
          onChange={(event) => onChange({ quantityInput: event.target.value })}
          title="Exemple : 2+6+4+9"
        />
        {amounts.valid && /[+\-*/()]/.test(item.quantityInput) && (
          <small className="muted">= {amounts.quantity}</small>
        )}
      </label>
      <label>
        PU HT €
        <input
          inputMode="decimal"
          value={item.unitPriceEuros}
          disabled={readOnly}
          onChange={(event) => onChange({ unitPriceEuros: event.target.value })}
        />
      </label>
      <label>
        Remise %
        <input
          inputMode="decimal"
          value={item.discountPercent}
          disabled={readOnly}
          onChange={(event) => onChange({ discountPercent: event.target.value })}
        />
      </label>
      <label>
        TVA
        <select
          value={item.vatRatePercent}
          disabled={readOnly}
          onChange={(event) =>
            onChange({ vatRatePercent: Number(event.target.value) as QuoteVatRate })
          }
        >
          <option value={0}>0 %</option>
          <option value={5.5}>5,5 %</option>
          <option value={10}>10 %</option>
          <option value={20}>20 %</option>
        </select>
      </label>
      <div className="quoteLineAmount">
        <span>HT net</span>
        <strong>{amounts.valid ? euro(amounts.netCents) : "Calcul invalide"}</strong>
      </div>
      {actions}
    </div>
  );
}

function ParentSelector({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: Array<DraftSection | DraftSubsection>;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      Rattachement
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">Racine du devis</option>
        {options.map((parent) => (
          <option key={parent.id} value={parent.id}>
            {parent.kind === "SECTION" ? "Section" : "Sous-section"} · {parent.title}
          </option>
        ))}
      </select>
    </label>
  );
}

function QuoteItemActions({
  index,
  count,
  onMove,
  onDuplicate,
  onDelete,
}: {
  index: number;
  count: number;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="quoteItemActions">
      <button type="button" disabled={index === 0} onClick={() => onMove(-1)} title="Monter">
        ↑
      </button>
      <button
        type="button"
        disabled={index === count - 1}
        onClick={() => onMove(1)}
        title="Descendre"
      >
        ↓
      </button>
      <button type="button" onClick={onDuplicate} title="Dupliquer">
        Dupliquer
      </button>
      <button type="button" className="deleteButton" onClick={onDelete} title="Supprimer">
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

function QuotesStyles() {
  return (
    <style jsx global>{`
      .quotesPage {
        display: grid;
        gap: 14px;
      }
      .quotesHeading,
      .quoteEditorHeader,
      .quoteListTopline,
      .quoteEditorNumber {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
      }
      .quotesPage .primaryButton,
      .quotesPage .secondaryButton,
      .quoteEditorActions,
      .quoteCreateActions,
      .quoteItemToolbar,
      .quoteItemActions {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .quotesAlert {
        min-height: 36px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        border: 1px solid #ded9ee;
        border-radius: 8px;
        padding: 7px 10px;
        background: #faf9fd;
      }
      .quotesAlert.isError {
        border-color: #e7c1c1;
        background: #fff7f7;
        color: #7a3333;
      }
      .quotesAlert.isNotice {
        border-color: #d7cfef;
        background: #f8f6ff;
      }
      .quotesLayout {
        display: grid;
        grid-template-columns: 290px minmax(0, 1fr);
        gap: 12px;
        min-height: calc(100vh - 185px);
      }
      .quotesListPanel,
      .quoteEditorPanel,
      .quoteCreateCard {
        border: 1px solid #e7e2f0;
        border-radius: 10px;
        background: #fff;
        box-shadow: 0 4px 15px rgb(55 39 112 / 0.05);
      }
      .quotesListPanel {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        gap: 10px;
        padding: 10px;
        min-width: 0;
      }
      .quotesSearch {
        position: relative;
        display: flex;
        align-items: center;
      }
      .quotesSearch svg {
        position: absolute;
        left: 10px;
        color: #776e8d;
        pointer-events: none;
      }
      .quotesSearch input {
        width: 100%;
        padding-left: 32px;
      }
      .quotesList {
        display: grid;
        align-content: start;
        gap: 6px;
        min-height: 0;
        overflow: auto;
      }
      .quoteListRow {
        width: 100%;
        min-height: 72px;
        display: grid;
        gap: 4px;
        padding: 9px 10px;
        text-align: left;
        color: inherit;
        border: 1px solid #ece8f3;
        border-radius: 8px;
        background: #fff;
      }
      .quoteListRow:hover,
      .quoteListRow.isActive {
        border-color: #bfb3e6;
        background: #f8f6ff;
      }
      .quoteStatus {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        padding: 2px 8px;
        border-radius: 999px;
        background: #eeeaf7;
        color: #655a81;
        white-space: nowrap;
      }
      .quoteStatus.is-sent,
      .quoteStatus.is-accepted {
        background: #e8f5ec;
        color: #2e6c41;
      }
      .quoteStatus.is-rejected,
      .quoteStatus.is-cancelled {
        background: #f8eaea;
        color: #813d3d;
      }
      .quoteEditorPanel {
        min-width: 0;
        padding: 14px;
      }
      .quoteEmptyEditor,
      .quoteEmptyItems {
        min-height: 180px;
        display: grid;
        place-content: center;
        text-align: center;
      }
      .quoteCreateCard {
        max-width: 760px;
        margin: 20px auto;
        padding: 16px;
        display: grid;
        gap: 12px;
      }
      .quoteCreateCard label,
      .quoteMetaGrid label,
      .quoteItem label,
      .quoteBottomGrid label {
        display: grid;
        gap: 5px;
      }
      .quoteCreateCard input,
      .quoteCreateCard select,
      .quoteMetaGrid input,
      .quoteMetaGrid select,
      .quoteItem input,
      .quoteItem select,
      .quoteItem textarea,
      .quoteBottomGrid textarea {
        width: 100%;
        border: 1px solid #dcd6eb;
        border-radius: 7px;
        background: #fff;
        padding: 7px 9px;
      }
      .quoteCreateActions {
        justify-content: flex-end;
      }
      .quoteEditor {
        display: grid;
        gap: 12px;
      }
      .quoteEditorHeader h2 {
        margin: 6px 0 0;
      }
      .quoteEditorActions,
      .quoteItemToolbar {
        flex-wrap: wrap;
      }
      .quoteMetaGrid {
        display: grid;
        grid-template-columns: repeat(4, minmax(140px, 1fr));
        gap: 10px;
        padding: 12px;
        border: 1px solid #ece8f3;
        border-radius: 8px;
        background: #faf9fd;
      }
      .quoteSubjectField,
      .quotePaymentField {
        grid-column: span 2;
      }
      .quoteItems {
        display: grid;
        gap: 7px;
      }
      .quoteItem {
        display: grid;
        align-items: end;
        gap: 8px;
        padding: 9px;
        border: 1px solid #e9e5f1;
        border-radius: 8px;
        background: #fff;
      }
      .quoteSection {
        grid-template-columns: minmax(260px, 1fr) 110px auto;
        background: #f4f1fb;
        border-color: #d9d1ec;
      }
      .quoteSubsection {
        grid-template-columns: minmax(240px, 1fr) minmax(180px, 0.6fr) 110px auto;
        margin-left: 18px;
        background: #faf8ff;
      }
      .quoteComment {
        grid-template-columns: minmax(280px, 1fr) minmax(180px, 0.45fr) auto;
        background: #fffdf7;
      }
      .quoteLine {
        grid-template-columns: minmax(220px, 1.5fr) minmax(
            150px,
            0.8fr
          ) 72px 130px 100px 84px 82px 110px auto;
      }
      .quoteLine.hasError {
        border-color: #d49a9a;
        background: #fffafa;
      }
      .quoteItemMain,
      .quoteLineAmount {
        display: grid;
        gap: 5px;
      }
      .quoteLineAmount {
        align-content: end;
        min-height: 36px;
      }
      .quoteLineAmount strong {
        white-space: nowrap;
      }
      .inputError {
        border-color: #c36c6c !important;
      }
      .quoteItemActions {
        justify-content: flex-end;
      }
      .quoteItemActions button {
        min-width: 32px;
        height: 32px;
        padding: 0 7px;
        border: 1px solid #ddd7e9;
        border-radius: 6px;
        background: #fff;
        color: #5f5576;
      }
      .quoteItemActions .deleteButton {
        color: #8b4444;
      }
      .quoteBottomGrid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
        gap: 12px;
        align-items: start;
      }
      .quoteBottomGrid textarea {
        min-height: 116px;
        resize: vertical;
      }
      .quoteTotals {
        display: grid;
        gap: 7px;
        padding: 12px;
        border: 1px solid #ddd7e9;
        border-radius: 8px;
        background: #faf9fd;
      }
      .quoteTotals > div {
        display: flex;
        justify-content: space-between;
        gap: 16px;
      }
      .quoteGrandTotal {
        padding-top: 8px;
        border-top: 1px solid #d9d3e5;
      }
      .quoteTotalWarning {
        margin: 0;
        color: #8b4444;
      }
      .quoteFrozenNotice {
        margin: 0;
        padding: 10px;
        border: 1px solid #ddd6ec;
        border-radius: 8px;
        background: #f5f2fb;
      }
      .quotesPage input:disabled,
      .quotesPage select:disabled,
      .quotesPage textarea:disabled {
        background: #f5f4f7;
        color: #5f5b67;
        opacity: 1;
      }
      @media (max-width: 1500px) {
        .quoteLine {
          grid-template-columns: repeat(4, minmax(120px, 1fr));
        }
        .quoteLineDescription {
          grid-column: span 2;
        }
        .quoteItemActions {
          grid-column: 4;
        }
      }
      @media (max-width: 1100px) {
        .quotesLayout {
          grid-template-columns: 240px minmax(0, 1fr);
        }
        .quoteMetaGrid {
          grid-template-columns: repeat(2, minmax(150px, 1fr));
        }
        .quoteSubjectField,
        .quotePaymentField {
          grid-column: span 2;
        }
        .quoteSection,
        .quoteSubsection,
        .quoteComment,
        .quoteLine {
          grid-template-columns: 1fr 1fr;
          margin-left: 0;
        }
        .quoteItemActions {
          grid-column: 2;
        }
        .quoteBottomGrid {
          grid-template-columns: 1fr;
        }
      }
    `}</style>
  );
}
