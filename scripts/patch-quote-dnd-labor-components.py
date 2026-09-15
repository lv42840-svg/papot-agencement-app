from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one occurrence, got {count}: {old[:160]!r}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


def replace_count(path: Path, old: str, new: str, expected: int) -> None:
    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} occurrences, got {count}: {old[:160]!r}")
    path.write_text(source.replace(old, new), encoding="utf-8")


# Library catalog: required labor components cannot be deleted.
catalog = Path("src/lib/library/catalog-edit.ts")
replace_once(
    catalog,
    'import { parseLibraryOuvrage, type LibraryOuvrage } from "./ouvrage";\nimport { parseLibraryPayload, type LibraryPayload } from "./storage";',
    'import { parseLibraryOuvrage, type LibraryOuvrage } from "./ouvrage";\nimport { isRequiredLaborComponentId } from "./required-labor-components";\nimport { parseLibraryPayload, type LibraryPayload } from "./storage";',
)
replace_once(
    catalog,
    '  if (!component) throw new Error("LIBRARY_COMPONENT_NOT_FOUND");\n\n  const usedByOuvrage =',
    '  if (!component) throw new Error("LIBRARY_COMPONENT_NOT_FOUND");\n  if (isRequiredLaborComponentId(componentId)) throw new Error("LIBRARY_COMPONENT_REQUIRED");\n\n  const usedByOuvrage =',
)

# Quote model: persist production activity both on library snapshots and quote components.
model = Path("src/lib/quotes/model.ts")
replace_once(
    model,
    'import { z } from "zod";\nimport {',
    'import { z } from "zod";\nimport { productionActivitySchema } from "../production-activity";\nimport {',
)
replace_once(
    model,
    '    salePriceCents: quoteMoneyCentsSchema,\n  })\n  .strict();',
    '    salePriceCents: quoteMoneyCentsSchema,\n    activity: productionActivitySchema.optional(),\n  })\n  .strict();',
)
replace_once(
    model,
    '  costPriceCents: quoteMoneyCentsSchema.optional(),\n  unitPriceCents: quoteMoneyCentsSchema,\n  librarySource: quoteLibraryComponentSourceSchema.optional(),',
    '  costPriceCents: quoteMoneyCentsSchema.optional(),\n  unitPriceCents: quoteMoneyCentsSchema,\n  activity: productionActivitySchema.optional(),\n  librarySource: quoteLibraryComponentSourceSchema.optional(),',
)

# Library component snapshot creator: carry the semantic activity.
library_component = Path("src/lib/quotes/library-component.ts")
replace_once(
    library_component,
    '} from "../library/component";\nimport type { QuoteLibraryComponentSource } from "./model";',
    '} from "../library/component";\nimport type { ProductionActivity } from "../production-activity";\nimport type { QuoteLibraryComponentSource } from "./model";',
)
replace_once(
    library_component,
    '  salePriceCents: number;\n}): { component: LibraryComponent; source: QuoteLibraryComponentSource } {',
    '  salePriceCents: number;\n  activity?: ProductionActivity;\n}): { component: LibraryComponent; source: QuoteLibraryComponentSource } {',
)
replace_once(
    library_component,
    '    salePriceCents: input.salePriceCents,\n  });',
    '    salePriceCents: input.salePriceCents,\n    ...(input.activity ? { activity: input.activity } : {}),\n  });',
)
replace_once(
    library_component,
    '        salePriceCents: component.salePriceCents,\n      },',
    '        salePriceCents: component.salePriceCents,\n        ...(component.activity ? { activity: component.activity } : {}),\n      },',
)

# Publishing quote components back to Library keeps the activity identity.
library_publish = Path("src/lib/quotes/library-publish.ts")
replace_once(
    library_publish,
    '''function sameLibraryPricing(\n  component: QuoteOuvrageComponent,\n  candidate: LibraryComponent,\n  costPriceCents: number,\n): boolean {\n  const source = component.librarySource?.component;\n  if (!source || source.sourceComponentId !== candidate.id) return false;\n\n  return (\n    component.description === source.name &&\n    component.unit === source.unit &&\n    costPriceCents === source.costPriceCents &&\n    component.unitPriceCents === source.salePriceCents &&\n    candidate.name === source.name &&\n    candidate.description === source.description &&\n    candidate.unit === source.unit &&\n    candidate.costPriceCents === source.costPriceCents &&\n    candidate.marginPercent === source.marginPercent &&\n    candidate.salePriceCents === source.salePriceCents\n  );\n}''',
    '''function sameLibraryPricing(\n  component: QuoteOuvrageComponent,\n  candidate: LibraryComponent,\n  costPriceCents: number,\n): boolean {\n  const source = component.librarySource?.component;\n  if (!source || source.sourceComponentId !== candidate.id) return false;\n  const activity = component.activity ?? source.activity;\n\n  return (\n    component.description === source.name &&\n    component.unit === source.unit &&\n    costPriceCents === source.costPriceCents &&\n    component.unitPriceCents === source.salePriceCents &&\n    activity === source.activity &&\n    candidate.name === source.name &&\n    candidate.description === source.description &&\n    candidate.unit === source.unit &&\n    candidate.costPriceCents === source.costPriceCents &&\n    candidate.marginPercent === source.marginPercent &&\n    candidate.salePriceCents === source.salePriceCents &&\n    candidate.activity === source.activity\n  );\n}''',
)
replace_once(
    library_publish,
    '''  return {\n    id,\n    name,\n    description: component.librarySource?.component.description ?? component.description,\n    unit,\n    costPriceCents,\n    marginPercent,\n    salePriceCents: component.unitPriceCents,\n  };''',
    '''  const activity = component.activity ?? component.librarySource?.component.activity;\n  return {\n    id,\n    name,\n    description: component.librarySource?.component.description ?? component.description,\n    unit,\n    costPriceCents,\n    marginPercent,\n    salePriceCents: component.unitPriceCents,\n    ...(activity ? { activity } : {}),\n  };''',
)

