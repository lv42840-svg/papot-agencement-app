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


editor = Path("src/components/quote-structured-lines-editor.tsx")
replace_once(
    editor,
    '''        normalizeSearch([component.name, component.description, component.unit].join(" ")).includes(\n          query,\n        ),''',
    '''        normalizeSearch(\n          [\n            component.name,\n            component.description,\n            component.unit,\n            component.activity ? productionActivityLabel(component.activity) : "",\n          ].join(" "),\n        ).includes(query),''',
)

source = Path("scripts/patch-quote-dnd-labor-components.py").read_text(encoding="utf-8")
marker = '''replace_once(\n    editor,\n    ''' + "'''    setDeletingItemId(null);"
start = source.find(marker)
if start < 0:
    raise SystemExit("tail marker not found")

namespace = {
    "Path": Path,
    "replace_once": replace_once,
    "replace_count": replace_count,
    "editor": editor,
}
exec(compile(source[start:], "patch-quote-dnd-labor-components-tail", "exec"), namespace)
