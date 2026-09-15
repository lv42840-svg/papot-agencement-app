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
  type QuoteLine,
  type QuoteOuvrageComponent,
} from "@/lib/quotes/model";
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

function lineErrorLabel(code: string): string {
  if (code === "QUOTE_NOT_FOUND") return "Ce devis n’existe plus.";
  if (code === "QUOTE_NOT_EDITABLE") return "Seul un brouillon peut être modifié.";
  if (code === "QUOTE_LINE_NOT_FOUND") return "Cet ouvrage n’existe plus.";
  if (code === "QUOTE_LIBRARY_COMPONENT_NOT_FOUND") {
    return "Ce composant n’existe plus dans la Bibliothèque. Choisis-le à nouveau.";
  }
  if (code === "QUOTES_REQUEST_INVALID") return "Vérifie l’ouvrage et ses composants.";
  return "L’ouvrage n’a pas pu être enregistré.";
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

export function QuoteLinesEditor({
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
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState("u");
  const [quantityInput, setQuantityInput] = useState("1");
  const [components, setComponents] = useState<OuvrageComponentForm[]>([newComponentForm()]);
  const [priceForced, setPriceForced] = useState(false);
  const [forcedUnitPriceEuros, setForcedUnitPriceEuros] = useState("0,00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [libraryPayload, setLibraryPayload] = useState<LibraryPayload | null>(null);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [librarySavingLineId, setLibrarySavingLineId] = useState<string | null>(null);
  const [publishedLineIds, setPublishedLineIds] = useState<Set<string>>(new Set());

  const lines = useMemo(
    () => quote?.model.items.filter((item): item is QuoteLine => item.kind === "LINE") ?? [],
    [quote],
  );
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
  const currentMarginAmount =
    effectiveUnitPrice !== null && calculatedUnitCost !== null
      ? effectiveUnitPrice - calculatedUnitCost
      : null;
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
      .sort((left, right) =>
        left.name.localeCompare(right.name, "fr-FR", { sensitivity: "base" }),
      );
  }, [libraryPayload, libraryQuery]);

  useEffect(() => {
    setFormOpen(false);
    setEditingLineId(null);
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
    resetForm();
    setFormOpen(true);
  }

  function openEditOuvrage(line: QuoteLine) {
    setEditingLineId(line.id);
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
      if (!response.ok || !data.payload) {
        throw new Error(data.error ?? "LIBRARY_REQUEST_FAILED");
      }
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
          // The lease expires automatically. Release failure must not hide the save result.
        }
      }
      setLibrarySavingLineId(null);
    }
  }

  function renderComponentReadRows(lineComponents: QuoteOuvrageComponent[]) {
    if (lineComponents.length === 0) {
      return (
        <div className="quoteComponentEmpty">
          Ancien ouvrage sans détail de composants. Clique sur le crayon pour le compléter.
        </div>
      );
    }

    return lineComponents.map((component) => {
      const componentCost = quoteOuvrageComponentCostPriceCents(component);
      const marginPercent = storedComponentMarginPercent(component);
      const marginNegative = marginPercent !== null && marginPercent < 0;
      return (
        <div className="quoteComponentRow" key={component.id}>
          <strong>{component.description}</strong>
          <span>{component.quantityFormula ?? component.quantity}</span>
          <span>{component.unit || "—"}</span>
          <span>{componentCost === null ? "—" : formatMoney(componentCost)}</span>
          <span className={marginNegative ? "quoteNegative" : "quotePositive"}>
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

    return (
      <div className="quoteOuvrageGroup" key={line.id}>
        <div className="quoteLineRow">
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
            className={`quoteMarginCell${
              marginAmountCents !== null && marginAmountCents < 0
                ? " isNegative"
                : marginAmountCents === null
                  ? " isMissing"
                  : ""
            }`}
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
          <div className="quoteRowActions">
            {editable ? (
              <>
                <button
                  type="button"
                  className="miniLibraryButton"
                  onClick={() => void addOuvrageToLibrary(line)}
                  disabled={
                    librarySavingLineId !== null || libraryAlreadyLinked || publishedNow
                  }
                  aria-label={`Ajouter ${line.description} à la Bibliothèque`}
                  title={
                    libraryAlreadyLinked || publishedNow
                      ? "Ouvrage déjà ajouté à la Bibliothèque"
                      : "Ajouter l’ouvrage à la Bibliothèque"
                  }
                >
                  {librarySavingLineId === line.id ? "…" : "+B"}
                </button>
                <button
                  type="button"
                  className="iconButton"
                  onClick={() => openEditOuvrage(line)}
                  disabled={formOpen && editingLineId !== line.id}
                  aria-label={`Modifier ${line.description}`}
                  title="Modifier l’ouvrage dans le tableau"
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

    return (
      <form className="quoteOuvrageGroup quoteOuvrageEditing" key={key} onSubmit={saveOuvrage}>
        <div className="quoteLineRow quoteLineRowEditing">
          <input
            className="quoteInlineInput quoteDescriptionInput"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={4000}
            required
            aria-label="Désignation de l’ouvrage"
          />
          <input
            className="quoteInlineInput"
            value={quantityInput}
            onChange={(event) => setQuantityInput(event.target.value)}
            required
            aria-label="Quantité de l’ouvrage"
          />
          <input
            className="quoteInlineInput"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            maxLength={40}
            aria-label="Unité de l’ouvrage"
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
              required
              aria-label="Prix unitaire HT de l’ouvrage"
              title="Modifier ce prix force le prix de l’ouvrage"
            />
            {priceForced ? (
              <button
                type="button"
                className="quoteResetPrice"
                onClick={resetForcedPrice}
                title="Revenir au prix calculé depuis les composants"
                aria-label="Revenir au prix calculé"
              >
                <RotateCcw size={12} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div
            className={`quoteMarginCell${
              currentMarginAmount !== null && currentMarginAmount < 0
                ? " isNegative"
                : currentMarginAmount === null
                  ? " isMissing"
                  : ""
            }`}
          >
            {currentMarginAmount === null ? (
              <span>À renseigner</span>
            ) : (
              <>
                <strong>{formatMoney(currentMarginAmount)}</strong>
                <small>{formatPercent(currentMarginPercent)}</small>
              </>
            )}
          </div>
          <div className="quoteRowActions">
            <button
              type="submit"
              className="iconButton quoteSaveButton"
              disabled={saving}
              aria-label="Enregistrer l’ouvrage"
              title="Enregistrer"
            >
              <Check size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="iconButton"
              onClick={closeForm}
              disabled={saving}
              aria-label="Annuler la modification"
              title="Annuler"
            >
              <X size={15} aria-hidden="true" />
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
            const marginNegative = marginPercent !== null && marginPercent < 0;
            return (
              <div className="quoteComponentRow quoteComponentRowEditing" key={component.key}>
                <div className="quoteComponentNameEdit">
                  <input
                    className="quoteInlineInput"
                    value={component.description}
                    onChange={(event) =>
                      updateComponent(index, { description: event.target.value })
                    }
                    maxLength={4000}
                    required
                    aria-label={`Désignation du composant ${index + 1}`}
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
                  aria-label={`Quantité du composant ${index + 1}`}
                />
                <input
                  className="quoteInlineInput"
                  value={component.unit}
                  onChange={(event) => updateComponent(index, { unit: event.target.value })}
                  maxLength={40}
                  aria-label={`Unité du composant ${index + 1}`}
                />
                <input
                  className="quoteInlineInput"
                  inputMode="decimal"
                  value={component.costPriceEuros}
                  onChange={(event) =>
                    updateComponent(index, { costPriceEuros: event.target.value })
                  }
                  placeholder="—"
                  aria-label={`Coût unitaire HT du composant ${index + 1}`}
                />
                <span className={marginNegative ? "quoteNegative" : "quotePositive"}>
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
                  aria-label={`Prix de vente unitaire HT du composant ${index + 1}`}
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
                <div className="quoteLibraryEmpty">Chargement de la Bibliothèque…</div>
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

  if (!quote) {
    return (
      <section className="panel quoteLinesEmpty">
        <strong>Sélectionne un devis pour ouvrir son contenu.</strong>
        <span>Les ouvrages du brouillon apparaîtront ici.</span>
        <style jsx>{`
          .quoteLinesEmpty {
            min-height: 120px;
            display: grid;
            place-items: center;
            align-content: center;
            gap: 5px;
            color: var(--muted);
            text-align: center;
          }
          .quoteLinesEmpty strong {
            color: var(--text);
          }
        `}</style>
      </section>
    );
  }

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
        <div className="quoteLinesHeaderActions">
          {headerActions}
          {editable ? (
            <button
              type="button"
              className="primaryButton"
              onClick={openNewOuvrage}
              disabled={saving || formOpen}
            >
              <Plus size={16} aria-hidden="true" />
              Ajouter un ouvrage
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="quoteLineMessage quoteLineError">{error}</div> : null}
      {notice ? <div className="quoteLineMessage quoteLineNotice">{notice}</div> : null}

      {lines.length === 0 && !formOpen ? (
        <div className="quoteLinesNoData">
          <strong>Le devis est vide.</strong>
          <span>Ajoute son premier ouvrage. Il sera ensuite modifiable directement ici.</span>
        </div>
      ) : (
        <div className="quoteLinesTable">
          <div className="quoteLinesTableHeader">
            <span>Ouvrage</span>
            <span>Qté</span>
            <span>Unité</span>
            <span>PU HT</span>
            <span>Marge</span>
            <span />
          </div>
          {lines.map((line) =>
            formOpen && editingLineId === line.id
              ? renderEditingOuvrage(line.id)
              : renderReadOuvrage(line),
          )}
          {formOpen && editingLineId === null ? renderEditingOuvrage("new-ouvrage") : null}
        </div>
      )}

      <style jsx>{`
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
        .quoteComponentNameEdit {
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
        .quoteLinesHeader :global(.primaryButton) {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
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
        .quoteLinesNoData {
          min-height: 130px;
          display: grid;
          place-items: center;
          align-content: center;
          gap: 5px;
          color: var(--muted);
          text-align: center;
        }
        .quoteLinesNoData strong {
          color: var(--text);
        }
        .quoteLinesTable {
          border-top: 1px solid var(--border);
          overflow-x: auto;
        }
        .quoteLinesTableHeader,
        .quoteLineRow {
          display: grid;
          grid-template-columns: minmax(270px, 1fr) 84px 72px 135px 140px 82px;
          gap: 10px;
          align-items: center;
          padding: 9px 18px;
        }
        .quoteLinesTableHeader {
          min-width: 850px;
          min-height: 38px;
          background: var(--surface-soft);
          color: var(--muted);
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .quoteOuvrageGroup {
          min-width: 850px;
        }
        .quoteOuvrageGroup + .quoteOuvrageGroup {
          border-top: 1px solid var(--border);
        }
        .quoteLineRow {
          min-height: 58px;
          font-size: 12px;
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
          min-width: 0;
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
        .quotePriceCell strong,
        .quoteMarginCell strong {
          white-space: nowrap;
        }
        .quoteMarginCell {
          color: #31724b;
        }
        .quoteMarginCell small {
          font-weight: 800;
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
          margin: 0 18px 12px 32px;
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
        .quoteComponentTitleActions {
          gap: 5px;
        }
        .quoteComponentTitleActions > span {
          margin-right: 2px;
        }
        .quoteComponentTitleActions .miniActionButton,
        .quoteComponentTitleActions .miniLibraryButton {
          height: 24px;
        }
        .quoteComponentTitleActions .miniActionButton {
          width: 24px;
        }
        .quoteComponentTitleActions .miniLibraryButton {
          min-width: 28px;
        }
        .quoteComponentRow {
          min-height: 39px;
          border-top: 1px solid #ebe6f4;
          font-size: 11px;
        }
        .quoteComponentRow > strong:first-child {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .quoteComponentRowEditing {
          min-height: 46px;
          background: #fff;
        }
        .quoteComponentNameEdit {
          min-width: 0;
          gap: 5px;
        }
        .quoteComponentNameEdit .quoteInlineInput {
          flex: 1 1 auto;
        }
        .quoteComponentNameEdit small {
          flex: 0 0 auto;
          display: inline-grid;
          place-items: center;
          width: 18px;
          height: 18px;
          border-radius: 5px;
          background: #ece7fa;
          color: #6554b5;
          font-size: 9px;
          font-weight: 900;
        }
        .quoteComponentRowEditing .quoteInlineInput {
          height: 30px;
          padding: 4px 6px;
          font-size: 11px;
        }
        .quoteComponentEmpty {
          padding: 12px 10px;
          border-top: 1px solid #ebe6f4;
          color: var(--muted);
          font-size: 10px;
        }
        .quoteLibraryPicker {
          padding: 10px;
          border-top: 1px solid #d7cfed;
          background: #faf8ff;
        }
        .quoteLibraryPickerTop {
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 8px;
        }
        .quoteLibrarySearch {
          flex: 1 1 auto;
          gap: 7px;
          padding: 0 8px;
          border: 1px solid #d7cfed;
          border-radius: 7px;
          background: #fff;
          color: var(--muted);
        }
        .quoteLibrarySearch input {
          width: 100%;
          height: 34px;
          border: 0;
          outline: 0;
          background: transparent;
          color: var(--text);
        }
        .quoteLibraryResults {
          max-height: 250px;
          overflow-y: auto;
          display: grid;
          gap: 4px;
        }
        .quoteLibraryResult {
          width: 100%;
          justify-content: space-between;
          gap: 16px;
          padding: 8px 10px;
          border: 1px solid transparent;
          border-radius: 7px;
          background: #fff;
          color: var(--text);
          text-align: left;
          cursor: pointer;
        }
        .quoteLibraryResult:hover {
          border-color: #d7cfed;
          background: #f6f3fc;
        }
        .quoteLibraryResult > span {
          min-width: 0;
          display: grid;
          gap: 2px;
        }
        .quoteLibraryResult small {
          color: var(--muted);
          font-size: 10px;
        }
        .quoteLibraryResult > strong {
          white-space: nowrap;
        }
        .quoteLibraryEmpty {
          padding: 12px;
          color: var(--muted);
          font-size: 11px;
          text-align: center;
        }
        @media (max-width: 1000px) {
          .quoteLinesTableHeader,
          .quoteOuvrageGroup {
            min-width: 850px;
          }
          .quoteComponentsTable {
            min-width: 790px;
          }
        }
      `}</style>
    </section>
  );
}