# Quote mutations: activity propagation + arbitrary drag/drop reorder action.
mutations = Path("src/lib/quotes/mutations.ts")
replace_once(
    mutations,
    'import { z } from "zod";\nimport {',
    'import { z } from "zod";\nimport { productionActivitySchema } from "../production-activity";\nimport {',
)
replace_once(
    mutations,
    '} from "./model";\nimport {',
    '} from "./model";\nimport { reorderQuoteItems } from "./item-reorder";\nimport {',
)
replace_once(
    mutations,
    '  costPriceCents: quoteMoneyCentsSchema.optional(),\n  unitPriceCents: quoteMoneyCentsSchema,\n});',
    '  costPriceCents: quoteMoneyCentsSchema.optional(),\n  unitPriceCents: quoteMoneyCentsSchema,\n  activity: productionActivitySchema.optional(),\n});',
)
replace_once(
    mutations,
    '''const moveLineMutationSchema = z.object({\n  action: z.literal("moveLine"),\n  quoteId: z.string().uuid(),\n  lineId: z.string().uuid(),\n  direction: z.enum(["UP", "DOWN"]),\n});\n\nconst moveHeadingMutationSchema =''',
    '''const moveLineMutationSchema = z.object({\n  action: z.literal("moveLine"),\n  quoteId: z.string().uuid(),\n  lineId: z.string().uuid(),\n  direction: z.enum(["UP", "DOWN"]),\n});\n\nconst reorderItemMutationSchema = z.object({\n  action: z.literal("reorderItem"),\n  quoteId: z.string().uuid(),\n  itemId: z.string().uuid(),\n  targetId: z.string().uuid(),\n  placement: z.enum(["BEFORE", "AFTER", "INSIDE"]),\n});\n\nconst moveHeadingMutationSchema =''',
)
replace_once(
    mutations,
    '  moveLineMutationSchema,\n  moveHeadingMutationSchema,',
    '  moveLineMutationSchema,\n  reorderItemMutationSchema,\n  moveHeadingMutationSchema,',
)
replace_once(
    mutations,
    '''function headingBlockEnd(items: QuoteItem[], startIndex: number): number {''',
    '''function reorderDraftItem(\n  payload: NativeQuotesPayload,\n  input: Extract<QuotesMutation, { action: "reorderItem" }>,\n  actor: QuotesActor,\n  now: Date,\n): QuotesMutationResult {\n  const { quoteIndex, quote } = findDraftQuote(payload, input.quoteId);\n  const items = reorderQuoteItems(quote.model.items, input.itemId, input.targetId, input.placement);\n  const timestamp = now.toISOString();\n  const updated = nativeQuoteRecordSchema.parse({\n    ...quote,\n    model: parseQuoteModel({ ...quote.model, items }),\n    updatedAt: timestamp,\n    updatedByName: actor.displayName,\n  });\n  payload.quotes[quoteIndex] = updated;\n  return { payload, focusQuoteId: updated.id };\n}\n\nfunction headingBlockEnd(items: QuoteItem[], startIndex: number): number {''',
)
replace_once(
    mutations,
    '''    const librarySource = selectedLibrarySource ?? existingComponent?.librarySource;\n\n    return {''',
    '''    const librarySource = selectedLibrarySource ?? existingComponent?.librarySource;\n    const activity =\n      componentInput.activity ??\n      existingComponent?.activity ??\n      selectedLibrarySource?.component.activity ??\n      existingComponent?.librarySource?.component.activity;\n\n    return {''',
)
replace_once(
    mutations,
    '      unitPriceCents: componentInput.unitPriceCents,\n      ...(librarySource ? { librarySource } : {}),',
    '      unitPriceCents: componentInput.unitPriceCents,\n      ...(activity ? { activity } : {}),\n      ...(librarySource ? { librarySource } : {}),',
)
replace_once(
    mutations,
    '''  if (input.action === "moveLine") {\n    return moveDraftLine(payload, input, actor, now);\n  }\n  if (input.action === "moveHeading") {''',
    '''  if (input.action === "moveLine") {\n    return moveDraftLine(payload, input, actor, now);\n  }\n  if (input.action === "reorderItem") {\n    return reorderDraftItem(payload, input, actor, now);\n  }\n  if (input.action === "moveHeading") {''',
)

