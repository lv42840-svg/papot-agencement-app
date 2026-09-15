"use client";

import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { Check, LockKeyhole, Pencil, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import type { LibraryComponent } from "@/lib/library/component";
import {
  createInitialLibraryPayload,
  parseLibraryPayload,
  type LibraryPayload,
} from "@/lib/library/storage";
import { parseQuoteQuantityInput } from "@/lib/quotes/domain";
import { publishQuoteOuvrageToLibrary } from "@/lib/quotes/library-publish";
import {
  calculateQuoteOuvrageMarginPercent,
  calculateQuoteOuvrageUnitCostCents,
  quoteOuvrageComponentCostPriceCents,
  type QuoteItem,
  type QuoteLine,
  type QuoteOuvrageComponent,
  type QuoteSection,
  type QuoteSubsection,
} from "@/lib/quotes/model";
import { buildQuoteItemNumbers } from "@/lib/quotes/numbering";
import type { NativeQuoteRecord, NativeQuotesPayload } from "@/lib/quotes/store";

type QuotesApiResponse = {
  payload?: NativeQuotesPayload;
  error?: string;
};

type LibraryGetResponse = {
  version?: number;
  payload?: LibraryPayload;
  error?: string;
};

type LibraryResourceEnvelope = {
  version: number;
  payload: unknown;
};

type LibraryOpenResponse =
  | {
      status: "editable" | "read-only";
      resource: LibraryResourceEnvelope | null;
      baseVersion: number;
      lock: { owner_display_name: string };
    }
  | { status: "error"; error: string };

type LibrarySaveResponse =
  | { status: "saved"; resource: LibraryResourceEnvelope }
  | { status: "conflict"; current: LibraryResourceEnvelope | null }
  | { status: "error"; error: string };

type OuvrageComponentForm = {
  key: string;
  id?: string;
  libraryComponentId?: string;
  description: string;
  unit: string;
  quantityInput: string;
  costPriceEuros: string;
  unitPriceEuros: string;
};

type HeadingEditor = {
  kind: "SECTION" | "SUBSECTION";
  itemId?: string;
  parentId?: string;
  title: string;
} | null;

const moneyFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatMoney(cents: number): string {
  return moneyFormatter.format(cents / 100);
}

function formatPercent(value: number | null): string {
  return value === null ? "n/c" : `${percentFormatter.format(value)} %`;
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function eurosToCents(value: string): number {
  const euros = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(euros) || euros < 0) throw new Error("PRICE_INVALID");
  const cents = Math.round(euros * 100);
  if (!Number.isSafeInteger(cents)) throw new Error("PRICE_INVALID");
  return cents;
}

function optionalEurosToCents(value: string): number | undefined {
  if (!value.trim()) return undefined;
  return eurosToCents(value);
}

function newComponentForm(): OuvrageComponentForm {
  return {
    key: globalThis.crypto.randomUUID(),
    description: "",
    unit: "u",
    quantityInput: "1",
    costPriceEuros: "",
    unitPriceEuros: "0,00",
  };
}

function formFromLibraryComponent(component: LibraryComponent): OuvrageComponentForm {
  return {
    key: globalThis.crypto.randomUUID(),
    libraryComponentId: component.id,
    description: component.name,
    unit: component.unit,
    quantityInput: "1",
    costPriceEuros: centsToInput(component.costPriceCents),
    unitPriceEuros: centsToInput(component.salePriceCents),
  };
}

function formsFromLine(line: QuoteLine): OuvrageComponentForm[] {
  const lineComponents = line.components ?? [];
  if (lineComponents.length > 0) {
    return lineComponents.map((component) => {
      const costPriceCents = quoteOuvrageComponentCostPriceCents(component);
      return {
        key: component.id,
        id: component.id,
        description: component.description,
        unit: component.unit,
        quantityInput: component.quantityFormula ?? String(component.quantity).replace(".", ","),
        costPriceEuros: costPriceCents === null ? "" : centsToInput(costPriceCents),
        unitPriceEuros: centsToInput(component.unitPriceCents),
      };
    });
  }

  return [
    {
      key: `legacy-${line.id}`,
      description: line.description,
      unit: line.unit || "u",
      quantityInput: "1",
      costPriceEuros: "",
      unitPriceEuros: centsToInput(line.unitPriceCents ?? 0),
    },
  ];
}

function componentTotalCents(component: OuvrageComponentForm): number | null {
  try {
    const quantity = parseQuoteQuantityInput(component.quantityInput).quantity;
    const total = Math.round(quantity * eurosToCents(component.unitPriceEuros));
    return Number.isSafeInteger(total) && total >= 0 ? total : null;
  } catch {
    return null;
  }
}

function componentCostTotalCents(component: OuvrageComponentForm): number | null {
  try {
    const costPriceCents = optionalEurosToCents(component.costPriceEuros);
    if (costPriceCents === undefined) return null;
    const quantity = parseQuoteQuantityInput(component.quantityInput).quantity;
    const total = Math.round(quantity * costPriceCents);
    return Number.isSafeInteger(total) && total >= 0 ? total : null;
  } catch {
    return null;
  }
}

function componentMarginPercent(component: OuvrageComponentForm): number | null {
  try {
    const costPriceCents = optionalEurosToCents(component.costPriceEuros);
    if (costPriceCents === undefined) return null;
    return calculateQuoteOuvrageMarginPercent(
      eurosToCents(component.unitPriceEuros),
      costPriceCents,
    );
  } catch {
    return null;
  }
}

function storedComponentMarginPercent(component: QuoteOuvrageComponent): number | null {
  return calculateQuoteOuvrageMarginPercent(
    component.unitPriceCents,
    quoteOuvrageComponentCostPriceCents(component),
  );
}

function ouvrageUnitPriceCents(components: OuvrageComponentForm[]): number | null {
  let total = 0;
  for (const component of components) {
    const componentTotal = componentTotalCents(component);
    if (componentTotal === null) return null;
    total += componentTotal;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function ouvrageUnitCostCents(components: OuvrageComponentForm[]): number | null {
  let total = 0;
  for (const component of components) {
    const componentTotal = componentCostTotalCents(component);
    if (componentTotal === null) return null;
    total += componentTotal;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function ouvrageTotalCents(quantityInput: string, unitPriceCents: number | null): number | null {
  if (unitPriceCents === null) return null;
  try {
    const quantity = parseQuoteQuantityInput(quantityInput).quantity;
    const total = Math.round(quantity * unitPriceCents);
    return Number.isSafeInteger(total) && total >= 0 ? total : null;
  } catch {
    return null;
  }
}

function lineErrorLabel(code: string): string {
  if (code === "QUOTE_NOT_FOUND") return "Ce devis n’existe plus.";
  if (code === "QUOTE_NOT_EDITABLE") return "Seul un brouillon peut être modifié.";
  if (code === "QUOTE_LINE_NOT_FOUND") return "Cet ouvrage n’existe plus.";
  if (code === "QUOTE_HEADING_NOT_FOUND") return "Ce titre n’existe plus.";
  if (code === "QUOTE_SECTION_NOT_FOUND") return "Le grand titre du sous-titre n’existe plus.";
  if (code === "QUOTE_LIBRARY_COMPONENT_NOT_FOUND") {
    return "Ce composant n’existe plus dans la Bibliothèque. Choisis-le à nouveau.";
  }
  if (code === "QUOTES_REQUEST_INVALID") return "Vérifie les informations saisies.";
  return "La modification n’a pas pu être enregistrée.";
}

function libraryErrorLabel(code: string): string {
  if (code === "LIBRARY_LOCKED") return "La Bibliothèque est modifiée depuis un autre poste.";
  if (code === "LIBRARY_VERSION_CONFLICT") {
    return "La Bibliothèque a changé pendant l’enregistrement. Recommence.";
  }
  if (code === "QUOTE_LIBRARY_COMPONENT_COST_REQUIRED") {
    return "Renseigne le coût de chaque composant avant d’ajouter l’ouvrage à la Bibliothèque.";
  }
  if (code === "QUOTE_LIBRARY_COMPONENT_UNIT_REQUIRED") {
    return "Chaque composant doit avoir une unité avant l’ajout à la Bibliothèque.";
  }
  if (code === "QUOTE_LIBRARY_COMPONENT_PRICING_INVALID") {
    return "Le coût et le prix de vente des composants doivent permettre de calculer une marge valide.";
  }
  return "La Bibliothèque n’a pas pu être mise à jour.";
}

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .trim();
}

function latestSection(items: QuoteItem[]): QuoteSection | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === "SECTION") return item;
  }
  return null;
}

function currentInsertionParentId(items: QuoteItem[]): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === "SECTION" || item.kind === "SUBSECTION") return item.id;
    if (item.kind === "LINE" || item.kind === "COMMENT") return item.parentId;
  }
  return null;
}

