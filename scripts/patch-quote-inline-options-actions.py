from pathlib import Path
import re


def replace_once(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected 1 occurrence, got {count}: {old[:140]!r}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


def regex_once(path: Path, pattern: str, replacement: str) -> None:
    source = path.read_text(encoding="utf-8")
    next_source, count = re.subn(pattern, replacement, source, count=1, flags=re.S | re.M)
    if count != 1:
        raise SystemExit(f"{path}: expected regex once, got {count}: {pattern[:140]!r}")
    path.write_text(next_source, encoding="utf-8")


editor = Path("src/components/quote-structured-lines-editor.tsx")
pricing_editor = Path("src/components/quote-pricing-adjustments-editor.tsx")
layout_test = Path("tests/quote-table-layout.test.ts")

# 1. Remove obsolete arrow controls/imports now that drag-and-drop is the source of truth.
replace_once(
    editor,
    '''import {\n  ArrowDown,\n  ArrowUp,\n  Check,''',
    '''import {\n  Check,''',
)
replace_once(
    editor,
    '''import {\n  canMoveQuoteComponent,\n  duplicateQuoteComponent,\n  moveQuoteComponent,\n  type QuoteComponentMoveDirection,\n} from "@/lib/quotes/component-order";''',
    '''import { duplicateQuoteComponent } from "@/lib/quotes/component-order";''',
)

replace_once(
    editor,
    '''  const [duplicatingLineId, setDuplicatingLineId] = useState<string | null>(null);\n  const [movingLineId, setMovingLineId] = useState<string | null>(null);\n  const [movingHeadingId, setMovingHeadingId] = useState<string | null>(null);\n  const [duplicatingHeadingId, setDuplicatingHeadingId] = useState<string | null>(null);\n  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);''',
    '''  const [duplicatingLineId, setDuplicatingLineId] = useState<string | null>(null);\n  const [duplicatingHeadingId, setDuplicatingHeadingId] = useState<string | null>(null);\n  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);\n  const [togglingOptionItemId, setTogglingOptionItemId] = useState<string | null>(null);''',
)
replace_once(
    editor,
    '''  const [dropTarget, setDropTarget] = useState<{\n    itemId: string;\n    placement: QuoteItemPlacement;\n  } | null>(null);''',
    '''  const [dropTarget, setDropTarget] = useState<{\n    itemId: string;\n    placement: QuoteItemPlacement;\n  } | null>(null);\n  const [draggingComponentKey, setDraggingComponentKey] = useState<string | null>(null);\n  const [componentDropTarget, setComponentDropTarget] = useState<{\n    key: string;\n    placement: "BEFORE" | "AFTER";\n  } | null>(null);''',
)
replace_once(
    editor,
    '''  const [publishedLineIds, setPublishedLineIds] = useState<Set<string>>(new Set());\n  const [publishedComponentIds, setPublishedComponentIds] = useState<Set<string>>(new Set());''',
    '''  const [publishedLineIds, setPublishedLineIds] = useState<Set<string>>(new Set());''',
)
replace_once(
    editor,
    '''    setDuplicatingLineId(null);\n    setMovingLineId(null);\n    setMovingHeadingId(null);\n    setDuplicatingHeadingId(null);\n    setDeletingItemId(null);\n    setDraggingItemId(null);\n    setReorderingItemId(null);\n    setDropTarget(null);''',
    '''    setDuplicatingLineId(null);\n    setDuplicatingHeadingId(null);\n    setDeletingItemId(null);\n    setTogglingOptionItemId(null);\n    setDraggingItemId(null);\n    setReorderingItemId(null);\n    setDropTarget(null);\n    setDraggingComponentKey(null);\n    setComponentDropTarget(null);''',
)
replace_once(
    editor,
    '''    setPublishedLineIds(new Set());\n    setPublishedComponentIds(new Set());''',
    '''    setPublishedLineIds(new Set());''',
)

# Remove legacy up/down heading and ouvrage mutation handlers. DnD already persists arbitrary placement.
regex_once(
    editor,
    r'''\n  function canMoveHeading\(.*?\n  async function deleteItem''',
    '''\n  async function deleteItem''',
)
regex_once(
    editor,
    r'''\n  function canMoveOuvrage\(.*?\n  async function duplicateOuvrage''',
    '''\n  async function duplicateOuvrage''',
)

# Remove stale busy guards referring to the deleted arrow-only states.
source = editor.read_text(encoding="utf-8")
source = re.sub(r'^\s*moving(?:Line|Heading)Id(?: !== null)? \|\|\n', '', source, flags=re.M)
editor.write_text(source, encoding="utf-8")

# Inline pricing endpoint helper for the small O option toggle.
replace_once(
    editor,
    '''async function postLibrary(body: Record<string, unknown>) {\n  const response = await fetch("/api/desktop/library", {\n    method: "POST",\n    headers: { "Content-Type": "application/json" },\n    body: JSON.stringify(body),\n  });\n  const data = (await response.json()) as LibraryOpenResponse | LibrarySaveResponse;\n  if (!response.ok) {\n    const error = "error" in data ? data.error : "LIBRARY_REQUEST_FAILED";\n    throw new Error(error);\n  }\n  return data;\n}''',
    '''async function postLibrary(body: Record<string, unknown>) {\n  const response = await fetch("/api/desktop/library", {\n    method: "POST",\n    headers: { "Content-Type": "application/json" },\n    body: JSON.stringify(body),\n  });\n  const data = (await response.json()) as LibraryOpenResponse | LibrarySaveResponse;\n  if (!response.ok) {\n    const error = "error" in data ? data.error : "LIBRARY_REQUEST_FAILED";\n    throw new Error(error);\n  }\n  return data;\n}\n\nasync function postQuotePricing(body: Record<string, unknown>): Promise<NativeQuotesPayload> {\n  const response = await fetch("/api/desktop/quotes/pricing", {\n    method: "POST",\n    headers: { "Content-Type": "application/json" },\n    body: JSON.stringify(body),\n  });\n  const data = (await response.json()) as QuotesApiResponse;\n  if (!response.ok || !data.payload) {\n    throw new Error(data.error ?? "QUOTES_PRICING_MUTATION_FAILED");\n  }\n  return data.payload;\n}''',
)

# Option toggle lives directly on each quote row instead of in a large bottom module.
replace_once(
    editor,
    '''  async function duplicateHeading(item: QuoteSection | QuoteSubsection) {''',
    '''  function directOptionForItem(itemId: string) {\n    return quote?.pricingConfig.options.find((option) => option.targetItemId === itemId) ?? null;\n  }\n\n  async function toggleItemOption(item: QuoteLine | QuoteSection | QuoteSubsection) {\n    if (!quote || !editable || togglingOptionItemId) return;\n    const existing = directOptionForItem(item.id);\n    const label = item.kind === "LINE" ? item.description : item.title;\n    setTogglingOptionItemId(item.id);\n    setError("");\n    setNotice("");\n\n    try {\n      const payload = existing\n        ? await postQuotePricing({\n            action: "removeOption",\n            quoteId: quote.id,\n            optionId: existing.id,\n          })\n        : await postQuotePricing({\n            action: "upsertOption",\n            quoteId: quote.id,\n            option: {\n              id: globalThis.crypto.randomUUID(),\n              targetItemId: item.id,\n              targetKind: item.kind,\n              label,\n              status: "PENDING",\n            },\n          });\n      onSaved(payload);\n      setNotice(existing ? "Option retirée du devis." : "Élément placé en option hors total.");\n    } catch {\n      setError("L’option n’a pas pu être modifiée.");\n    } finally {\n      setTogglingOptionItemId(null);\n    }\n  }\n\n  async function duplicateHeading(item: QuoteSection | QuoteSubsection) {''',
)

# Components also become draggable so all arrow controls can disappear.
regex_once(
    editor,
    r'''\n  function moveComponent\(index: number, direction: QuoteComponentMoveDirection\) \{.*?\n  function duplicateComponent''',
    '''\n  function startComponentDrag(event: DragEvent<HTMLDivElement>, key: string) {\n    const origin = event.target as HTMLElement;\n    if (saving || origin.closest("button, input, textarea, select")) {\n      event.preventDefault();\n      return;\n    }\n    setDraggingComponentKey(key);\n    setComponentDropTarget(null);\n    event.dataTransfer.effectAllowed = "move";\n    event.dataTransfer.setData("text/plain", key);\n  }\n\n  function dragComponentOver(event: DragEvent<HTMLDivElement>, key: string) {\n    if (!draggingComponentKey || draggingComponentKey === key) return;\n    event.preventDefault();\n    const bounds = event.currentTarget.getBoundingClientRect();\n    const placement = event.clientY < bounds.top + bounds.height / 2 ? "BEFORE" : "AFTER";\n    event.dataTransfer.dropEffect = "move";\n    setComponentDropTarget((current) =>\n      current?.key === key && current.placement === placement ? current : { key, placement },\n    );\n  }\n\n  function finishComponentDrag() {\n    setDraggingComponentKey(null);\n    setComponentDropTarget(null);\n  }\n\n  function dropComponent(event: DragEvent<HTMLDivElement>, targetKey: string) {\n    if (!draggingComponentKey || draggingComponentKey === targetKey) return;\n    event.preventDefault();\n    const placement = componentDropTarget?.key === targetKey ? componentDropTarget.placement : "BEFORE";\n    setComponents((current) => {\n      const sourceIndex = current.findIndex((component) => component.key === draggingComponentKey);\n      if (sourceIndex < 0) return current;\n      const sourceComponent = current[sourceIndex];\n      const remaining = current.filter((_, index) => index !== sourceIndex);\n      const targetIndex = remaining.findIndex((component) => component.key === targetKey);\n      if (targetIndex < 0) return current;\n      const insertionIndex = placement === "AFTER" ? targetIndex + 1 : targetIndex;\n      return [\n        ...remaining.slice(0, insertionIndex),\n        sourceComponent,\n        ...remaining.slice(insertionIndex),\n      ];\n    });\n    finishComponentDrag();\n  }\n\n  function componentDropClass(key: string): string {\n    const classes: string[] = [];\n    if (draggingComponentKey === key) classes.push("isDragging");\n    if (componentDropTarget?.key === key) {\n      classes.push(\n        componentDropTarget.placement === "BEFORE"\n          ? "quoteComponentDropBefore"\n          : "quoteComponentDropAfter",\n      );\n    }\n    return classes.length > 0 ? ` ${classes.join(" ")}` : "";\n  }\n\n  function duplicateComponent''',
)

# +B on a linked/edited component asks whether to overwrite the existing Library entry.
replace_once(
    editor,
    '''      const published = publishQuoteComponentToLibrary(basePayload, component);\n\n      if (!published.created) {\n        setLibraryPayload(published.payload);\n        setPublishedComponentIds((current) => new Set(current).add(component.id));\n        setNotice("Composant déjà présent dans la Bibliothèque.");\n        return;\n      }\n\n      const saved = (await postLibrary({''',
    '''      let published = publishQuoteComponentToLibrary(basePayload, component);\n      const linkedComponentId = component.librarySource?.component.sourceComponentId;\n      const canOverwriteLinked =\n        published.created &&\n        linkedComponentId !== undefined &&\n        basePayload.components.some((item) => item.id === linkedComponentId);\n\n      if (canOverwriteLinked) {\n        const overwrite = window.confirm(\n          "Ce composant vient de la Bibliothèque et a été modifié.\\n\\nOK : mettre à jour le composant existant\\nAnnuler : créer un nouveau composant",\n        );\n        if (overwrite) {\n          published = publishQuoteComponentToLibrary(\n            basePayload,\n            component,\n            () => globalThis.crypto.randomUUID(),\n            "OVERWRITE_LINKED",\n          );\n        }\n      }\n\n      if (!published.created && !published.updated) {\n        setLibraryPayload(published.payload);\n        setNotice("Composant déjà présent dans la Bibliothèque.");\n        return;\n      }\n\n      const saved = (await postLibrary({''',
)
replace_once(
    editor,
    '''      setLibraryPayload(parseLibraryPayload(saved.resource.payload));\n      setPublishedComponentIds((current) => new Set(current).add(component.id));\n      setNotice("Composant ajouté à la Bibliothèque.");''',
    '''      setLibraryPayload(parseLibraryPayload(saved.resource.payload));\n      setNotice(\n        published.updated\n          ? "Composant mis à jour dans la Bibliothèque."\n          : "Composant ajouté à la Bibliothèque.",\n      );''',
)
replace_once(
    editor,
    '''                disabled={\n                  librarySavingLineId !== null ||\n                  librarySavingComponentId !== null ||\n                  publishedComponentIds.has(component.id)\n                }\n                aria-label={`Ajouter ${component.description} à la Bibliothèque`}\n                title={\n                  publishedComponentIds.has(component.id)\n                    ? "Composant déjà ajouté à la Bibliothèque"\n                    : "Ajouter le composant à la Bibliothèque"\n                }''',
    '''                disabled={librarySavingLineId !== null || librarySavingComponentId !== null}\n                aria-label={`Ajouter ou mettre à jour ${component.description} dans la Bibliothèque`}\n                title="Ajouter à la Bibliothèque ou mettre à jour le composant lié"''',
)

# Ouvrage: compact action bar, inline O option, no arrow buttons.
replace_once(
    editor,
    '''    const lineTotalCents = Math.round(line.quantity * salePriceCents);''',
    '''    const lineTotalCents = Math.round(line.quantity * salePriceCents);\n    const directOption = directOptionForItem(line.id);''',
)
regex_once(
    editor,
    r'''\n                <button\n                  type="button"\n                  className="iconButton"\n                  onClick=\{\(\) => void moveOuvrage\(line, "UP"\)\}.*?<ArrowDown size=\{14\} aria-hidden="true" />\n                </button>''',
    '''''',
)
replace_once(
    editor,
    '''                </button>\n                <button\n                  type="button"\n                  className="iconButton"\n                  onClick={() => void duplicateOuvrage(line)}''',
    '''                </button>\n                <button\n                  type="button"\n                  className={`miniOptionButton${directOption ? " isActive" : ""}`}\n                  onClick={() => void toggleItemOption(line)}\n                  disabled={togglingOptionItemId !== null}\n                  aria-label={directOption ? `Retirer ${line.description} des options` : `Mettre ${line.description} en option`}\n                  title={directOption ? "Retirer l’option" : "Mettre en option hors total"}\n                >\n                  O\n                </button>\n                <button\n                  type="button"\n                  className="iconButton"\n                  onClick={() => void duplicateOuvrage(line)}''',
)

# Component edit rows: make the row itself draggable and keep only duplicate/delete actions.
replace_once(
    editor,
    '''              <div className="quoteComponentRow quoteComponentRowEditing" key={component.key}>''',
    '''              <div\n                className={`quoteComponentRow quoteComponentRowEditing quoteComponentDraggable${componentDropClass(component.key)}`}\n                key={component.key}\n                draggable={!saving}\n                onDragStart={(event) => startComponentDrag(event, component.key)}\n                onDragOver={(event) => dragComponentOver(event, component.key)}\n                onDrop={(event) => dropComponent(event, component.key)}\n                onDragEnd={finishComponentDrag}\n                title="Glisser-déposer pour déplacer le composant"\n              >''',
)
regex_once(
    editor,
    r'''\n                  <button\n                    type="button"\n                    className="miniActionButton"\n                    onClick=\{\(\) => moveComponent\(index, "UP"\)\}.*?<ArrowDown size=\{13\} aria-hidden="true" />\n                  </button>''',
    '''''',
)

# Heading actions: O + copy/edit/delete. Remove the two legacy arrows.
replace_once(
    editor,
    '''    if (editing && headingEditor)\n      return renderHeadingEditor(headingEditor, numbers.get(item.id) ?? "—");\n\n    return (''',
    '''    if (editing && headingEditor)\n      return renderHeadingEditor(headingEditor, numbers.get(item.id) ?? "—");\n    const directOption = directOptionForItem(item.id);\n\n    return (''',
)
regex_once(
    editor,
    r'''\n              <button\n                type="button"\n                className="iconButton"\n                onClick=\{\(\) => void moveHeading\(item, "UP"\)\}.*?<ArrowDown size=\{14\} aria-hidden="true" />\n              </button>''',
    '''''',
)
replace_once(
    editor,
    '''            <>\n              <button\n                type="button"\n                className="iconButton"\n                onClick={() => void duplicateHeading(item)}''',
    '''            <>\n              <button\n                type="button"\n                className={`miniOptionButton${directOption ? " isActive" : ""}`}\n                onClick={() => void toggleItemOption(item)}\n                disabled={togglingOptionItemId !== null}\n                aria-label={directOption ? `Retirer ${item.title} des options` : `Mettre ${item.title} en option`}\n                title={directOption ? "Retirer l’option" : "Mettre en option hors total"}\n              >\n                O\n              </button>\n              <button\n                type="button"\n                className="iconButton"\n                onClick={() => void duplicateHeading(item)}''',
)

# Hint and layout: give Total HT its own space and reserve a real action column.
replace_once(
    editor,
    '''              Glisse titres, sous-titres et ouvrages pour les réorganiser.''',
    '''              Glisse titres, sous-titres, ouvrages et composants pour les réorganiser.''',
)
replace_once(
    editor,
    '''          grid-template-columns: 52px minmax(300px, 1fr) 82px 72px 120px 120px 120px 82px;\n          gap: 10px;\n          align-items: center;\n          padding: 9px 18px;\n          min-width: 1040px;''',
    '''          grid-template-columns: 44px minmax(250px, 1fr) 64px 56px 104px 100px 110px 170px;\n          gap: 8px;\n          align-items: center;\n          padding: 9px 14px;\n          min-width: 980px;''',
)
replace_once(
    editor,
    '''          min-width: 1040px;\n          border-top: 1px solid var(--border);''',
    '''          min-width: 980px;\n          border-top: 1px solid var(--border);''',
)
replace_once(
    editor,
    '''        .miniLibraryButton,\n        .miniActionButton,\n        .quoteResetPrice,\n        .quoteDeleteComponent {''',
    '''        .miniLibraryButton,\n        .miniOptionButton,\n        .miniActionButton,\n        .quoteResetPrice,\n        .quoteDeleteComponent {''',
)
replace_once(
    editor,
    '''        .miniLibraryButton {\n          min-width: 30px;\n          height: 28px;\n          padding: 0 6px;\n          border-color: #d7cfed;\n          border-radius: 6px;\n          color: #6554b5;\n          font-size: 10px;\n          font-weight: 900;\n        }''',
    '''        .miniLibraryButton,\n        .miniOptionButton {\n          min-width: 30px;\n          height: 28px;\n          padding: 0 6px;\n          border-color: #d7cfed;\n          border-radius: 6px;\n          color: #6554b5;\n          font-size: 10px;\n          font-weight: 900;\n        }\n        .miniOptionButton.isActive {\n          border-color: #8c78c7;\n          background: #e9e2fb;\n          color: #4f3c93;\n          box-shadow: inset 0 0 0 1px #cfc2ef;\n        }''',
)
replace_once(
    editor,
    '''        .miniLibraryButton:hover:not(:disabled),\n        .miniActionButton:hover:not(:disabled),''',
    '''        .miniLibraryButton:hover:not(:disabled),\n        .miniOptionButton:hover:not(:disabled),\n        .miniActionButton:hover:not(:disabled),''',
)
replace_once(
    editor,
    '''        .miniLibraryButton:disabled,\n        .miniActionButton:disabled,''',
    '''        .miniLibraryButton:disabled,\n        .miniOptionButton:disabled,\n        .miniActionButton:disabled,''',
)
replace_once(
    editor,
    '''          grid-template-columns: minmax(220px, 1fr) 82px 70px 105px 82px 105px 105px 122px;''',
    '''          grid-template-columns: minmax(220px, 1fr) 76px 64px 100px 78px 100px 100px 70px;''',
)
replace_once(
    editor,
    '''        .quoteComponentActions {\n          justify-content: flex-end;\n          gap: 4px;\n        }''',
    '''        .quoteComponentActions {\n          justify-content: flex-end;\n          gap: 4px;\n        }\n        .quoteComponentDraggable[draggable="true"] {\n          cursor: grab;\n        }\n        .quoteComponentDraggable.isDragging {\n          opacity: 0.45;\n        }\n        .quoteComponentDropBefore {\n          box-shadow: inset 0 3px 0 #7867bb;\n        }\n        .quoteComponentDropAfter {\n          box-shadow: inset 0 -3px 0 #7867bb;\n        }''',
)
replace_once(
    editor,
    '''          .quoteMainRow,\n          .quoteOuvrageGroup {\n            min-width: 1040px;''',
    '''          .quoteMainRow,\n          .quoteOuvrageGroup {\n            min-width: 980px;''',
)

# The large options editor is removed: row-level O controls are now the fast path.
replace_once(
    pricing_editor,
    '''import {\n  calculateQuoteAdjustedPricing,\n  type QuoteOption,\n  type QuotePricingAdjustment,\n} from "@/lib/quotes/adjustments";''',
    '''import {\n  calculateQuoteAdjustedPricing,\n  type QuotePricingAdjustment,\n} from "@/lib/quotes/adjustments";''',
)
regex_once(
    pricing_editor,
    r'''\ntype OptionTarget = .*?;\n''',
    '''\n''',
)
regex_once(
    pricing_editor,
    r'''\nfunction itemLabel\(item: OptionTarget\): string \{.*?\n\}\n''',
    '''\n''',
)
replace_once(
    pricing_editor,
    '''  const [applyToOptions, setApplyToOptions] = useState(true);\n  const [optionTargetId, setOptionTargetId] = useState("");\n  const [optionLabel, setOptionLabel] = useState("Option");\n  const [saving, setSaving] = useState(false);''',
    '''  const [applyToOptions, setApplyToOptions] = useState(true);\n  const [saving, setSaving] = useState(false);''',
)
regex_once(
    pricing_editor,
    r'''\n  const optionTargets = useMemo\(.*?\n  const pricing = useMemo\(''',
    '''\n  const pricing = useMemo(''',
)
regex_once(
    pricing_editor,
    r'''\n  async function addOption\(\).*?\n  return \(''',
    '''\n  return (''',
)
replace_once(
    pricing_editor,
    '''          <h2>Ajustements, pose et options</h2>''',
    '''          <h2>Ajustements et pose</h2>''',
)
regex_once(
    pricing_editor,
    r'''\n      <div className="panel">\n        <h3>Options client hors total</h3>.*?\n      </div>\n\n      \{warningLabels''',
    '''\n      {warningLabels''',
)
replace_once(
    pricing_editor,
    '''        .formRow input,\n        .formRow select,\n        .optionRow select {''',
    '''        .formRow input,\n        .formRow select {''',
)
regex_once(
    pricing_editor,
    r'''\n        \.optionForm select \{.*?\n        \}\n        \.optionForm input \{.*?\n        \}\n''',
    '''\n''',
)
replace_once(
    pricing_editor,
    '''        .listRow,\n        .optionRow {''',
    '''        .listRow {''',
)
regex_once(
    pricing_editor,
    r'''\n        \.optionRow \{\n          grid-template-columns: minmax\(0, 1fr\) auto auto;\n        \}\n''',
    '''\n''',
)

# Layout regression tests now encode the compact action column and DnD-only controls.
layout_test.write_text(
    '''import { readFileSync } from "node:fs";\nimport { describe, expect, it } from "vitest";\n\nconst source = readFileSync(\n  new URL("../src/components/quote-structured-lines-editor.tsx", import.meta.url),\n  "utf-8",\n);\n\ndescribe("quote table layout", () => {\n  it("keeps inline quote editing styled as a table without hiding Total HT", () => {\n    expect(source).toContain("<style jsx global>");\n    expect(source).toContain(\n      "grid-template-columns: 44px minmax(250px, 1fr) 64px 56px 104px 100px 110px 170px;",\n    );\n    expect(source).toContain("<span>Total HT</span>");\n    expect(source).toContain("quoteLineTotal");\n    expect(source).toContain(".miniOptionButton");\n  });\n\n  it("uses drag-and-drop instead of arrow movement controls", () => {\n    expect(source).not.toContain("ArrowUp");\n    expect(source).not.toContain("ArrowDown");\n    expect(source).not.toContain("Remonter l’ouvrage");\n    expect(source).not.toContain("Descendre l’ouvrage");\n    expect(source).toContain("Glisser-déposer pour déplacer le composant");\n  });\n\n  it("uses the requested hierarchy font sizes", () => {\n    expect(source).toContain(".quoteHeadingRow.isSection > strong");\n    expect(source).toContain("font-size: 18px;");\n    expect(source).toContain(".quoteHeadingRow.isSubsection > strong");\n    expect(source).toContain("font-size: 15px;");\n    expect(source).toContain(".quoteComponentRow");\n    expect(source).toContain("font-size: 13px;");\n  });\n});\n''',
    encoding="utf-8",
)

Path("tests/quote-inline-options-ui.test.ts").write_text(
    '''import { readFileSync } from "node:fs";\nimport { describe, expect, it } from "vitest";\n\nconst linesSource = readFileSync(\n  new URL("../src/components/quote-structured-lines-editor.tsx", import.meta.url),\n  "utf-8",\n);\nconst adjustmentsSource = readFileSync(\n  new URL("../src/components/quote-pricing-adjustments-editor.tsx", import.meta.url),\n  "utf-8",\n);\n\ndescribe("inline quote options", () => {\n  it("puts the O toggle directly in quote row actions", () => {\n    expect(linesSource).toContain("toggleItemOption");\n    expect(linesSource).toContain("miniOptionButton");\n    expect(linesSource).toContain("Mettre en option hors total");\n  });\n\n  it("removes the old large options module", () => {\n    expect(adjustmentsSource).not.toContain("Options client hors total");\n    expect(adjustmentsSource).not.toContain("Choisir une ligne ou un groupe");\n    expect(adjustmentsSource).not.toContain("Mettre en option</button>");\n  });\n});\n''',
    encoding="utf-8",
)

# Guardrails: fail loudly if any legacy UI survived the patch.
final_editor = editor.read_text(encoding="utf-8")
for forbidden in [
    "ArrowUp",
    "ArrowDown",
    "movingLineId",
    "movingHeadingId",
    "publishedComponentIds",
    "moveOuvrage(",
    "moveHeading(",
    "moveComponent(",
]:
    if forbidden in final_editor:
        raise SystemExit(f"legacy quote control still present: {forbidden}")

final_pricing = pricing_editor.read_text(encoding="utf-8")
if "Options client hors total" in final_pricing:
    raise SystemExit("old options module still present")