# Quote API: synthesize required labor components even before the Library is saved.
quote_route = Path("src/app/api/desktop/quotes/route.ts")
replace_once(
    quote_route,
    'import { createLibraryRepository } from "@/lib/library/create-repository";\nimport {',
    'import { createLibraryRepository } from "@/lib/library/create-repository";\nimport { ensureRequiredLaborComponents } from "@/lib/library/required-labor-components";\nimport {',
)
replace_once(
    quote_route,
    '''        const library = await createLibraryRepository(context).load();\n        const sources = new Map<string, QuoteLibraryComponentSource>();\n\n        for (const componentId of requestedComponentIds) {\n          const component = library.payload.components.find((item) => item.id === componentId);''',
    '''        const library = await createLibraryRepository(context).load();\n        const libraryPayload = ensureRequiredLaborComponents(library.payload);\n        const sources = new Map<string, QuoteLibraryComponentSource>();\n\n        for (const componentId of requestedComponentIds) {\n          const component = libraryPayload.components.find((item) => item.id === componentId);''',
)
replace_once(
    quote_route,
    '''              costPriceCents: component.costPriceCents,\n              salePriceCents: component.salePriceCents,\n            }).source,''',
    '''              costPriceCents: component.costPriceCents,\n              salePriceCents: component.salePriceCents,\n              activity: component.activity,\n            }).source,''',
)

# Library workspace: surface, preserve and protect the three required activity components.
library_ui = Path("src/components/library-workspace.tsx")
replace_once(
    library_ui,
    '''import {\n  calculateLibraryComponentMarginPercent,\n  calculateLibraryComponentSalePriceCents,\n  type LibraryComponent,\n} from "@/lib/library/component";''',
    '''import {\n  calculateLibraryComponentMarginPercent,\n  calculateLibraryComponentSalePriceCents,\n  type LibraryComponent,\n} from "@/lib/library/component";\nimport {\n  ensureRequiredLaborComponents,\n  isRequiredLaborComponentId,\n} from "@/lib/library/required-labor-components";\nimport { productionActivityLabel, type ProductionActivity } from "@/lib/production-activity";''',
)
replace_once(
    library_ui,
    '''  unit: string;\n  costPriceEuros: string;''',
    '''  unit: string;\n  activity?: ProductionActivity;\n  costPriceEuros: string;''',
)
replace_once(
    library_ui,
    '''    unit: component.unit,\n    costPriceEuros:''',
    '''    unit: component.unit,\n    activity: component.activity,\n    costPriceEuros:''',
)
replace_once(
    library_ui,
    '''    unit: draft.unit,\n    costPriceCents,''',
    '''    unit: draft.unit,\n    ...(draft.activity ? { activity: draft.activity } : {}),\n    costPriceCents,''',
)
replace_once(
    library_ui,
    '  LIBRARY_COMPONENT_NOT_FOUND: "Ce composant n’existe plus dans la bibliothèque.",',
    '  LIBRARY_COMPONENT_NOT_FOUND: "Ce composant n’existe plus dans la bibliothèque.",\n  LIBRARY_COMPONENT_REQUIRED: "Les composants Heure BE, Heure atelier et Heure pose sont obligatoires.",',
)
replace_once(
    library_ui,
    '''function snapshotFromEnvelope(envelope: ResourceEnvelope | null): LibrarySnapshot {\n  if (!envelope) {\n    return { version: 0, payload: createInitialLibraryPayload() };\n  }\n  return {\n    version: envelope.version,\n    payload: parseLibraryPayload(envelope.payload),\n  };\n}''',
    '''function snapshotFromEnvelope(envelope: ResourceEnvelope | null): LibrarySnapshot {\n  const payload = envelope\n    ? parseLibraryPayload(envelope.payload)\n    : createInitialLibraryPayload();\n  return {\n    version: envelope?.version ?? 0,\n    payload: ensureRequiredLaborComponents(payload),\n  };\n}''',
)
replace_once(
    library_ui,
    '  const [snapshot, setSnapshot] = useState(initialSnapshot);',
    '  const [snapshot, setSnapshot] = useState(() => ({\n    ...initialSnapshot,\n    payload: ensureRequiredLaborComponents(initialSnapshot.payload),\n  }));',
)
replace_once(
    library_ui,
    '[component.name, component.description, component.unit].join(" "),',
    '[\n              component.name,\n              component.description,\n              component.unit,\n              component.activity ? productionActivityLabel(component.activity) : "",\n            ].join(" "),',
)
replace_once(
    library_ui,
    '''                          <strong>{component.name}</strong>\n                          {component.description ? <small>{component.description}</small> : null}''',
    '''                          <strong>{component.name}</strong>\n                          {component.activity || component.description ? (\n                            <small>\n                              {component.activity\n                                ? `Activité ${productionActivityLabel(component.activity)}`\n                                : ""}\n                              {component.activity && component.description ? " · " : ""}\n                              {component.description}\n                            </small>\n                          ) : null}''',
)
replace_once(
    library_ui,
    '''                              onClick={() => void deleteComponent(component)}\n                              disabled={busy || Boolean(editor)}\n                              aria-label={`Supprimer ${component.name}`}\n                              title="Supprimer"''',
    '''                              onClick={() => void deleteComponent(component)}\n                              disabled={\n                                busy || Boolean(editor) || isRequiredLaborComponentId(component.id)\n                              }\n                              aria-label={`Supprimer ${component.name}`}\n                              title={\n                                isRequiredLaborComponentId(component.id)\n                                  ? "Composant métier obligatoire"\n                                  : "Supprimer"\n                              }''',
)
replace_once(
    library_ui,
    '''                  </label>\n\n                  <div className="libraryFormGrid">''',
    '''                  </label>\n\n                  {editor.draft.activity ? (\n                    <p className="libraryPricingHint">\n                      Activité planning fixe : {productionActivityLabel(editor.draft.activity)}.\n                    </p>\n                  ) : null}\n\n                  <div className="libraryFormGrid">''',
)

