from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one occurrence, got {count}: {old[:160]!r}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


editor = Path("src/components/quote-structured-lines-editor.tsx")
replace_once(
    editor,
    '''} from "@/lib/library/storage";\nimport { parseQuoteQuantityInput } from "@/lib/quotes/domain";''',
    '''} from "@/lib/library/storage";\nimport {\n  canMoveQuoteComponent,\n  moveQuoteComponent,\n  type QuoteComponentMoveDirection,\n} from "@/lib/quotes/component-order";\nimport { parseQuoteQuantityInput } from "@/lib/quotes/domain";''',
)
replace_once(
    editor,
    '''  function removeComponent(index: number) {\n    setComponents((current) => {\n      if (current.length <= 1) return current;\n      return current.filter((_, componentIndex) => componentIndex !== index);\n    });\n  }''',
    '''  function moveComponent(index: number, direction: QuoteComponentMoveDirection) {\n    setComponents((current) => moveQuoteComponent(current, index, direction));\n  }\n\n  function removeComponent(index: number) {\n    setComponents((current) => {\n      if (current.length <= 1) return current;\n      return current.filter((_, componentIndex) => componentIndex !== index);\n    });\n  }''',
)
replace_once(
    editor,
    '''                <button\n                  type="button"\n                  className="quoteDeleteComponent"\n                  onClick={() => removeComponent(index)}\n                  disabled={components.length === 1}\n                  aria-label={`Supprimer le composant ${index + 1}`}\n                  title="Supprimer le composant"\n                >\n                  <Trash2 size={13} aria-hidden="true" />\n                </button>''',
    '''                <div className="quoteComponentActions">\n                  <button\n                    type="button"\n                    className="miniActionButton"\n                    onClick={() => moveComponent(index, "UP")}\n                    disabled={!canMoveQuoteComponent(components.length, index, "UP")}\n                    aria-label={`Remonter le composant ${index + 1}`}\n                    title="Remonter le composant"\n                  >\n                    <ArrowUp size={13} aria-hidden="true" />\n                  </button>\n                  <button\n                    type="button"\n                    className="miniActionButton"\n                    onClick={() => moveComponent(index, "DOWN")}\n                    disabled={!canMoveQuoteComponent(components.length, index, "DOWN")}\n                    aria-label={`Descendre le composant ${index + 1}`}\n                    title="Descendre le composant"\n                  >\n                    <ArrowDown size={13} aria-hidden="true" />\n                  </button>\n                  <button\n                    type="button"\n                    className="quoteDeleteComponent"\n                    onClick={() => removeComponent(index)}\n                    disabled={components.length === 1}\n                    aria-label={`Supprimer le composant ${index + 1}`}\n                    title="Supprimer le composant"\n                  >\n                    <Trash2 size={13} aria-hidden="true" />\n                  </button>\n                </div>''',
)
replace_once(
    editor,
    '''        .quoteComponentNameEdit,\n        .quoteAddActions {\n          display: flex;''',
    '''        .quoteComponentNameEdit,\n        .quoteComponentActions,\n        .quoteAddActions {\n          display: flex;''',
)
replace_once(
    editor,
    '''          grid-template-columns: minmax(220px, 1fr) 82px 70px 105px 82px 105px 105px 34px;''',
    '''          grid-template-columns: minmax(220px, 1fr) 82px 70px 105px 82px 105px 105px 92px;''',
)
replace_once(
    editor,
    '''        .quoteComponentTitleActions {\n          gap: 5px;\n        }''',
    '''        .quoteComponentTitleActions {\n          gap: 5px;\n        }\n        .quoteComponentActions {\n          justify-content: flex-end;\n          gap: 4px;\n        }''',
)
