from pathlib import Path

p = Path("src/components/quote-structured-lines-editor.tsx")
s = p.read_text(encoding="utf-8")
old = 'import { buildQuoteItemNumbers } from "@/lib/quotes/numbering";\nimport {'
new = 'import { buildQuoteItemNumbers } from "@/lib/quotes/numbering";\nimport { calculateQuoteEconomicSummary } from "@/lib/quotes/summary";\nimport {'
if s.count(old) != 1:
    raise SystemExit("import anchor not found")
p.write_text(s.replace(old, new, 1), encoding="utf-8")