# Quote editor: production activity metadata + HTML5 drag/drop across titles.
editor = Path("src/components/quote-structured-lines-editor.tsx")
replace_once(
    editor,
    'import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";',
    'import {\n  type DragEvent,\n  type FormEvent,\n  type ReactNode,\n  useEffect,\n  useMemo,\n  useState,\n} from "react";',
)
replace_once(
    editor,
    '''import {\n  createInitialLibraryPayload,\n  parseLibraryPayload,\n  type LibraryPayload,\n} from "@/lib/library/storage";''',
    '''import {\n  createInitialLibraryPayload,\n  parseLibraryPayload,\n  type LibraryPayload,\n} from "@/lib/library/storage";\nimport { ensureRequiredLaborComponents } from "@/lib/library/required-labor-components";\nimport { productionActivityLabel, type ProductionActivity } from "@/lib/production-activity";''',
)
replace_once(
    editor,
    'import { buildQuoteItemNumbers } from "@/lib/quotes/numbering";',
    'import { buildQuoteItemNumbers } from "@/lib/quotes/numbering";\nimport type { QuoteItemPlacement } from "@/lib/quotes/item-reorder";',
)
replace_once(
    editor,
    '''  unit: string;\n  quantityInput: string;''',
    '''  unit: string;\n  activity?: ProductionActivity;\n  quantityInput: string;''',
)
replace_once(
    editor,
    '''    unit: component.unit,\n    quantityInput: "1",''',
    '''    unit: component.unit,\n    activity: component.activity,\n    quantityInput: "1",''',
)
replace_once(
    editor,
    '''        description: component.description,\n        unit: component.unit,\n        quantityInput:''',
    '''        description: component.description,\n        unit: component.unit,\n        activity: component.activity ?? component.librarySource?.component.activity,\n        quantityInput:''',
)
replace_once(
    editor,
    '  if (code === "QUOTE_ITEM_DELETE_UNSUPPORTED") return "Cet élément ne peut pas être supprimé ici.";',
    '  if (code === "QUOTE_ITEM_DELETE_UNSUPPORTED") return "Cet élément ne peut pas être supprimé ici.";\n  if (code === "QUOTE_ITEM_REORDER_BLOCKED") {\n    return "Dépose l’élément sur un emplacement compatible : titre, sous-titre ou ouvrage.";\n  }',
)
replace_once(
    editor,
    '''  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);\n  const [error, setError] = useState("");''',
    '''  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);\n  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);\n  const [reorderingItemId, setReorderingItemId] = useState<string | null>(null);\n  const [dropTarget, setDropTarget] = useState<{\n    itemId: string;\n    placement: QuoteItemPlacement;\n  } | null>(null);\n  const [error, setError] = useState("");''',
)
replace_once(
    editor,
    '''            [component.name, component.description, component.unit].join(" "),''',
    '''            [\n              component.name,\n              component.description,\n              component.unit,\n              component.activity ? productionActivityLabel(component.activity) : "",\n            ].join(" "),''',
)
replace_once(
    editor,
    '''    setDeletingItemId(null);\n    setError("");''',
    '''    setDeletingItemId(null);\n    setDraggingItemId(null);\n    setReorderingItemId(null);\n    setDropTarget(null);\n    setError("");''',
)
replace_once(
    editor,
    '''      setLibraryPayload(data.payload);''',
    '''      setLibraryPayload(ensureRequiredLaborComponents(data.payload));''',
)
replace_count(
    editor,
    '''      const basePayload = opened.resource\n        ? parseLibraryPayload(opened.resource.payload)\n        : createInitialLibraryPayload();''',
    '''      const basePayload = ensureRequiredLaborComponents(\n        opened.resource\n          ? parseLibraryPayload(opened.resource.payload)\n          : createInitialLibraryPayload(),\n      );''',
    2,
)
replace_once(
    editor,
    '''            unit: component.unit,\n            quantityInput: component.quantityInput,''',
    '''            unit: component.unit,\n            activity: component.activity,\n            quantityInput: component.quantityInput,''',
)

