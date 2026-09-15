from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one occurrence, got {count}: {old[:120]!r}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


mutations = Path("src/lib/quotes/mutations.ts")
replace_once(
    mutations,
    '''const upsertSectionMutationSchema = z.object({\n  action: z.literal("upsertSection"),''',
    '''const duplicateLineMutationSchema = z.object({\n  action: z.literal("duplicateLine"),\n  quoteId: z.string().uuid(),\n  lineId: z.string().uuid(),\n});\n\nconst upsertSectionMutationSchema = z.object({\n  action: z.literal("upsertSection"),''',
)
replace_once(
    mutations,
    '''  upsertLineMutationSchema,\n  upsertOuvrageMutationSchema,\n  upsertSectionMutationSchema,''',
    '''  upsertLineMutationSchema,\n  upsertOuvrageMutationSchema,\n  duplicateLineMutationSchema,\n  upsertSectionMutationSchema,''',
)
replace_once(
    mutations,
    '''function upsertDraftHeading(\n  payload: NativeQuotesPayload,''',
    '''function duplicateDraftLine(\n  payload: NativeQuotesPayload,\n  input: Extract<QuotesMutation, { action: "duplicateLine" }>,\n  actor: QuotesActor,\n  now: Date,\n): QuotesMutationResult {\n  const { quoteIndex, quote, existingLine, existingIndex } = findDraftLine(\n    payload,\n    input.quoteId,\n    input.lineId,\n  );\n  if (!existingLine || existingIndex < 0) throw new Error("QUOTE_LINE_NOT_FOUND");\n\n  const duplicatedLine: QuoteLine = {\n    ...structuredClone(existingLine),\n    id: globalThis.crypto.randomUUID(),\n    components: (existingLine.components ?? []).map((component) => ({\n      ...structuredClone(component),\n      id: globalThis.crypto.randomUUID(),\n    })),\n  };\n\n  const items = [...quote.model.items];\n  items.splice(existingIndex + 1, 0, duplicatedLine);\n  const timestamp = now.toISOString();\n  const updated = nativeQuoteRecordSchema.parse({\n    ...quote,\n    model: parseQuoteModel({ ...quote.model, items }),\n    updatedAt: timestamp,\n    updatedByName: actor.displayName,\n  });\n  payload.quotes[quoteIndex] = updated;\n  return { payload, focusQuoteId: updated.id };\n}\n\nfunction upsertDraftHeading(\n  payload: NativeQuotesPayload,''',
)
replace_once(
    mutations,
    '''  if (input.action === "upsertSection" || input.action === "upsertSubsection") {\n    return upsertDraftHeading(payload, input, actor, now);\n  }\n  if (input.action === "upsertOuvrage") {''',
    '''  if (input.action === "upsertSection" || input.action === "upsertSubsection") {\n    return upsertDraftHeading(payload, input, actor, now);\n  }\n  if (input.action === "duplicateLine") {\n    return duplicateDraftLine(payload, input, actor, now);\n  }\n  if (input.action === "upsertOuvrage") {''',
)

editor = Path("src/components/quote-structured-lines-editor.tsx")
replace_once(
    editor,
    '''import { Check, LockKeyhole, Pencil, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";''',
    '''import { Check, Copy, LockKeyhole, Pencil, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";''',
)
replace_once(
    editor,
    '''  const [headingEditor, setHeadingEditor] = useState<HeadingEditor>(null);\n  const [saving, setSaving] = useState(false);''',
    '''  const [headingEditor, setHeadingEditor] = useState<HeadingEditor>(null);\n  const [saving, setSaving] = useState(false);\n  const [duplicatingLineId, setDuplicatingLineId] = useState<string | null>(null);''',
)
replace_once(
    editor,
    '''    setHeadingEditor(null);\n    setError("");\n    setNotice("");''',
    '''    setHeadingEditor(null);\n    setDuplicatingLineId(null);\n    setError("");\n    setNotice("");''',
)
replace_once(
    editor,
    '''  async function addOuvrageToLibrary(line: QuoteLine) {''',
    '''  async function duplicateOuvrage(line: QuoteLine) {\n    if (!quote || !editable || duplicatingLineId || formOpen || headingEditor) return;\n    setDuplicatingLineId(line.id);\n    setError("");\n    setNotice("");\n\n    try {\n      const response = await fetch("/api/desktop/quotes", {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({\n          action: "duplicateLine",\n          quoteId: quote.id,\n          lineId: line.id,\n        }),\n      });\n      const data = (await response.json()) as QuotesApiResponse;\n      if (!response.ok || !data.payload) {\n        setError(lineErrorLabel(data.error ?? "QUOTES_MUTATION_FAILED"));\n        return;\n      }\n      onSaved(data.payload);\n      setNotice("Ouvrage dupliqué.");\n    } catch {\n      setError("L’ouvrage n’a pas pu être dupliqué.");\n    } finally {\n      setDuplicatingLineId(null);\n    }\n  }\n\n  async function addOuvrageToLibrary(line: QuoteLine) {''',
)
replace_once(
    editor,
    '''                <button\n                  type="button"\n                  className="iconButton"\n                  onClick={() => openEditOuvrage(line)}\n                  disabled={formOpen || headingEditor !== null}\n                  aria-label={`Modifier ${line.description}`}\n                  title="Modifier l’ouvrage"\n                >\n                  <Pencil size={14} aria-hidden="true" />\n                </button>''',
    '''                <button\n                  type="button"\n                  className="iconButton"\n                  onClick={() => void duplicateOuvrage(line)}\n                  disabled={formOpen || headingEditor !== null || duplicatingLineId !== null}\n                  aria-label={`Dupliquer ${line.description}`}\n                  title="Dupliquer l’ouvrage"\n                >\n                  <Copy size={14} aria-hidden="true" />\n                </button>\n                <button\n                  type="button"\n                  className="iconButton"\n                  onClick={() => openEditOuvrage(line)}\n                  disabled={formOpen || headingEditor !== null || duplicatingLineId !== null}\n                  aria-label={`Modifier ${line.description}`}\n                  title="Modifier l’ouvrage"\n                >\n                  <Pencil size={14} aria-hidden="true" />\n                </button>''',
)

