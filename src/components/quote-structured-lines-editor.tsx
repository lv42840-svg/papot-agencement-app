"use client";

import {
  type DragEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Check, Copy, LockKeyhole, Pencil, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import type { LibraryComponent } from "@/lib/library/component";
import {
  createInitialLibraryPayload,
  parseLibraryPayload,
  type LibraryPayload,
} from "@/lib/library/storage";
import { ensureRequiredLaborComponents } from "@/lib/library/required-labor-components";
import { productionActivityLabel, type ProductionActivity } from "@/lib/production-activity";
import { calculateQuoteAdjustedPricing } from "@/lib/quotes/adjustments";
import { duplicateQuoteComponent } from "@/lib/quotes/component-order";
import { parseQuoteQuantityInput } from "@/lib/quotes/domain";
import {
  publishQuoteComponentToLibrary,
  publishQuoteOuvrageToLibrary,
} from "@/lib/quotes/library-publish";
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
import type { QuoteItemPlacement } from "@/lib/quotes/item-reorder";
import {
  calculateQuoteMarginFromSalePrice,
  calculateQuoteSalePriceFromMarginCents,
  parseQuoteMarginInput,
  quoteMarginToInput,
  type QuotePricingDriver,
} from "@/lib/quotes/pricing";
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
  activity?: ProductionActivity;
  quantityInput: string;
  costPriceEuros: string;
  marginPercentInput: string;
  unitPriceEuros: string;
  pricingDriver: QuotePricingDriver;
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
    marginPercentInput: "0",
    unitPriceEuros: "0,00",
    pricingDriver: "MARGIN",
  };
}