# Insert drag/drop controller after destructive deletion handler and before duplication.
replace_once(
    editor,
    '''  async function duplicateHeading(item: QuoteSection | QuoteSubsection) {''',
    '''  function resolveDropPlacement(\n    event: DragEvent<HTMLElement>,\n    target: QuoteItem,\n  ): QuoteItemPlacement | null {\n    if (!draggingItemId || draggingItemId === target.id) return null;\n    const source = items.find((item) => item.id === draggingItemId);\n    if (!source || source.kind === "COMMENT") return null;\n\n    if (source.kind === "SECTION") {\n      if (target.kind !== "SECTION") return null;\n      const bounds = event.currentTarget.getBoundingClientRect();\n      return event.clientY < bounds.top + bounds.height / 2 ? "BEFORE" : "AFTER";\n    }\n\n    if (source.kind === "SUBSECTION") {\n      if (target.kind === "SECTION") return "INSIDE";\n      if (target.kind !== "SUBSECTION") return null;\n      const bounds = event.currentTarget.getBoundingClientRect();\n      return event.clientY < bounds.top + bounds.height / 2 ? "BEFORE" : "AFTER";\n    }\n\n    if (target.kind === "SECTION" || target.kind === "SUBSECTION") return "INSIDE";\n    if (target.kind !== "LINE") return null;\n    const bounds = event.currentTarget.getBoundingClientRect();\n    return event.clientY < bounds.top + bounds.height / 2 ? "BEFORE" : "AFTER";\n  }\n\n  function startItemDrag(\n    event: DragEvent<HTMLElement>,\n    item: QuoteLine | QuoteSection | QuoteSubsection,\n  ) {\n    const origin = event.target as HTMLElement;\n    if (\n      !editable ||\n      formOpen ||\n      headingEditor ||\n      deletingItemId ||\n      reorderingItemId ||\n      origin.closest("button, input, textarea, select")\n    ) {\n      event.preventDefault();\n      return;\n    }\n    setDraggingItemId(item.id);\n    setDropTarget(null);\n    event.dataTransfer.effectAllowed = "move";\n    event.dataTransfer.setData("text/plain", item.id);\n  }\n\n  function dragItemOver(event: DragEvent<HTMLElement>, target: QuoteItem) {\n    const placement = resolveDropPlacement(event, target);\n    if (!placement) return;\n    event.preventDefault();\n    event.dataTransfer.dropEffect = "move";\n    setDropTarget((current) =>\n      current?.itemId === target.id && current.placement === placement\n        ? current\n        : { itemId: target.id, placement },\n    );\n  }\n\n  function finishItemDrag() {\n    setDraggingItemId(null);\n    setDropTarget(null);\n  }\n\n  async function reorderItem(\n    itemId: string,\n    target: QuoteItem,\n    placement: QuoteItemPlacement,\n  ) {\n    if (!quote || !editable || reorderingItemId || itemId === target.id) return;\n    const source = items.find((item) => item.id === itemId);\n    if (!source || source.kind === "COMMENT") return;\n\n    setReorderingItemId(itemId);\n    setError("");\n    setNotice("");\n    try {\n      const response = await fetch("/api/desktop/quotes", {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({\n          action: "reorderItem",\n          quoteId: quote.id,\n          itemId,\n          targetId: target.id,\n          placement,\n        }),\n      });\n      const data = (await response.json()) as QuotesApiResponse;\n      if (!response.ok || !data.payload) {\n        setError(lineErrorLabel(data.error ?? "QUOTES_MUTATION_FAILED"));\n        return;\n      }\n      onSaved(data.payload);\n      setNotice(\n        source.kind === "LINE"\n          ? "Ouvrage déplacé."\n          : source.kind === "SECTION"\n            ? "Titre déplacé avec son contenu."\n            : "Sous-titre déplacé avec son contenu.",\n      );\n    } catch {\n      setError("L’élément n’a pas pu être déplacé.");\n    } finally {\n      setReorderingItemId(null);\n      finishItemDrag();\n    }\n  }\n\n  function dropItem(event: DragEvent<HTMLElement>, target: QuoteItem) {\n    const itemId = draggingItemId;\n    const placement = resolveDropPlacement(event, target);\n    if (!itemId || !placement) return;\n    event.preventDefault();\n    void reorderItem(itemId, target, placement);\n  }\n\n  function dropClass(itemId: string): string {\n    const classes: string[] = [];\n    if (draggingItemId === itemId) classes.push("isDragging");\n    if (dropTarget?.itemId === itemId) {\n      classes.push(\n        dropTarget.placement === "BEFORE"\n          ? "quoteDropBefore"\n          : dropTarget.placement === "AFTER"\n            ? "quoteDropAfter"\n            : "quoteDropInside",\n      );\n    }\n    return classes.length > 0 ? ` ${classes.join(" ")}` : "";\n  }\n\n  async function duplicateHeading(item: QuoteSection | QuoteSubsection) {''',
)