Path("tests/quote-line-duplication.test.ts").write_text(
    '''import { describe, expect, it } from "vitest";\nimport { applyQuotesMutation, quotesMutationSchema } from "../src/lib/quotes/mutations";\nimport { createInitialNativeQuotesPayload } from "../src/lib/quotes/store";\n\nconst actor = {\n  userId: "11111111-1111-4111-8111-111111111111",\n  displayName: "Lucien",\n};\nconst affairId = "22222222-2222-4222-8222-222222222222";\nconst clientId = "33333333-3333-4333-8333-333333333333";\n\nfunction createDraft() {\n  return applyQuotesMutation(\n    createInitialNativeQuotesPayload(),\n    quotesMutationSchema.parse({\n      action: "createDraft",\n      commercialCaseId: affairId,\n      subject: "Agencement accueil",\n      issueDate: "2026-09-15",\n      paymentTerms: "45 jours fin de mois",\n    }),\n    actor,\n    clientId,\n    new Date("2026-09-15T12:00:00.000Z"),\n  );\n}\n\nfunction addOuvrageWithSection() {\n  const created = createDraft();\n  const withSection = applyQuotesMutation(\n    created.payload,\n    quotesMutationSchema.parse({\n      action: "upsertSection",\n      quoteId: created.focusQuoteId,\n      title: "Mobilier",\n    }),\n    actor,\n  );\n  const section = withSection.payload.quotes[0].model.items[0];\n  if (section.kind !== "SECTION") throw new Error("TEST_SECTION_NOT_FOUND");\n\n  return applyQuotesMutation(\n    withSection.payload,\n    quotesMutationSchema.parse({\n      action: "upsertOuvrage",\n      quoteId: created.focusQuoteId,\n      parentId: section.id,\n      description: "Meuble bas 2 portes",\n      unit: "u",\n      quantityInput: "2",\n      forcedUnitPriceCents: 40_000,\n      components: [\n        {\n          description: "Panneau mélaminé",\n          unit: "m²",\n          quantityInput: "3",\n          costPriceCents: 3_000,\n          unitPriceCents: 5_000,\n        },\n        {\n          description: "Heure atelier",\n          unit: "h",\n          quantityInput: "2",\n          costPriceCents: 5_000,\n          unitPriceCents: 7_000,\n        },\n      ],\n    }),\n    actor,\n  );\n}\n\ndescribe("quote line duplication", () => {\n  it("duplicates an ouvrage immediately after its source with fresh ids", () => {\n    const added = addOuvrageWithSection();\n    const source = added.payload.quotes[0].model.items[1];\n    if (source.kind !== "LINE" || !source.components) throw new Error("TEST_LINE_NOT_FOUND");\n\n    const duplicated = applyQuotesMutation(\n      added.payload,\n      quotesMutationSchema.parse({\n        action: "duplicateLine",\n        quoteId: added.focusQuoteId,\n        lineId: source.id,\n      }),\n      actor,\n      undefined,\n      new Date("2026-09-15T12:05:00.000Z"),\n    );\n\n    const items = duplicated.payload.quotes[0].model.items;\n    expect(items).toHaveLength(3);\n    expect(items[1].id).toBe(source.id);\n    const copy = items[2];\n    expect(copy.kind).toBe("LINE");\n    if (copy.kind !== "LINE" || !copy.components) throw new Error("TEST_COPY_NOT_FOUND");\n\n    expect(copy.id).not.toBe(source.id);\n    expect(copy).toMatchObject({\n      parentId: source.parentId,\n      description: source.description,\n      unit: source.unit,\n      quantity: source.quantity,\n      quantityFormula: source.quantityFormula,\n      unitPriceCents: source.unitPriceCents,\n      forcedUnitPriceCents: source.forcedUnitPriceCents,\n    });\n    expect(copy.components).toHaveLength(source.components.length);\n    copy.components.forEach((component, index) => {\n      expect(component.id).not.toBe(source.components![index].id);\n      expect(component).toMatchObject({\n        description: source.components![index].description,\n        unit: source.components![index].unit,\n        quantity: source.components![index].quantity,\n        quantityFormula: source.components![index].quantityFormula,\n        costPriceCents: source.components![index].costPriceCents,\n        unitPriceCents: source.components![index].unitPriceCents,\n      });\n    });\n    expect(duplicated.payload.quotes[0].updatedAt).toBe("2026-09-15T12:05:00.000Z");\n  });\n\n  it("refuses duplication outside a draft", () => {\n    const added = addOuvrageWithSection();\n    const source = added.payload.quotes[0].model.items[1];\n    if (source.kind !== "LINE") throw new Error("TEST_LINE_NOT_FOUND");\n    const sent = structuredClone(added.payload);\n    sent.quotes[0].status = "SENT";\n\n    expect(() =>\n      applyQuotesMutation(\n        sent,\n        quotesMutationSchema.parse({\n          action: "duplicateLine",\n          quoteId: added.focusQuoteId,\n          lineId: source.id,\n        }),\n        actor,\n      ),\n    ).toThrow("QUOTE_NOT_EDITABLE");\n  });\n});\n''',
    encoding="utf-8",
)
