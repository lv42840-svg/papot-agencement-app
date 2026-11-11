"use client";

import {
  type DragEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Check,
  Copy,
  ImagePlus,
  LockKeyhole,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { QuoteItemPresentationPanel } from "@/components/quote-item-presentation-panel";
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
import { quoteRevisionHeaders } from "@/lib/quotes/concurrency";
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
import { quoteItemTextStyleToCss } from "@/lib/quotes/presentation";
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

function formatPercent(valeur: number | null): string {
  return valeur === null ? "n/c" : `${percentFormatter.format(valeur)} %`;
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function eurosToCents(valeur: string): number {
  const euros = Number(valeur.trim().replace(",", "."));
  if (!Number.isFinite(euros) || euros < 0) throw new Error("PRICE_INVALID");
  const cents = Math.round(euros * 100);
  if (!Number.isSafeInteger(cents)) throw new Error("PRICE_INVALID");
  return cents;
}

function optionalEurosToCents(valeur: string): number | undefined {
  if (!valeur.trim()) return undefined;
  return eurosToCents(valeur);
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

function formsFromLine(ligne: QuoteLine): OuvrageComponentForm[] {
  const lineComponents = ligne.components ?? [];
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
      key: `legacy-${ligne.id}`,
      description: ligne.description,
      unit: ligne.unit || "u",
      quantityInput: "1",
      costPriceEuros: "",
      marginPercentInput: "",
      unitPriceEuros: centsToInput(ligne.unitPriceCents ?? 0),
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
  if (code === "QUOTE_VERSION_CONFLICT")
    return "Ce devis a été modifié ailleurs. Recharge-le avant de recommencer.";
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

function normalizeSearch(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .trim();
}

function latestSection(elements: QuoteItem[]): QuoteSection | null {
  for (let indice = elements.length - 1; indice >= 0; indice -= 1) {
    const element = elements[indice];
    if (element.kind === "SECTION") return element;
  }
  return null;
}

function currentInsertionParentId(elements: QuoteItem[]): string | null {
  for (let indice = elements.length - 1; indice >= 0; indice -= 1) {
    const element = elements[indice];
    if (element.kind === "SECTION" || element.kind === "SUBSECTION") return element.id;
    if (element.kind === "LINE" || element.kind === "COMMENT") return element.parentId;
  }
  return null;
}

async function postLibrary(corps: Record<string, unknown>) {
  const reponse = await fetch("/api/desktop/library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
  });
  const donnees = (await reponse.json()) as LibraryOpenResponse | LibrarySaveResponse;
  if (!reponse.ok) {
    const erreur = "error" in donnees ? donnees.error : "LIBRARY_REQUEST_FAILED";
    throw new Error(erreur);
  }
  return donnees;
}

async function postQuotePricing(
  corps: Record<string, unknown>,
  updatedAt: string,
): Promise<NativeQuotesPayload> {
  const reponse = await fetch("/api/desktop/quotes/pricing", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...quoteRevisionHeaders(updatedAt),
    },
    body: JSON.stringify(corps),
  });
  const donnees = (await reponse.json()) as QuotesApiResponse;
  if (!reponse.ok || !donnees.payload) {
    throw new Error(donnees.error ?? "QUOTES_PRICING_MUTATION_FAILED");
  }
  return donnees.payload;
}

export function QuoteStructuredLinesEditor({
  quote,
  canWrite,
  onSaved,
  headerActions,
}: {
  quote: NativeQuoteRecord | null;
  canWrite: boolean;
  onSaved: (contenu: NativeQuotesPayload) => void;
  headerActions?: ReactNode;
}) {
  const postQuotePricingForQuote = (corps: Record<string, unknown>) => {
    if (!quote) throw new Error("QUOTE_NOT_FOUND");
    return postQuotePricing(corps, quote.updatedAt);
  };

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
  const [sauvegardeEnCours, setSaving] = useState(false);
  const [duplicatingLineId, setDuplicatingLineId] = useState<string | null>(null);
  const [duplicatingHeadingId, setDuplicatingHeadingId] = useState<string | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [togglingOptionItemId, setTogglingOptionItemId] = useState<string | null>(null);
  const [presentationItemId, setPresentationItemId] = useState<string | null>(null);
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
  const [erreur, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [libraryPayload, setLibraryPayload] = useState<LibraryPayload | null>(null);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [librarySavingLineId, setLibrarySavingLineId] = useState<string | null>(null);
  const [librarySavingComponentId, setLibrarySavingComponentId] = useState<string | null>(null);
  const [publishedLineIds, setPublishedLineIds] = useState<Set<string>>(new Set());

  const elements = useMemo(() => quote?.model.items ?? [], [quote]);
  const lignes = useMemo(
    () => elements.filter((element): element is QuoteLine => element.kind === "LINE"),
    [elements],
  );
  const adjustedLinesById = useMemo(() => {
    if (!quote) return new Map();
    const adjusted = calculateQuoteAdjustedPricing(quote.model.items, quote.pricingConfig);
    return new Map(adjusted.lines.map((ligne) => [ligne.lineId, ligne]));
  }, [quote]);
  const itemById = useMemo(
    () => new Map(elements.map((element) => [element.id, element])),
    [elements],
  );
  const optionByTargetId = useMemo(
    () =>
      new Map((quote?.pricingConfig.options ?? []).map((option) => [option.targetItemId, option])),
    [quote],
  );
  const headingTotalsById = useMemo(() => {
    const totals = new Map<string, number>();

    const headingOption = (headingId: string) => {
      const heading = itemById.get(headingId);
      if (!heading || (heading.kind !== "SECTION" && heading.kind !== "SUBSECTION")) return null;
      const direct = optionByTargetId.get(heading.id);
      if (direct) return direct;
      return heading.kind === "SUBSECTION"
        ? (optionByTargetId.get(heading.parentId) ?? null)
        : null;
    };

    const belongsToHeading = (
      headingId: string,
      adjusted: NonNullable<ReturnType<typeof adjustedLinesById.get>>,
    ) => {
      const option = headingOption(headingId);
      if (option) {
        return adjusted.optionId === option.id && adjusted.optionStatus !== "REJECTED";
      }
      return adjusted.optionStatus !== "PENDING" && adjusted.optionStatus !== "REJECTED";
    };

    for (const ligne of lignes) {
      const adjusted = adjustedLinesById.get(ligne.id);
      if (!adjusted || !ligne.parentId) continue;
      const montant = adjusted.saleCents;

      if (belongsToHeading(ligne.parentId, adjusted)) {
        totals.set(ligne.parentId, (totals.get(ligne.parentId) ?? 0) + montant);
      }

      const parent = itemById.get(ligne.parentId);
      if (parent?.kind === "SUBSECTION" && belongsToHeading(parent.parentId, adjusted)) {
        totals.set(parent.parentId, (totals.get(parent.parentId) ?? 0) + montant);
      }
    }
    return totals;
  }, [adjustedLinesById, itemById, lignes, optionByTargetId]);
  const numbers = useMemo(() => buildQuoteItemNumbers(elements), [elements]);
  const lastSection = useMemo(() => latestSection(elements), [elements]);
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
    const requeteRecherche = normalizeSearch(libraryQuery);
    return libraryPayload.components
      .filter((component) =>
        normalizeSearch(
          [
            component.name,
            component.description,
            component.unit,
            component.activity ? productionActivityLabel(component.activity) : "",
          ].join(" "),
        ).includes(requeteRecherche),
      )
      .sort((gauche, droite) =>
        gauche.name.localeCompare(droite.name, "fr-FR", { sensitivity: "base" }),
      );
  }, [libraryPayload, libraryQuery]);

  useEffect(() => {
    setFormOpen(false);
    setEditingLineId(null);
    setHeadingEditor(null);
    setDuplicatingLineId(null);
    setDuplicatingHeadingId(null);
    setDeletingItemId(null);
    setTogglingOptionItemId(null);
    setPresentationItemId(null);
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
      const suivant = centsToInput(
        calculateQuoteSalePriceFromMarginCents(
          calculatedUnitCost,
          parseQuoteMarginInput(forcedMarginPercentInput),
        ),
      );
      setForcedUnitPriceEuros((courant) => (courant === suivant ? courant : suivant));
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
      const suivant = quoteMarginToInput(
        calculateQuoteMarginFromSalePrice(calculatedUnitCost, eurosToCents(forcedUnitPriceEuros)),
      );
      setForcedMarginPercentInput((courant) => (courant === suivant ? courant : suivant));
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
    setNewLineParentId(currentInsertionParentId(elements));
    setFormOpen(true);
  }

  function openEditOuvrage(ligne: QuoteLine) {
    if (!editable || headingEditor) return;
    setEditingLineId(ligne.id);
    setNewLineParentId(null);
    setDescription(ligne.description);
    setUnit(ligne.unit || "u");
    setQuantityInput(ligne.quantityFormula ?? String(ligne.quantity).replace(".", ","));
    setComponents(formsFromLine(ligne));
    setPriceForced(ligne.forcedUnitPriceCents !== undefined);
    setForcedUnitPriceEuros(centsToInput(ligne.forcedUnitPriceCents ?? ligne.unitPriceCents ?? 0));
    const lineCost = calculateQuoteOuvrageUnitCostCents(ligne.components ?? []);
    setForcedMarginPercentInput(
      quoteMarginToInput(
        calculateQuoteMarginFromSalePrice(
          lineCost ?? 0,
          ligne.forcedUnitPriceCents ?? ligne.unitPriceCents ?? 0,
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

  function openEditHeading(element: QuoteSection | QuoteSubsection) {
    if (!editable || formOpen) return;
    setError("");
    setHeadingEditor({
      kind: element.kind,
      itemId: element.id,
      parentId: element.kind === "SUBSECTION" ? element.parentId : undefined,
      title: element.title,
    });
  }

  async function deleteItem(element: QuoteLine | QuoteSection | QuoteSubsection) {
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

    const libelle =
      element.kind === "LINE"
        ? "cet ouvrage"
        : element.kind === "SECTION"
          ? "ce titre et tout son contenu"
          : "ce sous-titre et tout son contenu";
    if (!window.confirm(`Supprimer ${libelle} ?`)) return;

    setDeletingItemId(element.id);
    setError("");
    setNotice("");
    try {
      const reponse = await fetch("/api/desktop/quotes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...quoteRevisionHeaders(quote.updatedAt),
        },
        body: JSON.stringify({
          action: "deleteItem",
          quoteId: quote.id,
          itemId: element.id,
        }),
      });
      const donnees = (await reponse.json()) as QuotesApiResponse;
      if (!reponse.ok || !donnees.payload) {
        setError(lineErrorLabel(donnees.error ?? "QUOTES_MUTATION_FAILED"));
        return;
      }
      onSaved(donnees.payload);
      setNotice(
        element.kind === "LINE"
          ? "Ouvrage supprimé."
          : element.kind === "SECTION"
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
    evenement: DragEvent<HTMLElement>,
    cible: QuoteItem,
  ): QuoteItemPlacement | null {
    if (!draggingItemId || draggingItemId === cible.id) return null;
    const source = elements.find((element) => element.id === draggingItemId);
    if (!source || source.kind === "COMMENT") return null;

    if (source.kind === "SECTION") {
      if (cible.kind !== "SECTION") return null;
      const bounds = evenement.currentTarget.getBoundingClientRect();
      return evenement.clientY < bounds.top + bounds.height / 2 ? "BEFORE" : "AFTER";
    }

    if (source.kind === "SUBSECTION") {
      if (cible.kind === "SECTION") return "INSIDE";
      if (cible.kind !== "SUBSECTION") return null;
      const bounds = evenement.currentTarget.getBoundingClientRect();
      return evenement.clientY < bounds.top + bounds.height / 2 ? "BEFORE" : "AFTER";
    }

    if (cible.kind === "SECTION" || cible.kind === "SUBSECTION") return "INSIDE";
    if (cible.kind !== "LINE") return null;
    const bounds = evenement.currentTarget.getBoundingClientRect();
    return evenement.clientY < bounds.top + bounds.height / 2 ? "BEFORE" : "AFTER";
  }

  function startItemDrag(
    evenement: DragEvent<HTMLElement>,
    element: QuoteLine | QuoteSection | QuoteSubsection,
  ) {
    const origin = evenement.target as HTMLElement;
    if (
      !editable ||
      formOpen ||
      headingEditor ||
      deletingItemId ||
      reorderingItemId ||
      origin.closest("button, input, textarea, select")
    ) {
      evenement.preventDefault();
      return;
    }
    setDraggingItemId(element.id);
    setDropTarget(null);
    evenement.dataTransfer.effectAllowed = "move";
    evenement.dataTransfer.setData("text/plain", element.id);
  }

  function dragItemOver(evenement: DragEvent<HTMLElement>, cible: QuoteItem) {
    const placement = resolveDropPlacement(evenement, cible);
    if (!placement) return;
    evenement.preventDefault();
    evenement.dataTransfer.dropEffect = "move";
    setDropTarget((courant) =>
      courant?.itemId === cible.id && courant.placement === placement
        ? courant
        : { itemId: cible.id, placement },
    );
  }

  function finishItemDrag() {
    setDraggingItemId(null);
    setDropTarget(null);
  }

  async function reorderItem(idElement: string, cible: QuoteItem, placement: QuoteItemPlacement) {
    if (!quote || !editable || reorderingItemId || idElement === cible.id) return;
    const source = elements.find((element) => element.id === idElement);
    if (!source || source.kind === "COMMENT") return;

    setReorderingItemId(idElement);
    setError("");
    setNotice("");
    try {
      const reponse = await fetch("/api/desktop/quotes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...quoteRevisionHeaders(quote.updatedAt),
        },
        body: JSON.stringify({
          action: "reorderItem",
          quoteId: quote.id,
          itemId: idElement,
          targetId: cible.id,
          placement,
        }),
      });
      const donnees = (await reponse.json()) as QuotesApiResponse;
      if (!reponse.ok || !donnees.payload) {
        setError(lineErrorLabel(donnees.error ?? "QUOTES_MUTATION_FAILED"));
        return;
      }
      onSaved(donnees.payload);
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

  function dropItem(evenement: DragEvent<HTMLElement>, cible: QuoteItem) {
    const idElement = draggingItemId;
    const placement = resolveDropPlacement(evenement, cible);
    if (!idElement || !placement) return;
    evenement.preventDefault();
    void reorderItem(idElement, cible, placement);
  }

  function dropClass(idElement: string): string {
    const classes: string[] = [];
    if (draggingItemId === idElement) classes.push("isDragging");
    if (dropTarget?.itemId === idElement) {
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

  function directOptionForItem(idElement: string) {
    return quote?.pricingConfig.options.find((option) => option.targetItemId === idElement) ?? null;
  }

  async function toggleItemOption(element: QuoteLine | QuoteSection | QuoteSubsection) {
    if (!quote || !editable || togglingOptionItemId) return;
    const existing = directOptionForItem(element.id);
    const libelle = element.kind === "LINE" ? element.description : element.title;
    setTogglingOptionItemId(element.id);
    setError("");
    setNotice("");

    try {
      const contenu = existing
        ? await postQuotePricingForQuote({
            action: "removeOption",
            quoteId: quote.id,
            optionId: existing.id,
          })
        : await postQuotePricingForQuote({
            action: "upsertOption",
            quoteId: quote.id,
            option: {
              id: globalThis.crypto.randomUUID(),
              targetItemId: element.id,
              targetKind: element.kind,
              label: libelle,
              status: "PENDING",
            },
          });
      onSaved(contenu);
      setNotice(existing ? "Option retirée du devis." : "Élément placé en option hors total.");
    } catch {
      setError("L’option n’a pas pu être modifiée.");
    } finally {
      setTogglingOptionItemId(null);
    }
  }

  async function duplicateHeading(element: QuoteSection | QuoteSubsection) {
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

    setDuplicatingHeadingId(element.id);
    setError("");
    setNotice("");
    try {
      const reponse = await fetch("/api/desktop/quotes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...quoteRevisionHeaders(quote.updatedAt),
        },
        body: JSON.stringify({
          action: "duplicateHeading",
          quoteId: quote.id,
          itemId: element.id,
        }),
      });
      const donnees = (await reponse.json()) as QuotesApiResponse;
      if (!reponse.ok || !donnees.payload) {
        setError(lineErrorLabel(donnees.error ?? "QUOTES_MUTATION_FAILED"));
        return;
      }
      onSaved(donnees.payload);
      setNotice(
        element.kind === "SECTION"
          ? "Titre dupliqué avec son contenu."
          : "Sous-titre dupliqué avec son contenu.",
      );
    } catch {
      setError("Le titre n’a pas pu être dupliqué.");
    } finally {
      setDuplicatingHeadingId(null);
    }
  }

  async function saveHeading(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (!quote || !headingEditor) return;
    setSaving(true);
    setError("");
    try {
      const corps =
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
      const reponse = await fetch("/api/desktop/quotes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...quoteRevisionHeaders(quote.updatedAt),
        },
        body: JSON.stringify(corps),
      });
      const donnees = (await reponse.json()) as QuotesApiResponse;
      if (!reponse.ok || !donnees.payload) {
        setError(lineErrorLabel(donnees.error ?? "QUOTES_MUTATION_FAILED"));
        return;
      }
      onSaved(donnees.payload);
      setNotice(headingEditor.kind === "SECTION" ? "Titre enregistré." : "Sous-titre enregistré.");
      setHeadingEditor(null);
    } catch {
      setError("Le titre n’a pas pu être enregistré.");
    } finally {
      setSaving(false);
    }
  }

  function updateComponent(indice: number, patch: Partial<OuvrageComponentForm>) {
    setComponents((courant) =>
      courant.map((component, componentIndex) =>
        componentIndex === indice ? { ...component, ...patch } : component,
      ),
    );
  }

  function updateComponentCost(indice: number, valeur: string) {
    setComponents((courant) =>
      courant.map((component, componentIndex) => {
        if (componentIndex !== indice) return component;
        const suivant = { ...component, costPriceEuros: valeur };
        try {
          const costPriceCents = optionalEurosToCents(valeur);
          if (costPriceCents === undefined) return { ...suivant, marginPercentInput: "" };
          if (component.pricingDriver === "MARGIN") {
            return {
              ...suivant,
              unitPriceEuros: centsToInput(
                calculateQuoteSalePriceFromMarginCents(
                  costPriceCents,
                  parseQuoteMarginInput(component.marginPercentInput),
                ),
              ),
            };
          }
          return {
            ...suivant,
            marginPercentInput: quoteMarginToInput(
              calculateQuoteMarginFromSalePrice(
                costPriceCents,
                eurosToCents(component.unitPriceEuros),
              ),
            ),
          };
        } catch {
          return suivant;
        }
      }),
    );
  }

  function updateComponentMargin(indice: number, valeur: string) {
    setComponents((courant) =>
      courant.map((component, componentIndex) => {
        if (componentIndex !== indice) return component;
        const suivant = {
          ...component,
          marginPercentInput: valeur,
          pricingDriver: "MARGIN" as const,
        };
        try {
          const costPriceCents = optionalEurosToCents(component.costPriceEuros);
          if (costPriceCents === undefined) return suivant;
          return {
            ...suivant,
            unitPriceEuros: centsToInput(
              calculateQuoteSalePriceFromMarginCents(costPriceCents, parseQuoteMarginInput(valeur)),
            ),
          };
        } catch {
          return suivant;
        }
      }),
    );
  }

  function updateComponentSalePrice(indice: number, valeur: string) {
    setComponents((courant) =>
      courant.map((component, componentIndex) => {
        if (componentIndex !== indice) return component;
        const suivant = {
          ...component,
          unitPriceEuros: valeur,
          pricingDriver: "SALE_PRICE" as const,
        };
        try {
          const costPriceCents = optionalEurosToCents(component.costPriceEuros);
          if (costPriceCents === undefined) return { ...suivant, marginPercentInput: "" };
          return {
            ...suivant,
            marginPercentInput: quoteMarginToInput(
              calculateQuoteMarginFromSalePrice(costPriceCents, eurosToCents(valeur)),
            ),
          };
        } catch {
          return suivant;
        }
      }),
    );
  }

  function updateOuvrageSalePrice(valeur: string) {
    setPriceForced(true);
    setOuvragePricingDriver("SALE_PRICE");
    setForcedUnitPriceEuros(valeur);
    try {
      if (calculatedUnitCost === null) {
        setForcedMarginPercentInput("");
        return;
      }
      setForcedMarginPercentInput(
        quoteMarginToInput(
          calculateQuoteMarginFromSalePrice(calculatedUnitCost, eurosToCents(valeur)),
        ),
      );
    } catch {
      setForcedMarginPercentInput("");
    }
  }

  function updateOuvrageMargin(valeur: string) {
    setPriceForced(true);
    setOuvragePricingDriver("MARGIN");
    setForcedMarginPercentInput(valeur);
    try {
      if (calculatedUnitCost === null) return;
      setForcedUnitPriceEuros(
        centsToInput(
          calculateQuoteSalePriceFromMarginCents(calculatedUnitCost, parseQuoteMarginInput(valeur)),
        ),
      );
    } catch {
      // Keep the partial input while the user is typing.
    }
  }

  function addComponent() {
    setComponents((courant) => [...courant, newComponentForm()]);
    setLibraryPickerOpen(false);
  }

  function startComponentDrag(evenement: DragEvent<HTMLDivElement>, cle: string) {
    const origin = evenement.target as HTMLElement;
    if (sauvegardeEnCours || origin.closest("button, input, textarea, select")) {
      evenement.preventDefault();
      return;
    }
    setDraggingComponentKey(cle);
    setComponentDropTarget(null);
    evenement.dataTransfer.effectAllowed = "move";
    evenement.dataTransfer.setData("text/plain", cle);
  }

  function dragComponentOver(evenement: DragEvent<HTMLDivElement>, cle: string) {
    if (!draggingComponentKey || draggingComponentKey === cle) return;
    evenement.preventDefault();
    const bounds = evenement.currentTarget.getBoundingClientRect();
    const placement = evenement.clientY < bounds.top + bounds.height / 2 ? "BEFORE" : "AFTER";
    evenement.dataTransfer.dropEffect = "move";
    setComponentDropTarget((courant) =>
      courant?.key === cle && courant.placement === placement ? courant : { key: cle, placement },
    );
  }

  function finishComponentDrag() {
    setDraggingComponentKey(null);
    setComponentDropTarget(null);
  }

  function dropComponent(evenement: DragEvent<HTMLDivElement>, targetKey: string) {
    if (!draggingComponentKey || draggingComponentKey === targetKey) return;
    evenement.preventDefault();
    const placement =
      componentDropTarget?.key === targetKey ? componentDropTarget.placement : "BEFORE";
    setComponents((courant) => {
      const sourceIndex = courant.findIndex((component) => component.key === draggingComponentKey);
      if (sourceIndex < 0) return courant;
      const sourceComponent = courant[sourceIndex];
      const remaining = courant.filter((_, indice) => indice !== sourceIndex);
      const targetIndex = remaining.findIndex((component) => component.key === targetKey);
      if (targetIndex < 0) return courant;
      const insertionIndex = placement === "AFTER" ? targetIndex + 1 : targetIndex;
      return [
        ...remaining.slice(0, insertionIndex),
        sourceComponent,
        ...remaining.slice(insertionIndex),
      ];
    });
    finishComponentDrag();
  }

  function componentDropClass(cle: string): string {
    const classes: string[] = [];
    if (draggingComponentKey === cle) classes.push("isDragging");
    if (componentDropTarget?.key === cle) {
      classes.push(
        componentDropTarget.placement === "BEFORE"
          ? "quoteComponentDropBefore"
          : "quoteComponentDropAfter",
      );
    }
    return classes.length > 0 ? ` ${classes.join(" ")}` : "";
  }

  function duplicateComponent(indice: number) {
    setComponents((courant) =>
      duplicateQuoteComponent(courant, indice, () => globalThis.crypto.randomUUID()),
    );
  }

  function removeComponent(indice: number) {
    setComponents((courant) => {
      if (courant.length <= 1) return courant;
      return courant.filter((_, componentIndex) => componentIndex !== indice);
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
      const reponse = await fetch("/api/desktop/library", { cache: "no-store" });
      const donnees = (await reponse.json()) as LibraryGetResponse;
      if (!reponse.ok || !donnees.payload)
        throw new Error(donnees.error ?? "LIBRARY_REQUEST_FAILED");
      setLibraryPayload(ensureRequiredLaborComponents(donnees.payload));
    } catch {
      setError("Impossible de charger les composants de la Bibliothèque.");
      setLibraryPickerOpen(false);
    } finally {
      setLibraryLoading(false);
    }
  }

  function chooseLibraryComponent(component: LibraryComponent) {
    const selectionne = formFromLibraryComponent(component);
    setComponents((courant) => {
      if (
        courant.length === 1 &&
        !courant[0].description.trim() &&
        !courant[0].costPriceEuros.trim()
      ) {
        return [selectionne];
      }
      return [...courant, selectionne];
    });
    setLibraryPickerOpen(false);
    setLibraryQuery("");
  }

  async function saveOuvrage(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (!quote) return;
    setSaving(true);
    setError("");
    try {
      const reponse = await fetch("/api/desktop/quotes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...quoteRevisionHeaders(quote.updatedAt),
        },
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
      const donnees = (await reponse.json()) as QuotesApiResponse;
      if (!reponse.ok || !donnees.payload) {
        setError(lineErrorLabel(donnees.error ?? "QUOTES_MUTATION_FAILED"));
        return;
      }
      onSaved(donnees.payload);
      setNotice(editingLineId ? "Ouvrage modifié." : "Ouvrage ajouté au devis.");
      closeForm();
    } catch {
      setError("Vérifie les quantités, les coûts et les prix des composants.");
    } finally {
      setSaving(false);
    }
  }

  async function duplicateOuvrage(ligne: QuoteLine) {
    if (!quote || !editable || duplicatingLineId || formOpen || headingEditor) return;
    setDuplicatingLineId(ligne.id);
    setError("");
    setNotice("");

    try {
      const reponse = await fetch("/api/desktop/quotes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...quoteRevisionHeaders(quote.updatedAt),
        },
        body: JSON.stringify({
          action: "duplicateLine",
          quoteId: quote.id,
          lineId: ligne.id,
        }),
      });
      const donnees = (await reponse.json()) as QuotesApiResponse;
      if (!reponse.ok || !donnees.payload) {
        setError(lineErrorLabel(donnees.error ?? "QUOTES_MUTATION_FAILED"));
        return;
      }
      onSaved(donnees.payload);
      setNotice("Ouvrage dupliqué.");
    } catch {
      setError("L’ouvrage n’a pas pu être dupliqué.");
    } finally {
      setDuplicatingLineId(null);
    }
  }

  async function addOuvrageToLibrary(ligne: QuoteLine) {
    if (!editable || librarySavingLineId) return;
    setLibrarySavingLineId(ligne.id);
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
      const published = publishQuoteOuvrageToLibrary(basePayload, ligne);
      const saved = (await postLibrary({
        action: "save",
        leaseId,
        expectedVersion: opened.baseVersion,
        payload: published.payload,
      })) as LibrarySaveResponse;

      if (saved.status === "error") throw new Error(saved.error);
      if (saved.status === "conflict") throw new Error("LIBRARY_VERSION_CONFLICT");

      setLibraryPayload(parseLibraryPayload(saved.resource.payload));
      setPublishedLineIds((courant) => new Set(courant).add(ligne.id));
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
        basePayload.components.some((element) => element.id === linkedComponentId);

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

  function renderReadOuvrage(ligne: QuoteLine) {
    const lineComponents = ligne.components ?? [];
    const salePriceCents = ligne.unitPriceCents ?? 0;
    const costPriceCents = calculateQuoteOuvrageUnitCostCents(lineComponents);
    const marginAmountCents = costPriceCents === null ? null : salePriceCents - costPriceCents;
    const marginPercent = calculateQuoteOuvrageMarginPercent(salePriceCents, costPriceCents);
    const libraryAlreadyLinked = ligne.librarySource?.kind === "OUVRAGE";
    const publishedNow = publishedLineIds.has(ligne.id);
    const baseLineTotalCents = Math.round(ligne.quantity * salePriceCents);
    const adjustedLine = adjustedLinesById.get(ligne.id);
    const lineTotalCents = adjustedLine?.saleCents ?? baseLineTotalCents;
    const adjustmentDeltaCents = lineTotalCents - baseLineTotalCents;
    const directOption = directOptionForItem(ligne.id);

    return (
      <div
        className={`quoteOuvrageGroup quoteDraggableItem${dropClass(ligne.id)}`}
        key={ligne.id}
        draggable={editable && !formOpen && headingEditor === null && reorderingItemId === null}
        onDragStart={(evenement) => startItemDrag(evenement, ligne)}
        onDragOver={(evenement) => dragItemOver(evenement, ligne)}
        onDrop={(evenement) => dropItem(evenement, ligne)}
        onDragEnd={finishItemDrag}
        title={editable ? "Glisser-déposer pour déplacer l’ouvrage" : undefined}
      >
        <div className="quoteMainRow quoteLineRow">
          <span className="quoteNumber">{numbers.get(ligne.id) ?? "—"}</span>
          <div className="quoteLineDescription">
            <strong style={quoteItemTextStyleToCss(ligne.presentation?.textStyle)}>
              {ligne.description}
            </strong>
            <small>
              {lineComponents.length} composant{lineComponents.length === 1 ? "" : "s"}
            </small>
          </div>
          <span>{ligne.quantityFormula ?? ligne.quantity}</span>
          <span>{ligne.unit || "—"}</span>
          <div className="quotePriceCell">
            <strong>{formatMoney(salePriceCents)}</strong>
            {ligne.forcedUnitPriceCents !== undefined ? (
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
              <small>
                <span>incl. {formatMoney(adjustmentDeltaCents)}</span>
                <span>d’ajustements</span>
              </small>
            ) : null}
          </div>
          <div className="quoteRowActions">
            {editable ? (
              <>
                <button
                  type="button"
                  className="miniLibraryButton"
                  onClick={() => void addOuvrageToLibrary(ligne)}
                  disabled={librarySavingLineId !== null || libraryAlreadyLinked || publishedNow}
                  aria-label={`Ajouter ${ligne.description} à la Bibliothèque`}
                  title={
                    libraryAlreadyLinked || publishedNow
                      ? "Ouvrage déjà dans la Bibliothèque"
                      : "Ajouter l’ouvrage à la Bibliothèque"
                  }
                >
                  {librarySavingLineId === ligne.id ? "…" : "+B"}
                </button>
                <button
                  type="button"
                  className={`miniOptionButton${directOption ? " isActive" : ""}`}
                  onClick={() => void toggleItemOption(ligne)}
                  disabled={togglingOptionItemId !== null}
                  aria-label={
                    directOption
                      ? `Retirer ${ligne.description} des options`
                      : `Mettre ${ligne.description} en option`
                  }
                  title={directOption ? "Retirer l’option" : "Mettre en option hors total"}
                >
                  O
                </button>
                <button
                  type="button"
                  className={`iconButton${presentationItemId === ligne.id ? " isActive" : ""}`}
                  onClick={() =>
                    setPresentationItemId((courant) => (courant === ligne.id ? null : ligne.id))
                  }
                  aria-label={`Mise en forme de ${ligne.description}`}
                  title="Mise en forme client"
                >
                  <Palette size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`iconButton quotePhotoButton${presentationItemId === ligne.id ? " isActive" : ""}`}
                  onClick={() =>
                    setPresentationItemId((courant) => (courant === ligne.id ? null : ligne.id))
                  }
                  aria-label={`Photos de ${ligne.description}`}
                  title="Photos de la ligne"
                >
                  <ImagePlus size={14} aria-hidden="true" />
                  {(ligne.presentation?.photos.length ?? 0) > 0 ? (
                    <span>{ligne.presentation?.photos.length}</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="iconButton"
                  onClick={() => void duplicateOuvrage(ligne)}
                  disabled={formOpen || headingEditor !== null || duplicatingLineId !== null}
                  aria-label={`Dupliquer ${ligne.description}`}
                  title="Dupliquer l’ouvrage"
                >
                  <Copy size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="iconButton"
                  onClick={() => openEditOuvrage(ligne)}
                  disabled={
                    formOpen ||
                    headingEditor !== null ||
                    duplicatingLineId !== null ||
                    deletingItemId !== null
                  }
                  aria-label={`Modifier ${ligne.description}`}
                  title="Modifier l’ouvrage"
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="iconButton quoteDeleteItemButton"
                  onClick={() => void deleteItem(ligne)}
                  disabled={
                    formOpen ||
                    headingEditor !== null ||
                    duplicatingLineId !== null ||
                    deletingItemId !== null
                  }
                  aria-label={`Supprimer ${ligne.description}`}
                  title="Supprimer l’ouvrage"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </>
            ) : null}
          </div>
        </div>
        {presentationItemId === ligne.id ? (
          <QuoteItemPresentationPanel
            quoteId={quote!.id}
            quoteUpdatedAt={quote!.updatedAt}
            item={ligne}
            editable={editable}
            onSaved={onSaved}
            onClose={() => setPresentationItemId(null)}
          />
        ) : null}
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

  function renderEditingOuvrage(cle: string) {
    const retainedPriceInput = priceForced
      ? forcedUnitPriceEuros
      : calculatedUnitPrice === null
        ? "0,00"
        : centsToInput(calculatedUnitPrice);
    const number = editingLineId ? (numbers.get(editingLineId) ?? "—") : "+";
    const currentLineTotal = ouvrageTotalCents(quantityInput, effectiveUnitPrice);

    return (
      <form className="quoteOuvrageGroup quoteOuvrageEditing" key={cle} onSubmit={saveOuvrage}>
        <div className="quoteMainRow quoteLineRow">
          <span className="quoteNumber">{number}</span>
          <input
            className="quoteInlineInput quoteDescriptionInput"
            value={description}
            onChange={(evenement) => setDescription(evenement.target.value)}
            placeholder="Désignation de l’ouvrage"
            required
          />
          <input
            className="quoteInlineInput"
            value={quantityInput}
            onChange={(evenement) => setQuantityInput(evenement.target.value)}
            required
            aria-label="Quantité ouvrage"
          />
          <input
            className="quoteInlineInput"
            value={unit}
            onChange={(evenement) => setUnit(evenement.target.value)}
            aria-label="Unité ouvrage"
          />
          <div className="quoteInlinePrice">
            <input
              className="quoteInlineInput"
              inputMode="decimal"
              value={retainedPriceInput}
              onChange={(evenement) => updateOuvrageSalePrice(evenement.target.value)}
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
              onChange={(evenement) => updateOuvrageMargin(evenement.target.value)}
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
              disabled={sauvegardeEnCours}
              title="Enregistrer"
              aria-label="Enregistrer"
            >
              <Check size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="miniActionButton"
              onClick={closeForm}
              disabled={sauvegardeEnCours}
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
          {components.map((component, indice) => {
            const total = componentTotalCents(component);
            const marginPercent = componentMarginPercent(component);
            return (
              <div
                className={`quoteComponentRow quoteComponentRowEditing quoteComponentDraggable${componentDropClass(component.key)}`}
                key={component.key}
                draggable={!sauvegardeEnCours}
                onDragStart={(evenement) => startComponentDrag(evenement, component.key)}
                onDragOver={(evenement) => dragComponentOver(evenement, component.key)}
                onDrop={(evenement) => dropComponent(evenement, component.key)}
                onDragEnd={finishComponentDrag}
                title="Glisser-déposer pour déplacer le composant"
              >
                <div className="quoteComponentNameEdit">
                  <input
                    className="quoteInlineInput"
                    value={component.description}
                    onChange={(evenement) =>
                      updateComponent(indice, { description: evenement.target.value })
                    }
                    required
                    aria-label={`Désignation composant ${indice + 1}`}
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
                  onChange={(evenement) =>
                    updateComponent(indice, { quantityInput: evenement.target.value })
                  }
                  required
                  aria-label={`Quantité composant ${indice + 1}`}
                />
                <input
                  className="quoteInlineInput"
                  value={component.unit}
                  onChange={(evenement) =>
                    updateComponent(indice, { unit: evenement.target.value })
                  }
                  aria-label={`Unité composant ${indice + 1}`}
                />
                <input
                  className="quoteInlineInput"
                  inputMode="decimal"
                  value={component.costPriceEuros}
                  onChange={(evenement) => updateComponentCost(indice, evenement.target.value)}
                  placeholder="—"
                  aria-label={`Coût composant ${indice + 1}`}
                />
                <input
                  className={`quoteInlineInput${
                    marginPercent !== null && marginPercent < 0 ? " quoteNegative" : ""
                  }`}
                  inputMode="decimal"
                  value={component.marginPercentInput}
                  onChange={(evenement) => updateComponentMargin(indice, evenement.target.value)}
                  placeholder="n/c"
                  aria-label={`Marge composant ${indice + 1}`}
                  title="Saisir la marge pour calculer le prix de vente"
                />
                <input
                  className="quoteInlineInput"
                  inputMode="decimal"
                  value={component.unitPriceEuros}
                  onChange={(evenement) => updateComponentSalePrice(indice, evenement.target.value)}
                  required
                  aria-label={`Prix vente composant ${indice + 1}`}
                />
                <strong>{total === null ? "—" : formatMoney(total)}</strong>
                <div className="quoteComponentActions">
                  <button
                    type="button"
                    className="miniActionButton"
                    onClick={() => duplicateComponent(indice)}
                    aria-label={`Dupliquer le composant ${indice + 1}`}
                    title="Dupliquer le composant"
                  >
                    <Copy size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="quoteDeleteComponent"
                    onClick={() => removeComponent(indice)}
                    disabled={components.length === 1}
                    aria-label={`Supprimer le composant ${indice + 1}`}
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
                    onChange={(evenement) => setLibraryQuery(evenement.target.value)}
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

  function renderHeading(element: QuoteSection | QuoteSubsection) {
    const editing = headingEditor?.itemId === element.id;
    if (editing && headingEditor)
      return renderHeadingEditor(headingEditor, numbers.get(element.id) ?? "—");
    const directOption = directOptionForItem(element.id);
    const headingTotalCents = headingTotalsById.get(element.id) ?? 0;

    return (
      <div className="quoteHeadingBlock" key={element.id}>
        <div
          className={`quoteMainRow quoteHeadingRow quoteDraggableItem ${element.kind === "SECTION" ? "isSection" : "isSubsection"}${dropClass(element.id)}`}
          draggable={editable && !formOpen && headingEditor === null && reorderingItemId === null}
          onDragStart={(evenement) => startItemDrag(evenement, element)}
          onDragOver={(evenement) => dragItemOver(evenement, element)}
          onDrop={(evenement) => dropItem(evenement, element)}
          onDragEnd={finishItemDrag}
          title={editable ? "Glisser-déposer pour déplacer ce bloc" : undefined}
        >
          <span className="quoteNumber">{numbers.get(element.id) ?? "—"}</span>
          <strong
            className="quoteHeadingTitle"
            style={quoteItemTextStyleToCss(element.presentation?.textStyle)}
          >
            {element.title}
          </strong>
          <span />
          <span />
          <span />
          <span />
          <strong className="quoteHeadingTotal">{formatMoney(headingTotalCents)}</strong>
          <div className="quoteRowActions">
            {editable ? (
              <>
                <button
                  type="button"
                  className={`miniOptionButton${directOption ? " isActive" : ""}`}
                  onClick={() => void toggleItemOption(element)}
                  disabled={togglingOptionItemId !== null}
                  aria-label={
                    directOption
                      ? `Retirer ${element.title} des options`
                      : `Mettre ${element.title} en option`
                  }
                  title={directOption ? "Retirer l’option" : "Mettre en option hors total"}
                >
                  O
                </button>
                <button
                  type="button"
                  className={`iconButton${presentationItemId === element.id ? " isActive" : ""}`}
                  onClick={() =>
                    setPresentationItemId((courant) => (courant === element.id ? null : element.id))
                  }
                  aria-label={`Mise en forme de ${element.title}`}
                  title="Mise en forme client"
                >
                  <Palette size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`iconButton quotePhotoButton${presentationItemId === element.id ? " isActive" : ""}`}
                  onClick={() =>
                    setPresentationItemId((courant) => (courant === element.id ? null : element.id))
                  }
                  aria-label={`Photos de ${element.title}`}
                  title="Photos de la ligne"
                >
                  <ImagePlus size={14} aria-hidden="true" />
                  {(element.presentation?.photos.length ?? 0) > 0 ? (
                    <span>{element.presentation?.photos.length}</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="iconButton"
                  onClick={() => void duplicateHeading(element)}
                  disabled={
                    formOpen ||
                    headingEditor !== null ||
                    duplicatingHeadingId !== null ||
                    duplicatingLineId !== null
                  }
                  aria-label={`Dupliquer ${element.title}`}
                  title={
                    element.kind === "SECTION" ? "Dupliquer le titre" : "Dupliquer le sous-titre"
                  }
                >
                  <Copy size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="iconButton"
                  onClick={() => openEditHeading(element)}
                  disabled={formOpen || headingEditor !== null || deletingItemId !== null}
                  aria-label={`Modifier ${element.title}`}
                  title="Modifier le titre"
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="iconButton quoteDeleteItemButton"
                  onClick={() => void deleteItem(element)}
                  disabled={
                    formOpen ||
                    headingEditor !== null ||
                    duplicatingHeadingId !== null ||
                    duplicatingLineId !== null ||
                    deletingItemId !== null
                  }
                  aria-label={`Supprimer ${element.title}`}
                  title={
                    element.kind === "SECTION"
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
        {presentationItemId === element.id ? (
          <QuoteItemPresentationPanel
            quoteId={quote!.id}
            quoteUpdatedAt={quote!.updatedAt}
            item={element}
            editable={editable}
            onSaved={onSaved}
            onClose={() => setPresentationItemId(null)}
          />
        ) : null}
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
          onChange={(evenement) => setHeadingEditor({ ...editor, title: evenement.target.value })}
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
            disabled={sauvegardeEnCours}
            title="Enregistrer"
            aria-label="Enregistrer"
          >
            <Check size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="miniActionButton"
            onClick={() => setHeadingEditor(null)}
            disabled={sauvegardeEnCours}
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
            {quote.variantName} · V{quote.version} · {lignes.length} ouvrage
            {lignes.length === 1 ? "" : "s"}
          </p>
          {editable ? (
            <p className="quoteDragHint">
              Glisse titres, sous-titres, ouvrages et composants pour les réorganiser.
            </p>
          ) : null}
        </div>
        <div className="quoteLinesHeaderActions">{headerActions}</div>
      </div>

      {erreur ? <div className="quoteLineMessage quoteLineError">{erreur}</div> : null}
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
        {elements.map((element) => {
          if (element.kind === "SECTION" || element.kind === "SUBSECTION")
            return renderHeading(element);
          if (element.kind === "LINE")
            return formOpen && editingLineId === element.id
              ? renderEditingOuvrage(element.id)
              : renderReadOuvrage(element);
          return (
            <div className="quoteMainRow quoteCommentRow" key={element.id}>
              <span className="quoteNumber">{numbers.get(element.id) ?? "—"}</span>
              <span>{element.text}</span>
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
          grid-template-columns: 44px minmax(250px, 1fr) 64px 56px 104px 100px 126px 220px;
          gap: 8px;
          align-items: center;
          padding: 9px 14px;
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
          min-width: 0;
          justify-content: flex-end;
          gap: 4px;
          flex-wrap: nowrap;
        }
        .iconButton.isActive {
          border-color: #8c78c7;
          background: #e9e2fb;
          color: #4f3c93;
        }
        .quotePhotoButton {
          position: relative;
        }
        .quotePhotoButton span {
          position: absolute;
          right: -4px;
          top: -5px;
          min-width: 14px;
          height: 14px;
          padding: 0 3px;
          border-radius: 999px;
          background: #6554b5;
          color: #fff;
          font-size: 8px;
          line-height: 14px;
          text-align: center;
        }
        .quoteLineTotalCell {
          min-width: 0;
          display: grid;
          gap: 2px;
          justify-items: start;
        }
        .quoteLineTotalCell small {
          display: grid;
          gap: 0;
          max-width: 100%;
          color: #7867bb;
          font-size: 9px;
          font-weight: 800;
          line-height: 1.15;
        }
        .quoteLineTotalCell small span {
          white-space: nowrap;
        }
        .quoteLineTotal {
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        .quoteHeadingTitle {
          grid-column: 2;
          min-width: 0;
        }
        .quoteHeadingTotal {
          grid-column: 7;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
          color: #4f3c93;
          justify-self: start;
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
        .quoteHeadingRow.isSection > .quoteHeadingTitle {
          font-size: 18px;
        }
        .quoteHeadingRow.isSubsection {
          min-height: 48px;
          background: #faf8ff;
        }
        .quoteHeadingRow.isSubsection > .quoteHeadingTitle {
          padding-left: 14px;
          font-size: 15px;
        }
        .quoteHeadingEditing {
          background: #fff;
        }
        .quotePresentationPanel {
          margin: 0 18px 12px 70px;
          padding: 12px;
          border: 1px solid #d7cfed;
          border-radius: 9px;
          background: #fbfaff;
        }
        .quotePresentationHeader,
        .quotePhotosTop,
        .quoteStyleActions,
        .quoteStyleToggles,
        .quoteHighlightControl,
        .quotePhotoMeta label {
          display: flex;
          align-items: center;
        }
        .quotePresentationHeader,
        .quotePhotosTop {
          justify-content: space-between;
          gap: 12px;
        }
        .quotePresentationHeader > div,
        .quotePhotosTop > div {
          display: grid;
          gap: 2px;
        }
        .quotePresentationHeader small,
        .quotePhotosTop small {
          color: var(--muted);
          font-size: 9px;
        }
        .quoteStyleEditor {
          display: grid;
          grid-template-columns: minmax(130px, 1fr) 90px 90px minmax(150px, 1fr) auto minmax(
              130px,
              1fr
            );
          gap: 9px;
          align-items: end;
          margin-top: 10px;
        }
        .quoteStyleEditor > label {
          display: grid;
          gap: 4px;
          color: var(--muted);
          font-size: 9px;
          font-weight: 800;
          text-transform: uppercase;
        }
        .quoteStyleEditor select {
          height: 30px;
          border: 1px solid #d7cfed;
          border-radius: 6px;
          background: #fff;
          color: var(--text);
        }
        .quoteColorControl input[type="color"],
        .quoteHighlightControl input[type="color"] {
          width: 38px;
          height: 30px;
          padding: 2px;
          border: 1px solid #d7cfed;
          border-radius: 6px;
          background: #fff;
        }
        .quoteHighlightControl {
          gap: 6px;
          align-self: end;
          height: 30px;
        }
        .quoteStyleToggles {
          gap: 4px;
        }
        .quoteStyleToggles button {
          width: 30px;
          height: 30px;
          display: grid;
          place-items: center;
          border: 1px solid #d7cfed;
          border-radius: 6px;
          background: #fff;
          cursor: pointer;
        }
        .quoteStyleToggles button.isActive {
          border-color: #8c78c7;
          background: #e9e2fb;
          color: #4f3c93;
        }
        .quoteStylePreview {
          min-height: 30px;
          display: flex;
          align-items: center;
          width: fit-content;
        }
        .quoteStyleActions {
          grid-column: 1 / -1;
          gap: 6px;
        }
        .quoteStyleActions button,
        .quotePhotoAddButton {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-height: 30px;
          padding: 0 9px;
          border: 1px solid #d7cfed;
          border-radius: 6px;
          background: #fff;
          color: #6554b5;
          font-size: 10px;
          font-weight: 800;
          cursor: pointer;
        }
        .quotePhotosPanel {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid #e4def2;
        }
        .quotePhotoAddButton input {
          display: none;
        }
        .quotePhotosEmpty {
          margin-top: 9px;
          color: var(--muted);
          font-size: 10px;
        }
        .quotePhotoGrid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 8px;
          margin-top: 9px;
        }
        .quotePhotoCard {
          position: relative;
          display: grid;
          grid-template-columns: 78px 1fr;
          gap: 8px;
          align-items: center;
          padding: 6px;
          border: 1px solid #e4def2;
          border-radius: 7px;
          background: #fff;
        }
        .quotePhotoCard img {
          width: 78px;
          height: 58px;
          object-fit: cover;
          border-radius: 5px;
          background: #f3f1f8;
        }
        .quotePhotoMeta {
          min-width: 0;
          display: grid;
          gap: 7px;
        }
        .quotePhotoMeta strong {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 10px;
        }
        .quotePhotoMeta label {
          gap: 5px;
          font-size: 9px;
          font-weight: 700;
        }
        .quotePhotoDelete {
          position: absolute;
          right: 4px;
          top: 4px;
          width: 24px;
          height: 24px;
          display: grid;
          place-items: center;
          padding: 0;
          border: 1px solid #ead0d0;
          border-radius: 6px;
          background: #fff;
          color: #a53d3d;
          cursor: pointer;
        }
        .quotePresentationError {
          margin-top: 9px;
          color: #a53d3d;
          font-size: 10px;
          font-weight: 700;
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