# Read component rows: show activity badge.
replace_once(
    editor,
    '''        <div className="quoteComponentRow" key={component.id}>\n          <strong>{component.description}</strong>''',
    '''        <div className="quoteComponentRow" key={component.id}>\n          <div className="quoteComponentLabel">\n            <strong>{component.description}</strong>\n            {component.activity ? (\n              <small className="quoteActivityTag">{productionActivityLabel(component.activity)}</small>\n            ) : null}\n          </div>''',
)

# Make ouvrage read blocks draggable/drop targets.
replace_once(
    editor,
    '''    return (\n      <div className="quoteOuvrageGroup" key={line.id}>\n        <div className="quoteMainRow quoteLineRow">''',
    '''    return (\n      <div\n        className={`quoteOuvrageGroup quoteDraggableItem${dropClass(line.id)}`}\n        key={line.id}\n        draggable={editable && !formOpen && headingEditor === null && reorderingItemId === null}\n        onDragStart={(event) => startItemDrag(event, line)}\n        onDragOver={(event) => dragItemOver(event, line)}\n        onDrop={(event) => dropItem(event, line)}\n        onDragEnd={finishItemDrag}\n        title={editable ? "Glisser-déposer pour déplacer l’ouvrage" : undefined}\n      >\n        <div className="quoteMainRow quoteLineRow">''',
)

# Editing components: show fixed activity identity.
replace_once(
    editor,
    '''                  {component.libraryComponentId ? <small>B</small> : null}\n                </div>''',
    '''                  {component.activity ? (\n                    <small className="quoteActivityTag">\n                      {productionActivityLabel(component.activity)}\n                    </small>\n                  ) : component.libraryComponentId ? (\n                    <small>B</small>\n                  ) : null}\n                </div>''',
)

# Library picker: show activity before unit when relevant.
replace_once(
    editor,
    '''                        <small>\n                          {component.unit} · marge {formatPercent(component.marginPercent)}\n                        </small>''',
    '''                        <small>\n                          {component.activity\n                            ? `${productionActivityLabel(component.activity)} · `\n                            : ""}\n                          {component.unit} · marge {formatPercent(component.marginPercent)}\n                        </small>''',
)

# Make heading rows draggable/drop targets.
replace_once(
    editor,
    '''      <div\n        className={`quoteMainRow quoteHeadingRow ${item.kind === "SECTION" ? "isSection" : "isSubsection"}`}\n        key={item.id}\n      >''',
    '''      <div\n        className={`quoteMainRow quoteHeadingRow quoteDraggableItem ${item.kind === "SECTION" ? "isSection" : "isSubsection"}${dropClass(item.id)}`}\n        key={item.id}\n        draggable={editable && !formOpen && headingEditor === null && reorderingItemId === null}\n        onDragStart={(event) => startItemDrag(event, item)}\n        onDragOver={(event) => dragItemOver(event, item)}\n        onDrop={(event) => dropItem(event, item)}\n        onDragEnd={finishItemDrag}\n        title={editable ? "Glisser-déposer pour déplacer ce bloc" : undefined}\n      >''',
)

# Add a discoverability hint in the quote header.
replace_once(
    editor,
    '''          <p className="muted">\n            {quote.variantName} · V{quote.version} · {lines.length} ouvrage\n            {lines.length === 1 ? "" : "s"}\n          </p>''',
    '''          <p className="muted">\n            {quote.variantName} · V{quote.version} · {lines.length} ouvrage\n            {lines.length === 1 ? "" : "s"}\n          </p>\n          {editable ? (\n            <p className="quoteDragHint">Glisse titres, sous-titres et ouvrages pour les réorganiser.</p>\n          ) : null}''',
)

# DnD/activity styling.
replace_once(
    editor,
    '''        .quoteDeleteItemButton {\n          color: #a53d3d;\n        }''',
    '''        .quoteDeleteItemButton {\n          color: #a53d3d;\n        }\n        .quoteDragHint {\n          margin: 4px 0 0;\n          color: var(--muted);\n          font-size: 10px;\n        }\n        .quoteDraggableItem[draggable="true"] {\n          cursor: grab;\n        }\n        .quoteDraggableItem.isDragging {\n          opacity: 0.45;\n        }\n        .quoteDropBefore {\n          box-shadow: inset 0 3px 0 #7867bb;\n        }\n        .quoteDropAfter {\n          box-shadow: inset 0 -3px 0 #7867bb;\n        }\n        .quoteDropInside {\n          outline: 2px dashed #7867bb;\n          outline-offset: -3px;\n        }''',
)
replace_once(
    editor,
    '''        .quoteComponentNameEdit {\n          gap: 5px;\n        }''',
    '''        .quoteComponentNameEdit,\n        .quoteComponentLabel {\n          gap: 5px;\n        }\n        .quoteComponentLabel {\n          display: flex;\n          align-items: center;\n          min-width: 0;\n        }\n        .quoteActivityTag {\n          flex: 0 0 auto;\n          padding: 2px 5px;\n          border-radius: 999px;\n          background: #ece7fa;\n          color: #6554b5;\n          font-size: 8px;\n          font-weight: 900;\n          text-transform: uppercase;\n        }''',
)

