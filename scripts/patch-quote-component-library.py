from pathlib import Path

path = Path("src/components/quote-structured-lines-editor.tsx")
source = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one occurrence, got {count}: {old[:100]!r}")
    source = source.replace(old, new, 1)


replace_once(
    'import { publishQuoteOuvrageToLibrary } from "@/lib/quotes/library-publish";',
    'import {\n  publishQuoteComponentToLibrary,\n  publishQuoteOuvrageToLibrary,\n} from "@/lib/quotes/library-publish";',
)

replace_once(
    '  const [librarySavingLineId, setLibrarySavingLineId] = useState<string | null>(null);\n  const [publishedLineIds, setPublishedLineIds] = useState<Set<string>>(new Set());',
    '  const [librarySavingLineId, setLibrarySavingLineId] = useState<string | null>(null);\n  const [librarySavingComponentId, setLibrarySavingComponentId] = useState<string | null>(null);\n  const [publishedLineIds, setPublishedLineIds] = useState<Set<string>>(new Set());\n  const [publishedComponentIds, setPublishedComponentIds] = useState<Set<string>>(new Set());',
)

replace_once(
    '    setLibraryPickerOpen(false);\n    setPublishedLineIds(new Set());',
    '    setLibraryPickerOpen(false);\n    setPublishedLineIds(new Set());\n    setPublishedComponentIds(new Set());',
)

marker = '''  function renderComponentReadRows(lineComponents: QuoteOuvrageComponent[]) {'''
new_function = '''  async function addComponentToLibrary(component: QuoteOuvrageComponent) {
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

      const basePayload = opened.resource
        ? parseLibraryPayload(opened.resource.payload)
        : createInitialLibraryPayload();
      const published = publishQuoteComponentToLibrary(basePayload, component);

      if (!published.created) {
        setLibraryPayload(published.payload);
        setPublishedComponentIds((current) => new Set(current).add(component.id));
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
      setPublishedComponentIds((current) => new Set(current).add(component.id));
      setNotice("Composant ajouté à la Bibliothèque.");
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

  function renderComponentReadRows(lineComponents: QuoteOuvrageComponent[]) {'''
replace_once(marker, new_function)

replace_once(
    '''          <span>{formatMoney(component.unitPriceCents)}</span>
          <span>{formatMoney(Math.round(component.quantity * component.unitPriceCents))}</span>
          <span />''',
    '''          <span>{formatMoney(component.unitPriceCents)}</span>
          <span>{formatMoney(Math.round(component.quantity * component.unitPriceCents))}</span>
          <div className="quoteRowActions">
            {editable ? (
              <button
                type="button"
                className="miniLibraryButton"
                onClick={() => void addComponentToLibrary(component)}
                disabled={
                  librarySavingLineId !== null ||
                  librarySavingComponentId !== null ||
                  publishedComponentIds.has(component.id)
                }
                aria-label={`Ajouter ${component.description} à la Bibliothèque`}
                title={
                  publishedComponentIds.has(component.id)
                    ? "Composant déjà ajouté à la Bibliothèque"
                    : "Ajouter le composant à la Bibliothèque"
                }
              >
                {librarySavingComponentId === component.id ? "…" : "+B"}
              </button>
            ) : null}
          </div>''',
)

path.write_text(source, encoding="utf-8")
