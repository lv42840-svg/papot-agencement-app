from pathlib import Path

path = Path("scripts/patch-quote-inline-options-actions.py")
source = path.read_text(encoding="utf-8")
old = "source = re.sub(r'^\\s*moving(?:Line|Heading)Id(?: !== null)? \\|\\|\\n', '', source, flags=re.M)"
new = "source = re.sub(r'^.*(?:movingLineId|movingHeadingId).*\\n', '', source, flags=re.M)"
if source.count(old) != 1:
    raise SystemExit("expected moving-state cleanup expression once")
path.write_text(source.replace(old, new, 1), encoding="utf-8")