# New targeted tests.
Path("tests/library-required-labor.test.ts").write_text(
    '''import { describe, expect, it } from "vitest";\nimport { removeLibraryComponent } from "../src/lib/library/catalog-edit";\nimport {\n  ensureRequiredLaborComponents,\n  REQUIRED_LABOR_COMPONENT_IDS,\n} from "../src/lib/library/required-labor-components";\nimport { createInitialLibraryPayload } from "../src/lib/library/storage";\n\ndescribe("required labor Library components", () => {\n  it("adds BE, Atelier and Pose with hour units and no invented tariff", () => {\n    const payload = ensureRequiredLaborComponents(createInitialLibraryPayload());\n    expect(payload.components).toHaveLength(3);\n    expect(\n      payload.components.map((component) => ({\n        name: component.name,\n        activity: component.activity,\n        unit: component.unit,\n        cost: component.costPriceCents,\n        sale: component.salePriceCents,\n      })),\n    ).toEqual([\n      { name: "Heure BE", activity: "BE", unit: "h", cost: 0, sale: 0 },\n      { name: "Heure atelier", activity: "ATELIER", unit: "h", cost: 0, sale: 0 },\n      { name: "Heure pose", activity: "POSE", unit: "h", cost: 0, sale: 0 },\n    ]);\n  });\n\n  it("is idempotent and preserves edited pricing for an existing activity", () => {\n    const first = ensureRequiredLaborComponents(createInitialLibraryPayload());\n    first.components[0] = {\n      ...first.components[0],\n      costPriceCents: 5_000,\n      marginPercent: 40,\n      salePriceCents: 7_000,\n    };\n    const second = ensureRequiredLaborComponents(first);\n    expect(second.components).toHaveLength(3);\n    expect(second.components.find((component) => component.activity === "BE")).toMatchObject({\n      costPriceCents: 5_000,\n      salePriceCents: 7_000,\n    });\n  });\n\n  it("prevents deleting the three required semantic components", () => {\n    const payload = ensureRequiredLaborComponents(createInitialLibraryPayload());\n    expect(() => removeLibraryComponent(payload, REQUIRED_LABOR_COMPONENT_IDS.BE)).toThrow(\n      "LIBRARY_COMPONENT_REQUIRED",\n    );\n  });\n});\n''',
    encoding="utf-8",
)