function formFromLibraryComponent(component: LibraryComponent): OuvrageComponentForm {
  return {
    key: globalThis.crypto.randomUUID(),
    libraryComponentId: component.id,
    description: component.name,
    unit: component.unit,
    activity: component.activity,
    quantityInput: "1",
    costPriceEuros: centsToInput(component.costPriceCents),
    marginPercentInput: quoteMarginToInput(component.marginPercent),
    unitPriceEuros: centsToInput(component.salePriceCents),
    pricingDriver: "SALE_PRICE",
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
        activity: component.activity ?? component.librarySource?.component.activity,
        quantityInput: component.quantityFormula ?? String(component.quantity).replace(".", ","),
        costPriceEuros: costPriceCents === null ? "" : centsToInput(costPriceCents),
        marginPercentInput:
          costPriceCents === null
            ? ""
            : quoteMarginToInput(
                calculateQuoteMarginFromSalePrice(costPriceCents, component.unitPriceCents),
              ),
        unitPriceEuros: centsToInput(component.unitPriceCents),
        pricingDriver: "SALE_PRICE",
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
      marginPercentInput: "",
      unitPriceEuros: centsToInput(line.unitPriceCents ?? 0),
      pricingDriver: "SALE_PRICE",
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
    if (component.marginPercentInput.trim()) {
      return parseQuoteMarginInput(component.marginPercentInput);
    }
    const costPriceCents = optionalEurosToCents(component.costPriceEuros);
    if (costPriceCents === undefined) return null;
    return calculateQuoteMarginFromSalePrice(
      costPriceCents,
      eurosToCents(component.unitPriceEuros),
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
  if (code === "QUOTE_LINE_MOVE_BLOCKED") {
    return "Cet ouvrage ne peut pas être déplacé davantage dans ce bloc.";
  }
  if (code === "QUOTE_HEADING_MOVE_BLOCKED") {
    return "Ce titre ne peut pas être déplacé davantage à ce niveau.";
  }
  if (code === "QUOTE_HEADING_NOT_FOUND") return "Ce titre n’existe plus.";
  if (code === "QUOTE_ITEM_NOT_FOUND") return "Cet élément n’existe plus.";
  if (code === "QUOTE_ITEM_DELETE_UNSUPPORTED") return "Cet élément ne peut pas être supprimé ici.";
  if (code === "QUOTE_ITEM_REORDER_BLOCKED") {
    return "Dépose l’élément sur un emplacement compatible : titre, sous-titre ou ouvrage.";
  }
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

async function postQuotePricing(body: Record<string, unknown>): Promise<NativeQuotesPayload> {
  const response = await fetch("/api/desktop/quotes/pricing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as QuotesApiResponse;
  if (!response.ok || !data.payload) {
    throw new Error(data.error ?? "QUOTES_PRICING_MUTATION_FAILED");
  }
  return data.payload;
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
  const [forcedMarginPercentInput, setForcedMarginPercentInput] = useState("");
  const [ouvragePricingDriver, setOuvragePricingDriver] =
    useState<QuotePricingDriver>("SALE_PRICE");
  const [headingEditor, setHeadingEditor] = useState<HeadingEditor>(null);
  const [saving, setSaving] = useState(false);
  const [duplicatingLineId, setDuplicatingLineId] = useState<string | null>(null);
  const [duplicatingHeadingId, setDuplicatingHeadingId] = useState<string | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [togglingOptionItemId, setTogglingOptionItemId] = useState<string | null>(null);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [reorderingItemId, setReorderingItemId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    itemId: string;
    placement: QuoteItemPlacement;
  } | null>(null);
  const [draggingComponentKey, setDraggingComponentKey] = useState<string | null>(null);
  const [componentDropTarget, setComponentDropTarget] = useState<{
    key: string;
    placement: "BEFORE" | "AFTER";
  } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [libraryPayload, setLibraryPayload] = useState<LibraryPayload | null>(null);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [librarySavingLineId, setLibrarySavingLineId] = useState<string | null>(null);
  const [librarySavingComponentId, setLibrarySavingComponentId] = useState<string | null>(null);
  const [publishedLineIds, setPublishedLineIds] = useState<Set<string>>(new Set());

  const items = useMemo(() => quote?.model.items ?? [], [quote]);
  const lines = useMemo(
    () => items.filter((item): item is QuoteLine => item.kind === "LINE"),
    [items],
  );
  const adjustedLinesById = useMemo(() => {
    if (!quote) return new Map();
    const adjusted = calculateQuoteAdjustedPricing(quote.model.items, quote.pricingConfig);
    return new Map(adjusted.lines.map((line) => [line.lineId, line]));
  }, [quote]);
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
  const ouvrageMarginInput = priceForced
    ? forcedMarginPercentInput
    : quoteMarginToInput(currentMarginPercent);

  const visibleLibraryComponents = useMemo(() => {
    if (!libraryPayload) return [];
    const query = normalizeSearch(libraryQuery);
    return libraryPayload.components
      .filter((component) =>
        normalizeSearch(
          [
            component.name,
            component.description,
            component.unit,
            component.activity ? productionActivityLabel(component.activity) : "",
          ].join(" "),
        ).includes(query),
      )
      .sort((left, right) => left.name.localeCompare(right.name, "fr-FR", { sensitivity: "base" }));
  }, [libraryPayload, libraryQuery]);

  useEffect(() => {
    setFormOpen(false);
    setEditingLineId(null);
    setHeadingEditor(null);
    setDuplicatingLineId(null);
    setDuplicatingHeadingId(null);
    setDeletingItemId(null);
    setTogglingOptionItemId(null);
    setDraggingItemId(null);
    setReorderingItemId(null);
    setDropTarget(null);
    setDraggingComponentKey(null);
    setComponentDropTarget(null);
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

  useEffect(() => {
    if (!priceForced || ouvragePricingDriver !== "MARGIN" || calculatedUnitCost === null) return;
    try {
      const next = centsToInput(
        calculateQuoteSalePriceFromMarginCents(
          calculatedUnitCost,
          parseQuoteMarginInput(forcedMarginPercentInput),
        ),
      );
      setForcedUnitPriceEuros((current) => (current === next ? current : next));
    } catch {
      // Keep the partial margin input while editing.
    }
  }, [calculatedUnitCost, forcedMarginPercentInput, ouvragePricingDriver, priceForced]);

  useEffect(() => {
    if (!priceForced || ouvragePricingDriver !== "SALE_PRICE") return;
    if (calculatedUnitCost === null) {
      setForcedMarginPercentInput("");
      return;
    }
    try {
      const next = quoteMarginToInput(
        calculateQuoteMarginFromSalePrice(calculatedUnitCost, eurosToCents(forcedUnitPriceEuros)),
      );
      setForcedMarginPercentInput((current) => (current === next ? current : next));
    } catch {
      setForcedMarginPercentInput("");
    }
  }, [calculatedUnitCost, forcedUnitPriceEuros, ouvragePricingDriver, priceForced]);

  function resetForm() {
    setEditingLineId(null);
    setNewLineParentId(null);
    setDescription("");
    setUnit("u");
    setQuantityInput("1");
    setComponents([newComponentForm()]);
    setPriceForced(false);
    setForcedUnitPriceEuros("0,00");
    setForcedMarginPercentInput("");
    setOuvragePricingDriver("SALE_PRICE");
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
    const lineCost = calculateQuoteOuvrageUnitCostCents(line.components ?? []);
    setForcedMarginPercentInput(
      quoteMarginToInput(
        calculateQuoteMarginFromSalePrice(
          lineCost ?? 0,
          line.forcedUnitPriceCents ?? line.unitPriceCents ?? 0,
        ),
      ),
    );
    setOuvragePricingDriver("SALE_PRICE");
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

  async function deleteItem(item: QuoteLine | QuoteSection | QuoteSubsection) {
    if (
      !quote ||
      !editable ||
      deletingItemId ||
      duplicatingHeadingId ||
      duplicatingLineId ||
      formOpen ||
      headingEditor
    ) {
      return;
    }

    const label =
      item.kind === "LINE"
        ? "cet ouvrage"
        : item.kind === "SECTION"
          ? "ce titre et tout son contenu"
          : "ce sous-titre et tout son contenu";
    if (!window.confirm(`Supprimer ${label} ?`)) return;

    setDeletingItemId(item.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/desktop/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "deleteItem",
          quoteId: quote.id,
          itemId: item.id,
        }),
      });
      const data = (await response.json()) as QuotesApiResponse;
      if (!response.ok || !data.payload) {
        setError(lineErrorLabel(data.error ?? "QUOTES_MUTATION_FAILED"));
        return;
      }
      onSaved(data.payload);
      setNotice(
        item.kind === "LINE"
          ? "Ouvrage supprimé."
          : item.kind === "SECTION"
            ? "Titre supprimé avec son contenu."
            : "Sous-titre supprimé avec son contenu.",
      );
    } catch {
      setError("La suppression n’a pas pu être enregistrée.");
    } finally {
      setDeletingItemId(null);
    }
  }

  function resolveDropPlacement(
    event: DragEvent<HTMLElement>,
    target: QuoteItem,
  ): QuoteItemPlacement | null {
    if (!draggingItemId || draggingItemId === target.id) return null;
    const source = items.find((item) => item.id === draggingItemId);
    if (!source || source.kind === "COMMENT") return null;

    if (source.kind === "SECTION") {
      if (target.kind !== "SECTION") return null;
      const bounds = event.currentTarget.getBoundingClientRect();
      return event.clientY < bounds.top + bounds.height / 2 ? "BEFORE" : "AFTER";
    }

    if (source.kind === "SUBSECTION") {
      if (target.kind === "SECTION") return "INSIDE";
      if (target.kind !== "SUBSECTION") return null;
      const bounds = event.currentTarget.getBoundingClientRect();
      return event.clientY < bounds.top + bounds.height / 2 ? "BEFORE" : "AFTER";
    }

    if (target.kind === "SECTION" || target.kind === "SUBSECTION") return "INSIDE";
    if (target.kind !== "LINE") return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2 ? "BEFORE" : "AFTER";
  }

  function startItemDrag(
    event: DragEvent<HTMLElement>,
    item: QuoteLine | QuoteSection | QuoteSubsection,
  ) {
    const origin = event.target as HTMLElement;
    if (
      !editable ||
      formOpen ||
      headingEditor ||
      deletingItemId ||
      reorderingItemId ||
      origin.closest("button, input, textarea, select")
    ) {
      event.preventDefault();
      return;
    }
    setDraggingItemId(item.id);
    setDropTarget(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
  }

  function dragItemOver(event: DragEvent<HTMLElement>, target: QuoteItem) {
    const placement = resolveDropPlacement(event, target);
    if (!placement) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget((current) =>
      current?.itemId === target.id && current.placement === placement
        ? current
        : { itemId: target.id, placement },
    );
  }

  function finishItemDrag() {
    setDraggingItemId(null);
    setDropTarget(null);
  }

  async function reorderItem(itemId: string, target: QuoteItem, placement: QuoteItemPlacement) {
    if (!quote || !editable || reorderingItemId || itemId === target.id) return;
    const source = items.find((item) => item.id === itemId);
    if (!source || source.kind === "COMMENT") return;

    setReorderingItemId(itemId);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/desktop/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reorderItem",
          quoteId: quote.id,
          itemId,
          targetId: target.id,
          placement,
        }),
      });
      const data = (await response.json()) as QuotesApiResponse;
      if (!response.ok || !data.payload) {
        setError(lineErrorLabel(data.error ?? "QUOTES_MUTATION_FAILED"));
        return;
      }
      onSaved(data.payload);
      setNotice(
        source.kind === "LINE"
          ? "Ouvrage déplacé."
          : source.kind === "SECTION"
            ? "Titre déplacé avec son contenu."
            : "Sous-titre déplacé avec son contenu.",
      );
    } catch {
      setError("L’élément n’a pas pu être déplacé.");
    } finally {
      setReorderingItemId(null);
      finishItemDrag();
    }
  }

  function dropItem(event: DragEvent<HTMLElement>, target: QuoteItem) {
    const itemId = draggingItemId;
    const placement = resolveDropPlacement(event, target);
    if (!itemId || !placement) return;
    event.preventDefault();
    void reorderItem(itemId, target, placement);
  }

  function dropClass(itemId: string): string {
    const classes: string[] = [];
    if (draggingItemId === itemId) classes.push("isDragging");
    if (dropTarget?.itemId === itemId) {
      classes.push(
        dropTarget.placement === "BEFORE"
          ? "quoteDropBefore"
          : dropTarget.placement === "AFTER"
            ? "quoteDropAfter"
            : "quoteDropInside",
      );
    }
    return classes.length > 0 ? ` ${classes.join(" ")}` : "";
  }

  function directOptionForItem(itemId: string) {
    return quote?.pricingConfig.options.find((option) => option.targetItemId === itemId) ?? null;
  }

  async function toggleItemOption(item: QuoteLine | QuoteSection | QuoteSubsection) {
    if (!quote || !editable || togglingOptionItemId) return;
    const existing = directOptionForItem(item.id);
    const label = item.kind === "LINE" ? item.description : item.title;
    setTogglingOptionItemId(item.id);
    setError("");
    setNotice("");

    try {
      const payload = existing
        ? await postQuotePricing({
            action: "removeOption",
            quoteId: quote.id,
            optionId: existing.id,
          })
        : await postQuotePricing({
            action: "upsertOption",
            quoteId: quote.id,
            option: {
              id: globalThis.crypto.randomUUID(),
              targetItemId: item.id,
              targetKind: item.kind,
              label,
              status: "PENDING",
            },
          });
      onSaved(payload);
      setNotice(existing ? "Option retirée du devis." : "Élément placé en option hors total.");
    } catch {
      setError("L’option n’a pas pu être modifiée.");
    } finally {
      setTogglingOptionItemId(null);
    }
  }

  async function duplicateHeading(item: QuoteSection | QuoteSubsection) {
    if (
      !quote ||
      !editable ||
      duplicatingHeadingId ||
      duplicatingLineId ||
      formOpen ||
      headingEditor
    ) {
      return;
    }

    setDuplicatingHeadingId(item.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/desktop/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "duplicateHeading",
          quoteId: quote.id,
          itemId: item.id,
        }),
      });
      const data = (await response.json()) as QuotesApiResponse;
      if (!response.ok || !data.payload) {
        setError(lineErrorLabel(data.error ?? "QUOTES_MUTATION_FAILED"));
        return;
      }
      onSaved(data.payload);
      setNotice(
        item.kind === "SECTION"
          ? "Titre dupliqué avec son contenu."
          : "Sous-titre dupliqué avec son contenu.",
      );
    } catch {
      setError("Le titre n’a pas pu être dupliqué.");
    } finally {
      setDuplicatingHeadingId(null);
    }
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

  function updateComponentCost(index: number, value: string) {
    setComponents((current) =>
      current.map((component, componentIndex) => {
        if (componentIndex !== index) return component;
        const next = { ...component, costPriceEuros: value };
        try {
          const costPriceCents = optionalEurosToCents(value);
          if (costPriceCents === undefined) return { ...next, marginPercentInput: "" };
          if (component.pricingDriver === "MARGIN") {
            return {
              ...next,
              unitPriceEuros: centsToInput(
                calculateQuoteSalePriceFromMarginCents(
                  costPriceCents,
                  parseQuoteMarginInput(component.marginPercentInput),
                ),
              ),
            };
          }
          return {
            ...next,
            marginPercentInput: quoteMarginToInput(
              calculateQuoteMarginFromSalePrice(
                costPriceCents,
                eurosToCents(component.unitPriceEuros),
              ),
            ),
          };
        } catch {
          return next;
        }
      }),
    );
  }

  function updateComponentMargin(index: number, value: string) {
    setComponents((current) =>
      current.map((component, componentIndex) => {
        if (componentIndex !== index) return component;
        const next = {
          ...component,
          marginPercentInput: value,
          pricingDriver: "MARGIN" as const,
        };
        try {
          const costPriceCents = optionalEurosToCents(component.costPriceEuros);
          if (costPriceCents === undefined) return next;
          return {
            ...next,
            unitPriceEuros: centsToInput(
              calculateQuoteSalePriceFromMarginCents(costPriceCents, parseQuoteMarginInput(value)),
            ),
          };
        } catch {
          return next;
        }
      }),
    );
  }

  function updateComponentSalePrice(index: number, value: string) {
    setComponents((current) =>
      current.map((component, componentIndex) => {
        if (componentIndex !== index) return component;
        const next = {
          ...component,
          unitPriceEuros: value,
          pricingDriver: "SALE_PRICE" as const,
        };
        try {
          const costPriceCents = optionalEurosToCents(component.costPriceEuros);
          if (costPriceCents === undefined) return { ...next, marginPercentInput: "" };
          return {
            ...next,
            marginPercentInput: quoteMarginToInput(
              calculateQuoteMarginFromSalePrice(costPriceCents, eurosToCents(value)),
            ),
          };
        } catch {
          return next;
        }
      }),
    );
  }

  function updateOuvrageSalePrice(value: string) {
    setPriceForced(true);
    setOuvragePricingDriver("SALE_PRICE");
    setForcedUnitPriceEuros(value);
    try {
      if (calculatedUnitCost === null) {
        setForcedMarginPercentInput("");
        return;
      }
      setForcedMarginPercentInput(
        quoteMarginToInput(
          calculateQuoteMarginFromSalePrice(calculatedUnitCost, eurosToCents(value)),
        ),
      );
    } catch {
      setForcedMarginPercentInput("");
    }
  }

  function updateOuvrageMargin(value: string) {
    setPriceForced(true);
    setOuvragePricingDriver("MARGIN");
    setForcedMarginPercentInput(value);
    try {
      if (calculatedUnitCost === null) return;
      setForcedUnitPriceEuros(
        centsToInput(
          calculateQuoteSalePriceFromMarginCents(calculatedUnitCost, parseQuoteMarginInput(value)),
        ),
      );
    } catch {
      // Keep the partial input while the user is typing.
    }
  }

  function addComponent() {
    setComponents((current) => [...current, newComponentForm()]);
    setLibraryPickerOpen(false);
  }

  function startComponentDrag(event: DragEvent<HTMLDivElement>, key: string) {
    const origin = event.target as HTMLElement;
    if (saving || origin.closest("button, input, textarea, select")) {
      event.preventDefault();
      return;
    }
    setDraggingComponentKey(key);
    setComponentDropTarget(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", key);
  }

  function dragComponentOver(event: DragEvent<HTMLDivElement>, key: string) {
    if (!draggingComponentKey || draggingComponentKey === key) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY < bounds.top + bounds.height / 2 ? "BEFORE" : "AFTER";
    event.dataTransfer.dropEffect = "move";
    setComponentDropTarget((current) =>
      current?.key === key && current.placement === placement ? current : { key, placement },
    );
  }

  function finishComponentDrag() {
    setDraggingComponentKey(null);
    setComponentDropTarget(null);
  }

  function dropComponent(event: DragEvent<HTMLDivElement>, targetKey: string) {
    if (!draggingComponentKey || draggingComponentKey === targetKey) return;
    event.preventDefault();
    const placement =
      componentDropTarget?.key === targetKey ? componentDropTarget.placement : "BEFORE";
    setComponents((current) => {
      const sourceIndex = current.findIndex((component) => component.key === draggingComponentKey);
      if (sourceIndex < 0) return current;
      const sourceComponent = current[sourceIndex];
      const remaining = current.filter((_, index) => index !== sourceIndex);
      const targetIndex = remaining.findIndex((component) => component.key === targetKey);
      if (targetIndex < 0) return current;
      const insertionIndex = placement === "AFTER" ? targetIndex + 1 : targetIndex;
      return [
        ...remaining.slice(0, insertionIndex),
        sourceComponent,
        ...remaining.slice(insertionIndex),
      ];
    });
    finishComponentDrag();
  }

  function componentDropClass(key: string): string {
    const classes: string[] = [];
    if (draggingComponentKey === key) classes.push("isDragging");
    if (componentDropTarget?.key === key) {
      classes.push(
        componentDropTarget.placement === "BEFORE"
          ? "quoteComponentDropBefore"
          : "quoteComponentDropAfter",
      );
    }
    return classes.length > 0 ? ` ${classes.join(" ")}` : "";
  }

  function duplicateComponent(index: number) {
    setComponents((current) =>
      duplicateQuoteComponent(current, index, () => globalThis.crypto.randomUUID()),
    );
  }

  function removeComponent(index: number) {
    setComponents((current) => {
      if (current.length <= 1) return current;
      return current.filter((_, componentIndex) => componentIndex !== index);
    });
  }

  function resetForcedPrice() {
    setPriceForced(false);
    setOuvragePricingDriver("SALE_PRICE");
    setForcedUnitPriceEuros(centsToInput(calculatedUnitPrice ?? 0));
    setForcedMarginPercentInput(
      quoteMarginToInput(
        calculatedUnitPrice === null
          ? null
          : calculateQuoteMarginFromSalePrice(calculatedUnitCost ?? 0, calculatedUnitPrice),
      ),
    );
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
      setLibraryPayload(ensureRequiredLaborComponents(data.payload));
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
            activity: component.activity,
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

  async function duplicateOuvrage(line: QuoteLine) {
    if (!quote || !editable || duplicatingLineId || formOpen || headingEditor) return;
    setDuplicatingLineId(line.id);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/desktop/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "duplicateLine",
          quoteId: quote.id,
          lineId: line.id,
        }),
      });
      const data = (await response.json()) as QuotesApiResponse;
      if (!response.ok || !data.payload) {
        setError(lineErrorLabel(data.error ?? "QUOTES_MUTATION_FAILED"));
        return;
      }
      onSaved(data.payload);
      setNotice("Ouvrage dupliqué.");
    } catch {
      setError("L’ouvrage n’a pas pu être dupliqué.");
    } finally {
      setDuplicatingLineId(null);
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

      const basePayload = ensureRequiredLaborComponents(
        opened.resource
          ? parseLibraryPayload(opened.resource.payload)
          : createInitialLibraryPayload(),
      );
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

  async function addComponentToLibrary(component: QuoteOuvrageComponent) {
    if (!editable || librarySavingLineId || librarySavingComponentId) return;
    setLibrarySavingComponentId(component.id);
    setError("");
    setNotice("");
    const leaseId = globalThis.crypto.randomUUID();
    let leaseOwned = false;

    try {
      const opened = (await postLibrary({ action: "open", leaseId })) as LibraryOpenResponse;
      if (opened.status === "error") throw new Error(opened.error);
      if (opened.status === "read-only") throw new Error("LIBRARY_LOCKED");
      leaseOwned = true;

      const basePayload = ensureRequiredLaborComponents(
        opened.resource
          ? parseLibraryPayload(opened.resource.payload)
          : createInitialLibraryPayload(),
      );
      let published = publishQuoteComponentToLibrary(basePayload, component);
      const linkedComponentId = component.librarySource?.component.sourceComponentId;
      const canOverwriteLinked =
        published.created &&
        linkedComponentId !== undefined &&
        basePayload.components.some((item) => item.id === linkedComponentId);

      if (canOverwriteLinked) {
        const overwrite = window.confirm(
          "Ce composant vient de la Bibliothèque et a été modifié.\n\nOK : mettre à jour le composant existant\nAnnuler : créer un nouveau composant",
        );
        if (overwrite) {
          published = publishQuoteComponentToLibrary(
            basePayload,
            component,
            () => globalThis.crypto.randomUUID(),
            "OVERWRITE_LINKED",
          );
        }
      }

      if (!published.created && !published.updated) {
        setLibraryPayload(published.payload);
        setNotice("Composant déjà présent dans la Bibliothèque.");
        return;
      }

      const saved = (await postLibrary({
        action: "save",
        leaseId,
        expectedVersion: opened.baseVersion,
        payload: published.payload,
      })) as LibrarySaveResponse;

      if (saved.status === "error") throw new Error(saved.error);
      if (saved.status === "conflict") throw new Error("LIBRARY_VERSION_CONFLICT");

      setLibraryPayload(parseLibraryPayload(saved.resource.payload));
      setNotice(
        published.updated
          ? "Composant mis à jour dans la Bibliothèque."
          : "Composant ajouté à la Bibliothèque.",
      );
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
      setLibrarySavingComponentId(null);
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
          <div className="quoteComponentLabel">
            <strong>{component.description}</strong>
            {component.activity ? (
              <small className="quoteActivityTag">
                {productionActivityLabel(component.activity)}
              </small>
            ) : null}
          </div>
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
          <div className="quoteRowActions">
            {editable ? (
              <button
                type="button"
                className="miniLibraryButton"
                onClick={() => void addComponentToLibrary(component)}
                disabled={librarySavingLineId !== null || librarySavingComponentId !== null}
                aria-label={`Ajouter ou mettre à jour ${component.description} dans la Bibliothèque`}
                title="Ajouter à la Bibliothèque ou mettre à jour le composant lié"
              >
                {librarySavingComponentId === component.id ? "…" : "+B"}
              </button>
            ) : null}
          </div>
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
    const baseLineTotalCents = Math.round(line.quantity * salePriceCents);
    const adjustedLine = adjustedLinesById.get(line.id);
    const lineTotalCents = adjustedLine?.saleCents ?? baseLineTotalCents;
    const adjustmentDeltaCents = lineTotalCents - baseLineTotalCents;
    const directOption = directOptionForItem(line.id);

    return (
      <div
        className={`quoteOuvrageGroup quoteDraggableItem${dropClass(line.id)}`}
        key={line.id}
        draggable={editable && !formOpen && headingEditor === null && reorderingItemId === null}
        onDragStart={(event) => startItemDrag(event, line)}
        onDragOver={(event) => dragItemOver(event, line)}
        onDrop={(event) => dropItem(event, line)}
        onDragEnd={finishItemDrag}
        title={editable ? "Glisser-déposer pour déplacer l’ouvrage" : undefined}
      >
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
          <div className="quoteLineTotalCell">
            <strong className="quoteLineTotal">{formatMoney(lineTotalCents)}</strong>
            {adjustmentDeltaCents !== 0 ? (
              <small>incl. {formatMoney(adjustmentDeltaCents)} d’ajustements</small>
            ) : null}
          </div>
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
                  className={`miniOptionButton${directOption ? " isActive" : ""}`}
                  onClick={() => void toggleItemOption(line)}
                  disabled={togglingOptionItemId !== null}
                  aria-label={
                    directOption
                      ? `Retirer ${line.description} des options`
                      : `Mettre ${line.description} en option`
                  }
                  title={directOption ? "Retirer l’option" : "Mettre en option hors total"}
                >
                  O
                </button>
                <button
                  type="button"
                  className="iconButton"
                  onClick={() => void duplicateOuvrage(line)}
                  disabled={formOpen || headingEditor !== null || duplicatingLineId !== null}
                  aria-label={`Dupliquer ${line.description}`}
                  title="Dupliquer l’ouvrage"
                >
                  <Copy size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="iconButton"
                  onClick={() => openEditOuvrage(line)}
                  disabled={
                    formOpen ||
                    headingEditor !== null ||
                    duplicatingLineId !== null ||
                    deletingItemId !== null
                  }
                  aria-label={`Modifier ${line.description}`}
                  title="Modifier l’ouvrage"
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="iconButton quoteDeleteItemButton"
                  onClick={() => void deleteItem(line)}
                  disabled={
                    formOpen ||
                    headingEditor !== null ||
                    duplicatingLineId !== null ||
                    deletingItemId !== null
                  }
                  aria-label={`Supprimer ${line.description}`}
                  title="Supprimer l’ouvrage"
                >
                  <Trash2 size={14} aria-hidden="true" />
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
              onChange={(event) => updateOuvrageSalePrice(event.target.value)}
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
            <input
              className="quoteInlineInput"
              inputMode="decimal"
              value={ouvrageMarginInput}
              onChange={(event) => updateOuvrageMargin(event.target.value)}
              aria-label="Marge pourcentage ouvrage"
              title="Saisir la marge pour calculer le prix de vente"
            />
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
              <div
                className={`quoteComponentRow quoteComponentRowEditing quoteComponentDraggable${componentDropClass(component.key)}`}
                key={component.key}
                draggable={!saving}
                onDragStart={(event) => startComponentDrag(event, component.key)}
                onDragOver={(event) => dragComponentOver(event, component.key)}
                onDrop={(event) => dropComponent(event, component.key)}
                onDragEnd={finishComponentDrag}
                title="Glisser-déposer pour déplacer le composant"
              >
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
                  {component.activity ? (
                    <small className="quoteActivityTag">
                      {productionActivityLabel(component.activity)}
                    </small>
                  ) : component.libraryComponentId ? (
                    <small>B</small>
                  ) : null}
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
                  onChange={(event) => updateComponentCost(index, event.target.value)}
                  placeholder="—"
                  aria-label={`Coût composant ${index + 1}`}
                />
                <input
                  className={`quoteInlineInput${
                    marginPercent !== null && marginPercent < 0 ? " quoteNegative" : ""
                  }`}
                  inputMode="decimal"
                  value={component.marginPercentInput}
                  onChange={(event) => updateComponentMargin(index, event.target.value)}
                  placeholder="n/c"
                  aria-label={`Marge composant ${index + 1}`}
                  title="Saisir la marge pour calculer le prix de vente"
                />
                <input
                  className="quoteInlineInput"
                  inputMode="decimal"
                  value={component.unitPriceEuros}
                  onChange={(event) => updateComponentSalePrice(index, event.target.value)}
                  required
                  aria-label={`Prix vente composant ${index + 1}`}
                />
                <strong>{total === null ? "—" : formatMoney(total)}</strong>
                <div className="quoteComponentActions">
                  <button
                    type="button"
                    className="miniActionButton"
                    onClick={() => duplicateComponent(index)}
                    aria-label={`Dupliquer le composant ${index + 1}`}
                    title="Dupliquer le composant"
                  >
                    <Copy size={13} aria-hidden="true" />
                  </button>
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
                          {component.activity
                            ? `${productionActivityLabel(component.activity)} · `
                            : ""}
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
    const directOption = directOptionForItem(item.id);

    return (
      <div
        className={`quoteMainRow quoteHeadingRow quoteDraggableItem ${item.kind === "SECTION" ? "isSection" : "isSubsection"}${dropClass(item.id)}`}
        key={item.id}
        draggable={editable && !formOpen && headingEditor === null && reorderingItemId === null}
        onDragStart={(event) => startItemDrag(event, item)}
        onDragOver={(event) => dragItemOver(event, item)}
        onDrop={(event) => dropItem(event, item)}
        onDragEnd={finishItemDrag}
        title={editable ? "Glisser-déposer pour déplacer ce bloc" : undefined}
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
            <>
              <button
                type="button"
                className={`miniOptionButton${directOption ? " isActive" : ""}`}
                onClick={() => void toggleItemOption(item)}
                disabled={togglingOptionItemId !== null}
                aria-label={
                  directOption
                    ? `Retirer ${item.title} des options`
                    : `Mettre ${item.title} en option`
                }
                title={directOption ? "Retirer l’option" : "Mettre en option hors total"}
              >
                O
              </button>
              <button
                type="button"
                className="iconButton"
                onClick={() => void duplicateHeading(item)}
                disabled={
                  formOpen ||
                  headingEditor !== null ||
                  duplicatingHeadingId !== null ||
                  duplicatingLineId !== null
                }
                aria-label={`Dupliquer ${item.title}`}
                title={item.kind === "SECTION" ? "Dupliquer le titre" : "Dupliquer le sous-titre"}
              >
                <Copy size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="iconButton"
                onClick={() => openEditHeading(item)}
                disabled={formOpen || headingEditor !== null || deletingItemId !== null}
                aria-label={`Modifier ${item.title}`}
                title="Modifier le titre"
              >
                <Pencil size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="iconButton quoteDeleteItemButton"
                onClick={() => void deleteItem(item)}
                disabled={
                  formOpen ||
                  headingEditor !== null ||
                  duplicatingHeadingId !== null ||
                  duplicatingLineId !== null ||
                  deletingItemId !== null
                }
                aria-label={`Supprimer ${item.title}`}
                title={
                  item.kind === "SECTION"
                    ? "Supprimer le titre et son contenu"
                    : "Supprimer le sous-titre et son contenu"
                }
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </>
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
          {editable ? (
            <p className="quoteDragHint">
              Glisse titres, sous-titres, ouvrages et composants pour les réorganiser.
            </p>
          ) : null}
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
        .quoteComponentActions,
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
        .quoteDeleteItemButton {
          color: #a53d3d;
        }
        .quoteDragHint {
          margin: 4px 0 0;
          color: var(--muted);
          font-size: 10px;
        }
        .quoteDraggableItem[draggable="true"] {
          cursor: grab;
        }
        .quoteDraggableItem.isDragging {
          opacity: 0.45;
        }
        .quoteDropBefore {
          box-shadow: inset 0 3px 0 #7867bb;
        }
        .quoteDropAfter {
          box-shadow: inset 0 -3px 0 #7867bb;
        }
        .quoteDropInside {
          outline: 2px dashed #7867bb;
          outline-offset: -3px;
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
          grid-template-columns: 44px minmax(250px, 1fr) 64px 56px 104px 100px 110px 170px;
          gap: 8px;
          align-items: center;
          padding: 9px 14px;
          min-width: 980px;
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
          min-width: 980px;
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
        .quoteLineTotalCell {
          min-width: 0;
          display: grid;
          gap: 2px;
          justify-items: start;
        }
        .quoteLineTotalCell small {
          color: #7867bb;
          font-size: 9px;
          font-weight: 800;
          white-space: nowrap;
        }
        .quoteLineTotal {
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        .miniLibraryButton,
        .miniOptionButton,
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
        .miniLibraryButton,
        .miniOptionButton {
          min-width: 30px;
          height: 28px;
          padding: 0 6px;
          border-color: #d7cfed;
          border-radius: 6px;
          color: #6554b5;
          font-size: 10px;
          font-weight: 900;
        }
        .miniOptionButton.isActive {
          border-color: #8c78c7;
          background: #e9e2fb;
          color: #4f3c93;
          box-shadow: inset 0 0 0 1px #cfc2ef;
        }
        .miniActionButton,
        .quoteResetPrice,
        .quoteDeleteComponent {
          width: 26px;
          height: 26px;
          border-radius: 6px;
        }
        .miniLibraryButton:hover:not(:disabled),
        .miniOptionButton:hover:not(:disabled),
        .miniActionButton:hover:not(:disabled),
        .quoteResetPrice:hover:not(:disabled),
        .quoteDeleteComponent:hover:not(:disabled) {
          border-color: var(--accent);
          color: var(--accent);
          background: #faf8ff;
        }
        .miniLibraryButton:disabled,
        .miniOptionButton:disabled,
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
          grid-template-columns: minmax(220px, 1fr) 76px 64px 100px 78px 100px 100px 70px;
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
        .quoteComponentActions {
          justify-content: flex-end;
          gap: 4px;
        }
        .quoteComponentDraggable[draggable="true"] {
          cursor: grab;
        }
        .quoteComponentDraggable.isDragging {
          opacity: 0.45;
        }
        .quoteComponentDropBefore {
          box-shadow: inset 0 3px 0 #7867bb;
        }
        .quoteComponentDropAfter {
          box-shadow: inset 0 -3px 0 #7867bb;
        }
        .quoteComponentNameEdit,
        .quoteComponentLabel {
          gap: 5px;
        }
        .quoteComponentLabel {
          display: flex;
          align-items: center;
          min-width: 0;
        }
        .quoteActivityTag {
          flex: 0 0 auto;
          padding: 2px 5px;
          border-radius: 999px;
          background: #ece7fa;
          color: #6554b5;
          font-size: 8px;
          font-weight: 900;
          text-transform: uppercase;
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
            min-width: 980px;
          }
          .quoteComponentsTable {
            min-width: 780px;
          }
        }
      `}</style>
    </section>
  );
}