async function postLibrary(body: Record<string, unknown>) {
  const response = await fetch("/api/desktop/library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as LibraryOpenResponse | LibrarySaveResponse;
  if (!response.ok) {
    const error = "error" in data ? data.error : "LIBRARY_REQUEST_FAILED";
    throw new Error(error);
  }
  return data;
}

export function QuoteStructuredLinesEditor({
  quote,
  canWrite,
  onSaved,
  headerActions,
}: {
  quote: NativeQuoteRecord | null;
  canWrite: boolean;
  onSaved: (payload: NativeQuotesPayload) => void;
  headerActions?: ReactNode;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [newLineParentId, setNewLineParentId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState("u");
  const [quantityInput, setQuantityInput] = useState("1");
  const [components, setComponents] = useState<OuvrageComponentForm[]>([newComponentForm()]);
  const [priceForced, setPriceForced] = useState(false);
  const [forcedUnitPriceEuros, setForcedUnitPriceEuros] = useState("0,00");
  const [headingEditor, setHeadingEditor] = useState<HeadingEditor>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [libraryPayload, setLibraryPayload] = useState<LibraryPayload | null>(null);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [librarySavingLineId, setLibrarySavingLineId] = useState<string | null>(null);
  const [publishedLineIds, setPublishedLineIds] = useState<Set<string>>(new Set());

  const items = useMemo(() => quote?.model.items ?? [], [quote]);
  const lines = useMemo(
    () => items.filter((item): item is QuoteLine => item.kind === "LINE"),
    [items],
  );
  const numbers = useMemo(() => buildQuoteItemNumbers(items), [items]);
  const lastSection = useMemo(() => latestSection(items), [items]);
  const editable = canWrite && quote?.status === "DRAFT";
  const calculatedUnitPrice = useMemo(() => ouvrageUnitPriceCents(components), [components]);
  const calculatedUnitCost = useMemo(() => ouvrageUnitCostCents(components), [components]);
  const forcedUnitPrice = useMemo(() => {
    if (!priceForced) return null;
    try {
      return eurosToCents(forcedUnitPriceEuros);
    } catch {
      return null;
    }
  }, [forcedUnitPriceEuros, priceForced]);
  const effectiveUnitPrice = priceForced ? forcedUnitPrice : calculatedUnitPrice;
  const currentMarginPercent =
    effectiveUnitPrice === null
      ? null
      : calculateQuoteOuvrageMarginPercent(effectiveUnitPrice, calculatedUnitCost);

  const visibleLibraryComponents = useMemo(() => {
    if (!libraryPayload) return [];
    const query = normalizeSearch(libraryQuery);
    return libraryPayload.components
      .filter((component) =>
        normalizeSearch([component.name, component.description, component.unit].join(" ")).includes(
          query,
        ),
      )
      .sort((left, right) => left.name.localeCompare(right.name, "fr-FR", { sensitivity: "base" }));
  }, [libraryPayload, libraryQuery]);

  useEffect(() => {
    setFormOpen(false);
    setEditingLineId(null);
    setHeadingEditor(null);
    setError("");
    setNotice("");
    setLibraryPickerOpen(false);
    setPublishedLineIds(new Set());
  }, [quote?.id]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function resetForm() {
    setEditingLineId(null);
    setNewLineParentId(null);
    setDescription("");
    setUnit("u");
    setQuantityInput("1");
    setComponents([newComponentForm()]);
    setPriceForced(false);
    setForcedUnitPriceEuros("0,00");
    setLibraryPickerOpen(false);
    setLibraryQuery("");
    setError("");
  }

  function openNewOuvrage() {
    if (!editable || headingEditor) return;
    resetForm();
    setNewLineParentId(currentInsertionParentId(items));
    setFormOpen(true);
  }

  function openEditOuvrage(line: QuoteLine) {
    if (!editable || headingEditor) return;
    setEditingLineId(line.id);
    setNewLineParentId(null);
    setDescription(line.description);
    setUnit(line.unit || "u");
    setQuantityInput(line.quantityFormula ?? String(line.quantity).replace(".", ","));
    setComponents(formsFromLine(line));
    setPriceForced(line.forcedUnitPriceCents !== undefined);
    setForcedUnitPriceEuros(centsToInput(line.forcedUnitPriceCents ?? line.unitPriceCents ?? 0));
    setLibraryPickerOpen(false);
    setLibraryQuery("");
    setError("");
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    resetForm();
  }

  function openNewHeading(kind: "SECTION" | "SUBSECTION") {
    if (!editable || formOpen) return;
    if (kind === "SUBSECTION" && !lastSection) {
      setError("Ajoute d’abord un grand titre avant de créer un sous-titre.");
      return;
    }
    setError("");
    setHeadingEditor({
      kind,
      parentId: kind === "SUBSECTION" ? lastSection?.id : undefined,
      title: "",
    });
  }

  function openEditHeading(item: QuoteSection | QuoteSubsection) {
    if (!editable || formOpen) return;
    setError("");
    setHeadingEditor({
      kind: item.kind,
      itemId: item.id,
      parentId: item.kind === "SUBSECTION" ? item.parentId : undefined,
      title: item.title,
    });
  }

  async function saveHeading(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quote || !headingEditor) return;
    setSaving(true);
    setError("");
    try {
      const body =
        headingEditor.kind === "SECTION"
          ? {
              action: "upsertSection",
              quoteId: quote.id,
              itemId: headingEditor.itemId,
              title: headingEditor.title,
            }
          : {
              action: "upsertSubsection",
              quoteId: quote.id,
              itemId: headingEditor.itemId,
              parentId: headingEditor.parentId,
              title: headingEditor.title,
            };
      const response = await fetch("/api/desktop/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as QuotesApiResponse;
      if (!response.ok || !data.payload) {
        setError(lineErrorLabel(data.error ?? "QUOTES_MUTATION_FAILED"));
        return;
      }
      onSaved(data.payload);
      setNotice(headingEditor.kind === "SECTION" ? "Titre enregistré." : "Sous-titre enregistré.");
      setHeadingEditor(null);
    } catch {
      setError("Le titre n’a pas pu être enregistré.");
    } finally {
      setSaving(false);
    }
  }

  function updateComponent(index: number, patch: Partial<OuvrageComponentForm>) {
    setComponents((current) =>
      current.map((component, componentIndex) =>
        componentIndex === index ? { ...component, ...patch } : component,
      ),
    );
  }

  function addComponent() {
    setComponents((current) => [...current, newComponentForm()]);
    setLibraryPickerOpen(false);
  }

  function removeComponent(index: number) {
    setComponents((current) => {
      if (current.length <= 1) return current;
      return current.filter((_, componentIndex) => componentIndex !== index);
    });
  }

  function resetForcedPrice() {
    setPriceForced(false);
    setForcedUnitPriceEuros(centsToInput(calculatedUnitPrice ?? 0));
  }

  async function openLibraryPicker() {
    setError("");
    setLibraryPickerOpen(true);
    if (libraryPayload) return;

    setLibraryLoading(true);
    try {
      const response = await fetch("/api/desktop/library", { cache: "no-store" });
      const data = (await response.json()) as LibraryGetResponse;
      if (!response.ok || !data.payload) throw new Error(data.error ?? "LIBRARY_REQUEST_FAILED");
      setLibraryPayload(data.payload);
    } catch {
      setError("Impossible de charger les composants de la Bibliothèque.");
      setLibraryPickerOpen(false);
    } finally {
      setLibraryLoading(false);
    }
  }

  function chooseLibraryComponent(component: LibraryComponent) {
    const selected = formFromLibraryComponent(component);
    setComponents((current) => {
      if (
        current.length === 1 &&
        !current[0].description.trim() &&
        !current[0].costPriceEuros.trim()
      ) {
        return [selected];
      }
      return [...current, selected];
    });
    setLibraryPickerOpen(false);
    setLibraryQuery("");
  }

  async function saveOuvrage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quote) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/desktop/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsertOuvrage",
          quoteId: quote.id,
          lineId: editingLineId ?? undefined,
          parentId: editingLineId ? undefined : newLineParentId,
          description,
          unit,
          quantityInput,
          forcedUnitPriceCents: priceForced ? eurosToCents(forcedUnitPriceEuros) : null,
          components: components.map((component) => ({
            id: component.id,
            libraryComponentId: component.libraryComponentId,
            description: component.description,
            unit: component.unit,
            quantityInput: component.quantityInput,
            costPriceCents: optionalEurosToCents(component.costPriceEuros),
            unitPriceCents: eurosToCents(component.unitPriceEuros),
          })),
        }),
      });
      const data = (await response.json()) as QuotesApiResponse;
      if (!response.ok || !data.payload) {
        setError(lineErrorLabel(data.error ?? "QUOTES_MUTATION_FAILED"));
        return;
      }
      onSaved(data.payload);
      setNotice(editingLineId ? "Ouvrage modifié." : "Ouvrage ajouté au devis.");
      closeForm();
    } catch {
      setError("Vérifie les quantités, les coûts et les prix des composants.");
    } finally {
      setSaving(false);
    }
  }

  async function addOuvrageToLibrary(line: QuoteLine) {
    if (!editable || librarySavingLineId) return;
    setLibrarySavingLineId(line.id);
    setError("");
    setNotice("");
    const leaseId = globalThis.crypto.randomUUID();
    let leaseOwned = false;

    try {
      const opened = (await postLibrary({ action: "open", leaseId })) as LibraryOpenResponse;
      if (opened.status === "error") throw new Error(opened.error);
      if (opened.status === "read-only") throw new Error("LIBRARY_LOCKED");
      leaseOwned = true;

      const basePayload = opened.resource
        ? parseLibraryPayload(opened.resource.payload)
        : createInitialLibraryPayload();
      const published = publishQuoteOuvrageToLibrary(basePayload, line);
      const saved = (await postLibrary({
        action: "save",
        leaseId,
        expectedVersion: opened.baseVersion,
        payload: published.payload,
      })) as LibrarySaveResponse;

      if (saved.status === "error") throw new Error(saved.error);
      if (saved.status === "conflict") throw new Error("LIBRARY_VERSION_CONFLICT");

      setLibraryPayload(parseLibraryPayload(saved.resource.payload));
      setPublishedLineIds((current) => new Set(current).add(line.id));
      setNotice("Ouvrage ajouté à la Bibliothèque.");
    } catch (publishError) {
      const code = publishError instanceof Error ? publishError.message : "LIBRARY_REQUEST_FAILED";
      setError(libraryErrorLabel(code));
    } finally {
      if (leaseOwned) {
        try {
          await postLibrary({ action: "release", leaseId });
        } catch {
          // Best effort: the lease expires automatically.
        }
      }
      setLibrarySavingLineId(null);
    }
  }

  function renderComponentReadRows(lineComponents: QuoteOuvrageComponent[]) {
    if (lineComponents.length === 0) {
      return (
        <div className="quoteComponentEmpty">
          Clique sur le crayon pour détailler les composants.
        </div>
      );
    }

    return lineComponents.map((component) => {
      const componentCost = quoteOuvrageComponentCostPriceCents(component);
      const marginPercent = storedComponentMarginPercent(component);
      return (
        <div className="quoteComponentRow" key={component.id}>
          <strong>{component.description}</strong>
          <span>{component.quantityFormula ?? component.quantity}</span>
          <span>{component.unit || "—"}</span>
          <span>{componentCost === null ? "—" : formatMoney(componentCost)}</span>
          <span
            className={
              marginPercent !== null && marginPercent < 0 ? "quoteNegative" : "quotePositive"
            }
          >
            {formatPercent(marginPercent)}
          </span>
          <span>{formatMoney(component.unitPriceCents)}</span>
          <span>{formatMoney(Math.round(component.quantity * component.unitPriceCents))}</span>
          <span />
        </div>
      );
    });
  }

  function renderReadOuvrage(line: QuoteLine) {
    const lineComponents = line.components ?? [];
    const salePriceCents = line.unitPriceCents ?? 0;
    const costPriceCents = calculateQuoteOuvrageUnitCostCents(lineComponents);
    const marginAmountCents = costPriceCents === null ? null : salePriceCents - costPriceCents;
    const marginPercent = calculateQuoteOuvrageMarginPercent(salePriceCents, costPriceCents);
    const libraryAlreadyLinked = line.librarySource?.kind === "OUVRAGE";
    const publishedNow = publishedLineIds.has(line.id);
    const lineTotalCents = Math.round(line.quantity * salePriceCents);

    return (
      <div className="quoteOuvrageGroup" key={line.id}>
        <div className="quoteMainRow quoteLineRow">
          <span className="quoteNumber">{numbers.get(line.id) ?? "—"}</span>
          <div className="quoteLineDescription">
            <strong>{line.description}</strong>
            <small>
              {lineComponents.length} composant{lineComponents.length === 1 ? "" : "s"}
            </small>
          </div>
          <span>{line.quantityFormula ?? line.quantity}</span>
          <span>{line.unit || "—"}</span>
          <div className="quotePriceCell">
            <strong>{formatMoney(salePriceCents)}</strong>
            {line.forcedUnitPriceCents !== undefined ? (
              <small className="quoteForcedBadge">
                <LockKeyhole size={10} aria-hidden="true" /> Forcé
              </small>
            ) : null}
          </div>
          <div
            className={`quoteMarginCell${marginAmountCents !== null && marginAmountCents < 0 ? " isNegative" : marginAmountCents === null ? " isMissing" : ""}`}
          >
            {marginAmountCents === null ? (
              <span>À renseigner</span>
            ) : (
              <>
                <strong>{formatMoney(marginAmountCents)}</strong>
                <small>{formatPercent(marginPercent)}</small>
              </>
            )}
          </div>
          <strong className="quoteLineTotal">{formatMoney(lineTotalCents)}</strong>
          <div className="quoteRowActions">
            {editable ? (
              <>
                <button
                  type="button"
                  className="miniLibraryButton"
                  onClick={() => void addOuvrageToLibrary(line)}
                  disabled={librarySavingLineId !== null || libraryAlreadyLinked || publishedNow}
                  aria-label={`Ajouter ${line.description} à la Bibliothèque`}
                  title={
                    libraryAlreadyLinked || publishedNow
                      ? "Ouvrage déjà dans la Bibliothèque"
                      : "Ajouter l’ouvrage à la Bibliothèque"
                  }
                >
                  {librarySavingLineId === line.id ? "…" : "+B"}
                </button>
                <button
                  type="button"
                  className="iconButton"
                  onClick={() => openEditOuvrage(line)}
                  disabled={formOpen || headingEditor !== null}
                  aria-label={`Modifier ${line.description}`}
                  title="Modifier l’ouvrage"
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
              </>
            ) : null}
          </div>
        </div>
        <div className="quoteComponentsTable">
          <div className="quoteComponentsHeader">
            <span>Composant</span>
            <span>Qté</span>
            <span>Unité</span>
            <span>Coût U. HT</span>
            <span>Marge %</span>
            <span>Vente U. HT</span>
            <span>Total HT</span>
            <span />
          </div>
          {renderComponentReadRows(lineComponents)}
        </div>
      </div>
    );
  }

  function renderEditingOuvrage(key: string) {
    const retainedPriceInput = priceForced
      ? forcedUnitPriceEuros
      : calculatedUnitPrice === null
        ? "0,00"
        : centsToInput(calculatedUnitPrice);
    const number = editingLineId ? (numbers.get(editingLineId) ?? "—") : "+";
    const currentLineTotal = ouvrageTotalCents(quantityInput, effectiveUnitPrice);

    return (
      <form className="quoteOuvrageGroup quoteOuvrageEditing" key={key} onSubmit={saveOuvrage}>
        <div className="quoteMainRow quoteLineRow">
          <span className="quoteNumber">{number}</span>
          <input
            className="quoteInlineInput quoteDescriptionInput"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Désignation de l’ouvrage"
            required
          />
          <input
            className="quoteInlineInput"
            value={quantityInput}
            onChange={(event) => setQuantityInput(event.target.value)}
            required
            aria-label="Quantité ouvrage"
          />
          <input
            className="quoteInlineInput"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            aria-label="Unité ouvrage"
          />
          <div className="quoteInlinePrice">
            <input
              className="quoteInlineInput"
              inputMode="decimal"
              value={retainedPriceInput}
              onChange={(event) => {
                setPriceForced(true);
                setForcedUnitPriceEuros(event.target.value);
              }}
              aria-label="Prix unitaire HT ouvrage"
            />
            {priceForced ? (
              <button
                type="button"
                className="quoteResetPrice"
                onClick={resetForcedPrice}
                title="Revenir au prix calculé"
                aria-label="Revenir au prix calculé"
              >
                <RotateCcw size={12} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div className="quoteMarginCell">
            <strong>{formatPercent(currentMarginPercent)}</strong>
          </div>
          <strong className="quoteLineTotal">
            {currentLineTotal === null ? "—" : formatMoney(currentLineTotal)}
          </strong>
          <div className="quoteRowActions">
            <button
              type="submit"
              className="miniActionButton quoteSaveButton"
              disabled={saving}
              title="Enregistrer"
              aria-label="Enregistrer"
            >
              <Check size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="miniActionButton"
              onClick={closeForm}
              disabled={saving}
              title="Annuler"
              aria-label="Annuler"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="quoteComponentsTable quoteComponentsEditing">
          <div className="quoteComponentsHeader">
            <div className="quoteComponentTitleActions">
              <span>Composant</span>
              <button
                type="button"
                className="miniActionButton"
                onClick={addComponent}
                aria-label="Ajouter un composant libre"
                title="Ajouter un composant libre"
              >
                <Plus size={12} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="miniLibraryButton"
                onClick={() => void openLibraryPicker()}
                aria-label="Ajouter un composant depuis la Bibliothèque"
                title="Chercher un composant dans la Bibliothèque"
              >
                +B
              </button>
            </div>
            <span>Qté</span>
            <span>Unité</span>
            <span>Coût U. HT</span>
            <span>Marge %</span>
            <span>Vente U. HT</span>
            <span>Total HT</span>
            <span />
          </div>
          {components.map((component, index) => {
            const total = componentTotalCents(component);
            const marginPercent = componentMarginPercent(component);
            return (
              <div className="quoteComponentRow quoteComponentRowEditing" key={component.key}>
                <div className="quoteComponentNameEdit">
                  <input
                    className="quoteInlineInput"
                    value={component.description}
                    onChange={(event) =>
                      updateComponent(index, { description: event.target.value })
                    }
                    required
                    aria-label={`Désignation composant ${index + 1}`}
                  />
                  {component.libraryComponentId ? <small>B</small> : null}
                </div>
                <input
                  className="quoteInlineInput"
                  value={component.quantityInput}
                  onChange={(event) =>
                    updateComponent(index, { quantityInput: event.target.value })
                  }
                  required
                  aria-label={`Quantité composant ${index + 1}`}
                />
                <input
                  className="quoteInlineInput"
                  value={component.unit}
                  onChange={(event) => updateComponent(index, { unit: event.target.value })}
                  aria-label={`Unité composant ${index + 1}`}
                />
                <input
                  className="quoteInlineInput"
                  inputMode="decimal"
                  value={component.costPriceEuros}
                  onChange={(event) =>
                    updateComponent(index, { costPriceEuros: event.target.value })
                  }
                  placeholder="—"
                  aria-label={`Coût composant ${index + 1}`}
                />
                <span
                  className={
                    marginPercent !== null && marginPercent < 0 ? "quoteNegative" : "quotePositive"
                  }
                >
                  {formatPercent(marginPercent)}
                </span>
                <input
                  className="quoteInlineInput"
                  inputMode="decimal"
                  value={component.unitPriceEuros}
                  onChange={(event) =>
                    updateComponent(index, { unitPriceEuros: event.target.value })
                  }
                  required
                  aria-label={`Prix vente composant ${index + 1}`}
                />
                <strong>{total === null ? "—" : formatMoney(total)}</strong>
                <button
                  type="button"
                  className="quoteDeleteComponent"
                  onClick={() => removeComponent(index)}
                  disabled={components.length === 1}
                  aria-label={`Supprimer le composant ${index + 1}`}
                  title="Supprimer le composant"
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
            );
          })}
          {libraryPickerOpen ? (
            <div className="quoteLibraryPicker">
              <div className="quoteLibraryPickerTop">
                <div className="quoteLibrarySearch">
                  <Search size={14} aria-hidden="true" />
                  <input
                    value={libraryQuery}
                    onChange={(event) => setLibraryQuery(event.target.value)}
                    placeholder="Rechercher un composant…"
                    autoFocus
                  />
                </div>
                <button
                  type="button"
                  className="iconButton"
                  onClick={() => setLibraryPickerOpen(false)}
                  aria-label="Fermer la Bibliothèque"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
              {libraryLoading ? (
                <div className="quoteLibraryEmpty">Chargement…</div>
              ) : visibleLibraryComponents.length === 0 ? (
                <div className="quoteLibraryEmpty">Aucun composant trouvé.</div>
              ) : (
                <div className="quoteLibraryResults">
                  {visibleLibraryComponents.slice(0, 30).map((component) => (
                    <button
                      type="button"
                      className="quoteLibraryResult"
                      key={component.id}
                      onClick={() => chooseLibraryComponent(component)}
                    >
                      <span>
                        <strong>{component.name}</strong>
                        <small>
                          {component.unit} · marge {formatPercent(component.marginPercent)}
                        </small>
                      </span>
                      <strong>{formatMoney(component.salePriceCents)}</strong>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </form>
    );
  }

  function renderHeading(item: QuoteSection | QuoteSubsection) {
    const editing = headingEditor?.itemId === item.id;
    if (editing && headingEditor)
      return renderHeadingEditor(headingEditor, numbers.get(item.id) ?? "—");

    return (
      <div
        className={`quoteMainRow quoteHeadingRow ${item.kind === "SECTION" ? "isSection" : "isSubsection"}`}
        key={item.id}
      >
        <span className="quoteNumber">{numbers.get(item.id) ?? "—"}</span>
        <strong>{item.title}</strong>
        <span />
        <span />
        <span />
        <span />
        <span />
        <div className="quoteRowActions">
          {editable ? (
            <button
              type="button"
              className="iconButton"
              onClick={() => openEditHeading(item)}
              disabled={formOpen || headingEditor !== null}
              aria-label={`Modifier ${item.title}`}
              title="Modifier le titre"
            >
              <Pencil size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  function renderHeadingEditor(editor: NonNullable<HeadingEditor>, number = "+") {
    return (
      <form
        className={`quoteMainRow quoteHeadingRow quoteHeadingEditing ${editor.kind === "SECTION" ? "isSection" : "isSubsection"}`}
        key={editor.itemId ?? `new-${editor.kind}`}
        onSubmit={saveHeading}
      >
        <span className="quoteNumber">{number}</span>
        <input
          className="quoteInlineInput quoteDescriptionInput"
          value={editor.title}
          onChange={(event) => setHeadingEditor({ ...editor, title: event.target.value })}
          placeholder={editor.kind === "SECTION" ? "Grand titre" : "Sous-titre"}
          autoFocus
          required
          maxLength={500}
        />
        <span />
        <span />
        <span />
        <span />
        <span />
        <div className="quoteRowActions">
          <button
            type="submit"
            className="miniActionButton quoteSaveButton"
            disabled={saving}
            title="Enregistrer"
            aria-label="Enregistrer"
          >
            <Check size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="miniActionButton"
            onClick={() => setHeadingEditor(null)}
            disabled={saving}
            title="Annuler"
            aria-label="Annuler"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </form>
    );
  }

  if (!quote) return null;

  return (
    <section
      className="panel quoteLinesPanel"
      aria-label={`Contenu du devis ${quote.model.subject}`}
    >
      <div className="panelHeader quoteLinesHeader">
        <div>
          <p className="eyebrow">Devis</p>
          <h2>{quote.model.subject}</h2>
          <p className="muted">
            {quote.variantName} · V{quote.version} · {lines.length} ouvrage
            {lines.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="quoteLinesHeaderActions">{headerActions}</div>
      </div>

      {error ? <div className="quoteLineMessage quoteLineError">{error}</div> : null}
      {notice ? <div className="quoteLineMessage quoteLineNotice">{notice}</div> : null}

      <div className="quoteLinesTable">
        <div className="quoteMainRow quoteLinesTableHeader">
          <span>N°</span>
          <span>Désignation</span>
          <span>Qté</span>
          <span>Unité</span>
          <span>PU HT</span>
          <span>Marge</span>
          <span>Total HT</span>
          <span />
        </div>
        {items.map((item) => {
          if (item.kind === "SECTION" || item.kind === "SUBSECTION") return renderHeading(item);
          if (item.kind === "LINE")
            return formOpen && editingLineId === item.id
              ? renderEditingOuvrage(item.id)
              : renderReadOuvrage(item);
          return (
            <div className="quoteMainRow quoteCommentRow" key={item.id}>
              <span className="quoteNumber">{numbers.get(item.id) ?? "—"}</span>
              <span>{item.text}</span>
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
          );
        })}
        {headingEditor && !headingEditor.itemId ? renderHeadingEditor(headingEditor) : null}
        {formOpen && editingLineId === null ? renderEditingOuvrage("new-ouvrage") : null}
        {editable ? (
          <div className="quoteMainRow quoteAddRow">
            <span />
            <div className="quoteAddActions">
              <button
                type="button"
                onClick={openNewOuvrage}
                disabled={formOpen || headingEditor !== null}
              >
                <Plus size={13} aria-hidden="true" /> Ouvrage
              </button>
              <button
                type="button"
                onClick={() => openNewHeading("SECTION")}
                disabled={formOpen || headingEditor !== null}
              >
                <Plus size={13} aria-hidden="true" /> Titre
              </button>
              <button
                type="button"
                onClick={() => openNewHeading("SUBSECTION")}
                disabled={!lastSection || formOpen || headingEditor !== null}
              >
                <Plus size={13} aria-hidden="true" /> Sous-titre
              </button>
            </div>
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : null}
      </div>

      <style jsx global>{`
        .quoteLinesPanel {
          overflow: hidden;
        }
        .quoteLinesHeader,
        .quoteLinesHeaderActions,
        .quoteRowActions,
        .quoteComponentTitleActions,
        .quoteInlinePrice,
        .quoteForcedBadge,
        .quoteLibraryPickerTop,
        .quoteLibrarySearch,
        .quoteLibraryResult,
        .quoteComponentNameEdit,
        .quoteAddActions {
          display: flex;
          align-items: center;
        }
        .quoteLinesHeader {
          justify-content: space-between;
          gap: 16px;
        }
        .quoteLinesHeaderActions {
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }
        .quoteLinesHeader p,
        .quoteLinesHeader h2 {
          margin-bottom: 0;
        }
        .quoteLineMessage {
          margin: 0 18px 12px;
          padding: 9px 11px;
          border-radius: 7px;
          font-size: 12px;
          font-weight: 700;
        }
        .quoteLineError {
          background: #fff0f0;
          color: #9c3434;
        }
        .quoteLineNotice {
          background: #eef8f1;
          color: #31724b;
        }
        .quoteLinesTable {
          border-top: 1px solid var(--border);
          overflow-x: auto;
        }
        .quoteMainRow {
          display: grid;
          grid-template-columns: 52px minmax(300px, 1fr) 82px 72px 120px 120px 120px 82px;
          gap: 10px;
          align-items: center;
          padding: 9px 18px;
          min-width: 1040px;
        }
        .quoteLinesTableHeader {
          min-height: 38px;
          background: var(--surface-soft);
          color: var(--muted);
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .quoteNumber {
          font-weight: 900;
          color: #7867bb;
          font-variant-numeric: tabular-nums;
        }
        .quoteOuvrageGroup {
          min-width: 1040px;
          border-top: 1px solid var(--border);
        }
        .quoteOuvrageGroup:first-of-type {
          border-top: 0;
        }
        .quoteLineRow {
          min-height: 58px;
          font-size: 13px;
          background: #fff;
        }
        .quoteOuvrageEditing .quoteLineRow {
          background: #fbfaff;
        }
        .quoteLineDescription {
          min-width: 0;
          display: grid;
          gap: 2px;
        }
        .quoteLineDescription strong {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .quoteLineDescription small {
          color: var(--muted);
          font-size: 9px;
        }
        .quotePriceCell,
        .quoteMarginCell {
          min-width: 0;
          display: grid;
          gap: 3px;
          justify-items: start;
        }
        .quoteMarginCell {
          color: #31724b;
        }
        .quoteMarginCell.isNegative,
        .quoteNegative {
          color: #a53d3d;
        }
        .quoteMarginCell.isMissing {
          color: var(--muted);
          font-size: 10px;
          font-weight: 700;
        }
        .quotePositive {
          color: #31724b;
          font-weight: 800;
        }
        .quoteForcedBadge {
          width: fit-content;
          gap: 4px;
          padding: 3px 6px;
          border-radius: 999px;
          background: #ece7fa;
          color: #6554b5;
          font-size: 9px;
          font-weight: 800;
          white-space: nowrap;
        }
        .quoteRowActions {
          justify-content: flex-end;
          gap: 5px;
        }
        .quoteLineTotal {
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        .miniLibraryButton,
        .miniActionButton,
        .quoteResetPrice,
        .quoteDeleteComponent {
          display: inline-grid;
          place-items: center;
          padding: 0;
          border: 1px solid var(--border);
          background: #fff;
          color: var(--muted);
          cursor: pointer;
        }
        .miniLibraryButton {
          min-width: 30px;
          height: 28px;
          padding: 0 6px;
          border-color: #d7cfed;
          border-radius: 6px;
          color: #6554b5;
          font-size: 10px;
          font-weight: 900;
        }
        .miniActionButton,
        .quoteResetPrice,
        .quoteDeleteComponent {
          width: 26px;
          height: 26px;
          border-radius: 6px;
        }
        .miniLibraryButton:hover:not(:disabled),
        .miniActionButton:hover:not(:disabled),
        .quoteResetPrice:hover:not(:disabled),
        .quoteDeleteComponent:hover:not(:disabled) {
          border-color: var(--accent);
          color: var(--accent);
          background: #faf8ff;
        }
        .miniLibraryButton:disabled,
        .miniActionButton:disabled,
        .quoteResetPrice:disabled,
        .quoteDeleteComponent:disabled {
          opacity: 0.45;
          cursor: default;
        }
        .quoteSaveButton {
          color: #31724b;
        }
        .quoteInlineInput {
          width: 100%;
          min-width: 0;
          height: 32px;
          padding: 5px 7px;
          border: 1px solid #d7cfed;
          border-radius: 6px;
          background: #fff;
          color: var(--text);
          font: inherit;
        }
        .quoteInlineInput:focus {
          outline: 2px solid color-mix(in srgb, var(--accent) 22%, transparent);
          border-color: var(--accent);
        }
        .quoteDescriptionInput {
          font-weight: 750;
        }
        .quoteInlinePrice {
          gap: 4px;
        }
        .quoteInlinePrice .quoteInlineInput {
          flex: 1 1 auto;
        }
        .quoteResetPrice {
          flex: 0 0 26px;
        }
        .quoteComponentsTable {
          margin: 0 18px 12px 70px;
          min-width: 900px;
          overflow: hidden;
          border: 1px solid #e4def2;
          border-radius: 7px;
          background: #fcfbff;
        }
        .quoteComponentsEditing {
          border-color: #d7cfed;
          background: #fff;
        }
        .quoteComponentsHeader,
        .quoteComponentRow {
          display: grid;
          grid-template-columns: minmax(220px, 1fr) 82px 70px 105px 82px 105px 105px 34px;
          gap: 8px;
          align-items: center;
          padding: 7px 10px;
        }
        .quoteComponentsHeader {
          min-height: 36px;
          background: #f6f3fc;
          color: var(--muted);
          font-size: 9px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .quoteComponentRow {
          min-height: 40px;
          border-top: 1px solid #ebe6f4;
          font-size: 13px;
        }
        .quoteComponentTitleActions {
          gap: 5px;
        }
        .quoteComponentNameEdit {
          gap: 5px;
        }
        .quoteComponentNameEdit small {
          font-size: 9px;
          font-weight: 900;
          color: #6554b5;
        }
        .quoteComponentEmpty {
          padding: 14px;
          color: var(--muted);
          font-size: 11px;
        }
        .quoteLibraryPicker {
          margin: 8px;
          border: 1px solid #d7cfed;
          border-radius: 8px;
          overflow: hidden;
          background: #fff;
        }
        .quoteLibraryPickerTop {
          gap: 8px;
          padding: 8px;
          border-bottom: 1px solid #ece7f5;
        }
        .quoteLibrarySearch {
          flex: 1;
          gap: 6px;
        }
        .quoteLibrarySearch input {
          width: 100%;
          border: 0;
          outline: 0;
          background: transparent;
        }
        .quoteLibraryResults {
          max-height: 230px;
          overflow: auto;
        }
        .quoteLibraryResult {
          width: 100%;
          justify-content: space-between;
          gap: 12px;
          padding: 9px 11px;
          border: 0;
          border-top: 1px solid #f0edf6;
          background: #fff;
          text-align: left;
          cursor: pointer;
        }
        .quoteLibraryResult:hover {
          background: #faf8ff;
        }
        .quoteLibraryResult span {
          display: grid;
          gap: 2px;
        }
        .quoteLibraryResult small {
          color: var(--muted);
          font-size: 9px;
        }
        .quoteLibraryEmpty {
          padding: 14px;
          color: var(--muted);
          font-size: 11px;
        }
        .quoteHeadingRow {
          border-top: 1px solid var(--border);
          background: #fbfaff;
        }
        .quoteHeadingRow.isSection {
          min-height: 56px;
          background: #f1edfb;
        }
        .quoteHeadingRow.isSection > strong {
          font-size: 18px;
        }
        .quoteHeadingRow.isSubsection {
          min-height: 48px;
          background: #faf8ff;
        }
        .quoteHeadingRow.isSubsection > strong {
          padding-left: 14px;
          font-size: 15px;
        }
        .quoteHeadingEditing {
          background: #fff;
        }
        .quoteCommentRow {
          border-top: 1px solid var(--border);
          font-size: 11px;
          color: var(--muted);
        }
        .quoteAddRow {
          border-top: 1px dashed #d8d1e8;
          background: #fcfbff;
          min-height: 54px;
        }
        .quoteAddActions {
          gap: 7px;
        }
        .quoteAddActions button {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          height: 30px;
          padding: 0 10px;
          border: 1px solid #d7cfed;
          border-radius: 6px;
          background: #fff;
          color: #6554b5;
          font-size: 11px;
          font-weight: 800;
          cursor: pointer;
        }
        .quoteAddActions button:hover:not(:disabled) {
          border-color: var(--accent);
          color: var(--accent);
          background: #faf8ff;
        }
        .quoteAddActions button:disabled {
          opacity: 0.4;
          cursor: default;
        }
        @media (max-width: 1000px) {
          .quoteLinesTable {
            overflow-x: auto;
          }
          .quoteMainRow,
          .quoteOuvrageGroup {
            min-width: 1040px;
          }
          .quoteComponentsTable {
            min-width: 780px;
          }
        }
      `}</style>
    </section>
  );
}