Path("tests/quote-item-reorder.test.ts").write_text(
    '''import { describe, expect, it } from "vitest";\nimport { reorderQuoteItems } from "../src/lib/quotes/item-reorder";\nimport { parseQuoteModel, type QuoteItem } from "../src/lib/quotes/model";\n\nconst sectionA = "11111111-1111-4111-8111-111111111111";\nconst sectionB = "22222222-2222-4222-8222-222222222222";\nconst subA = "33333333-3333-4333-8333-333333333333";\nconst subB = "44444444-4444-4444-8444-444444444444";\nconst lineA = "55555555-5555-4555-8555-555555555555";\nconst lineB = "66666666-6666-4666-8666-666666666666";\n\nfunction line(id: string, parentId: string | null, description: string): QuoteItem {\n  return {\n    id,\n    kind: "LINE",\n    parentId,\n    description,\n    unit: "u",\n    quantity: 1,\n    quantityFormula: null,\n    unitPriceCents: 100,\n    components: [],\n  };\n}\n\nfunction modelItems(): QuoteItem[] {\n  return [\n    { id: sectionA, kind: "SECTION", parentId: null, title: "A" },\n    { id: subA, kind: "SUBSECTION", parentId: sectionA, title: "A.1" },\n    line(lineA, subA, "Ouvrage A"),\n    { id: sectionB, kind: "SECTION", parentId: null, title: "B" },\n    { id: subB, kind: "SUBSECTION", parentId: sectionB, title: "B.1" },\n    line(lineB, subB, "Ouvrage B"),\n  ];\n}\n\nfunction expectValid(items: QuoteItem[]) {\n  expect(() =>\n    parseQuoteModel({\n      id: "77777777-7777-4777-8777-777777777777",\n      clientId: "88888888-8888-4888-8888-888888888888",\n      subject: "Test",\n      issueDate: "2026-09-15",\n      validityDays: 30,\n      paymentTerms: "30 jours",\n      items,\n    }),\n  ).not.toThrow();\n}\n\ndescribe("quote item drag/drop reorder", () => {\n  it("moves an ouvrage into another title", () => {\n    const moved = reorderQuoteItems(modelItems(), lineA, sectionB, "INSIDE");\n    const ouvrage = moved.find((item) => item.id === lineA);\n    expect(ouvrage?.kind).toBe("LINE");\n    if (ouvrage?.kind === "LINE") expect(ouvrage.parentId).toBe(sectionB);\n    expect(moved.map((item) => item.id)).toEqual([sectionA, subA, sectionB, subB, lineB, lineA]);\n    expectValid(moved);\n  });\n\n  it("moves an ouvrage before another ouvrage and adopts its parent", () => {\n    const moved = reorderQuoteItems(modelItems(), lineA, lineB, "BEFORE");\n    const ouvrage = moved.find((item) => item.id === lineA);\n    if (ouvrage?.kind !== "LINE") throw new Error("TEST_LINE_NOT_FOUND");\n    expect(ouvrage.parentId).toBe(subB);\n    expect(moved.map((item) => item.id)).toEqual([sectionA, subA, sectionB, subB, lineA, lineB]);\n    expectValid(moved);\n  });\n\n  it("moves a subtitle with its ouvrages into another title", () => {\n    const moved = reorderQuoteItems(modelItems(), subA, sectionB, "INSIDE");\n    const subtitle = moved.find((item) => item.id === subA);\n    if (subtitle?.kind !== "SUBSECTION") throw new Error("TEST_SUBTITLE_NOT_FOUND");\n    expect(subtitle.parentId).toBe(sectionB);\n    expect(moved.map((item) => item.id)).toEqual([sectionA, sectionB, subB, lineB, subA, lineA]);\n    expectValid(moved);\n  });\n\n  it("moves a whole title block after another title", () => {\n    const moved = reorderQuoteItems(modelItems(), sectionA, sectionB, "AFTER");\n    expect(moved.map((item) => item.id)).toEqual([sectionB, subB, lineB, sectionA, subA, lineA]);\n    expectValid(moved);\n  });\n\n  it("rejects incompatible placements", () => {\n    expect(() => reorderQuoteItems(modelItems(), sectionA, subB, "INSIDE")).toThrow(\n      "QUOTE_ITEM_REORDER_BLOCKED",\n    );\n  });\n});\n''',
    encoding="utf-8",
)

Path("tests/quote-labor-activity.test.ts").write_text(
    '''import { describe, expect, it } from "vitest";\nimport { createLibraryComponentFromQuoteLine } from "../src/lib/quotes/library-component";\nimport { applyQuotesMutation, quotesMutationSchema } from "../src/lib/quotes/mutations";\nimport { createInitialNativeQuotesPayload } from "../src/lib/quotes/store";\n\nconst actor = {\n  userId: "11111111-1111-4111-8111-111111111111",\n  displayName: "Lucien",\n};\nconst affairId = "22222222-2222-4222-8222-222222222222";\nconst clientId = "33333333-3333-4333-8333-333333333333";\nconst componentId = "44444444-4444-4444-8444-444444444444";\n\ndescribe("quote labor activity semantics", () => {\n  it("keeps BE/Atelier/Pose activity in the Library snapshot and quote component", () => {\n    const library = createLibraryComponentFromQuoteLine({\n      componentId,\n      name: "Heure atelier",\n      description: "",\n      unit: "h",\n      costPriceCents: 5_000,\n      salePriceCents: 7_000,\n      activity: "ATELIER",\n    });\n    expect(library.component.activity).toBe("ATELIER");\n    expect(library.source.component.activity).toBe("ATELIER");\n\n    const draft = applyQuotesMutation(\n      createInitialNativeQuotesPayload(),\n      quotesMutationSchema.parse({\n        action: "createDraft",\n        commercialCaseId: affairId,\n        subject: "Agencement",\n        issueDate: "2026-09-15",\n        paymentTerms: "30 jours",\n      }),\n      actor,\n      clientId,\n    );\n\n    const saved = applyQuotesMutation(\n      draft.payload,\n      quotesMutationSchema.parse({\n        action: "upsertOuvrage",\n        quoteId: draft.focusQuoteId,\n        description: "Meuble",\n        unit: "u",\n        quantityInput: "1",\n        components: [\n          {\n            libraryComponentId: componentId,\n            description: "Heure atelier",\n            unit: "h",\n            quantityInput: "3",\n            unitPriceCents: 7_000,\n          },\n        ],\n      }),\n      actor,\n      undefined,\n      new Date(),\n      undefined,\n      new Map([[componentId, library.source]]),\n    );\n\n    const ouvrage = saved.payload.quotes[0].model.items[0];\n    if (ouvrage.kind !== "LINE") throw new Error("TEST_LINE_NOT_FOUND");\n    expect(ouvrage.components?.[0]).toMatchObject({\n      activity: "ATELIER",\n      librarySource: { component: { activity: "ATELIER" } },\n    });\n  });\n});\n''',
    encoding="utf-8",
)
