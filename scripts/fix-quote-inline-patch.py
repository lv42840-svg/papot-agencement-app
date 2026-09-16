from pathlib import Path

path = Path("scripts/patch-quote-inline-options-actions.py")
source = path.read_text(encoding="utf-8")
old_cleanup = "source = re.sub(r'^\\s*moving(?:Line|Heading)Id(?: !== null)? \\|\\|\\n', '', source, flags=re.M)"
new_cleanup = (
    "source = re.sub(r'^.*(?:movingLineId|movingHeadingId).*\\n', '', source, flags=re.M)\n"
    "source = re.sub(r' \\|\\|\\n(\\s*)\\}', r'\\n\\1}', source)\n"
    "source = re.sub(r' \\|\\|\\n(\\s*)\\)', r'\\n\\1)', source)"
)
if source.count(old_cleanup) != 1:
    raise SystemExit("expected moving-state cleanup expression once")
source = source.replace(old_cleanup, new_cleanup, 1)
false_positive = '    "moveComponent(",\n'
if source.count(false_positive) != 1:
    raise SystemExit("expected moveComponent guard once")
source = source.replace(false_positive, "", 1)
path.write_text(source, encoding="utf-8")
