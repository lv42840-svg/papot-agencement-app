from pathlib import Path

path = Path("src/components/quote-structured-lines-editor.tsx")
source = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one occurrence, got {count}: {old[:80]!r}")
    source = source.replace(old, new, 1)


def replace_exact_count(old: str, new: str, expected: int) -> None:
    global source
    count = source.count(old)
    if count != expected:
        raise SystemExit(f"expected {expected} occurrences, got {count}: {old[:80]!r}")
    source = source.replace(old, new)


replace_once(
    "\nfunction lineErrorLabel(code: string): string {",
    """
function ouvrageTotalCents(quantityInput: string, unitPriceCents: number | null): number | null {
  if (unitPriceCents === null) return null;
  try {
    const quantity = parseQuoteQuantityInput(quantityInput).quantity;
    const total = Math.round(quantity * unitPriceCents);
    return Number.isSafeInteger(total) && total >= 0 ? total : null;
  } catch {
    return null;
  }
}

function lineErrorLabel(code: string): string {""",
)

replace_once(
    "    const publishedNow = publishedLineIds.has(line.id);\n",
    "    const publishedNow = publishedLineIds.has(line.id);\n    const lineTotalCents = Math.round(line.quantity * salePriceCents);\n",
)

replace_once(
    """          </div>
          <div className=\"quoteRowActions\">
            {editable ? (""",
    """          </div>
          <strong className=\"quoteLineTotal\">{formatMoney(lineTotalCents)}</strong>
          <div className=\"quoteRowActions\">
            {editable ? (""",
)

replace_once(
    "    const number = editingLineId ? (numbers.get(editingLineId) ?? \"—\") : \"+\";\n",
    "    const number = editingLineId ? (numbers.get(editingLineId) ?? \"—\") : \"+\";\n    const currentLineTotal = ouvrageTotalCents(quantityInput, effectiveUnitPrice);\n",
)

replace_once(
    """          <div className=\"quoteMarginCell\">
            <strong>{formatPercent(currentMarginPercent)}</strong>
          </div>
          <div className=\"quoteRowActions\">""",
    """          <div className=\"quoteMarginCell\">
            <strong>{formatPercent(currentMarginPercent)}</strong>
          </div>
          <strong className=\"quoteLineTotal\">
            {currentLineTotal === null ? \"—\" : formatMoney(currentLineTotal)}
          </strong>
          <div className=\"quoteRowActions\">""",
)

replace_once(
    """          <span>PU HT</span>
          <span>Marge</span>
          <span />""",
    """          <span>PU HT</span>
          <span>Marge</span>
          <span>Total HT</span>
          <span />""",
)

replace_exact_count(
    """        <span />
        <span />
        <span />
        <span />
        <div className=\"quoteRowActions\">""",
    """        <span />
        <span />
        <span />
        <span />
        <span />
        <div className=\"quoteRowActions\">""",
    2,
)

replace_once(
    """              <span>{item.text}</span>
              <span />
              <span />
              <span />
              <span />
              <span />""",
    """              <span>{item.text}</span>
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />""",
)

replace_once(
    "            <span className=\"quoteNumber\">+</span>\n",
    "            <span />\n",
)

replace_once(
    """            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : null}""",
    """            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : null}""",
)

replace_once("<style jsx>{`", "<style jsx global>{`")

replace_once(
    "          grid-template-columns: 52px minmax(260px, 1fr) 82px 72px 135px 140px 82px;\n",
    "          grid-template-columns: 52px minmax(300px, 1fr) 82px 72px 120px 120px 120px 82px;\n",
)
source = source.replace("          min-width: 920px;\n", "          min-width: 1040px;\n")
source = source.replace("            min-width: 920px;\n", "            min-width: 1040px;\n")

replace_once(
    "          font-size: 12px;\n          background: #fff;\n",
    "          font-size: 13px;\n          background: #fff;\n",
)
replace_once(
    "          font-size: 11px;\n        }\n        .quoteComponentTitleActions {",
    "          font-size: 13px;\n        }\n        .quoteComponentTitleActions {",
)
replace_once("          font-size: 16px;\n", "          font-size: 18px;\n")
replace_once(
    "          font-size: 13px;\n        }\n        .quoteHeadingEditing {",
    "          font-size: 15px;\n        }\n        .quoteHeadingEditing {",
)

replace_once(
    """        .quoteRowActions {
          justify-content: flex-end;
          gap: 5px;
        }
""",
    """        .quoteRowActions {
          justify-content: flex-end;
          gap: 5px;
        }
        .quoteLineTotal {
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
""",
)

replace_once(
    """        .quoteComponentsTable {
          margin: 0 18px 12px 70px;
          overflow: hidden;
""",
    """        .quoteComponentsTable {
          margin: 0 18px 12px 70px;
          min-width: 900px;
          overflow: hidden;
""",
)

path.write_text(source, encoding="utf-8")

test = Path("tests/quote-table-layout.test.ts")
test.write_text(
    '''import { readFileSync } from "node:fs";\nimport { describe, expect, it } from "vitest";\n\nconst source = readFileSync(\n  new URL("../src/components/quote-structured-lines-editor.tsx", import.meta.url),\n  "utf-8",\n);\n\ndescribe("quote table layout", () => {\n  it("keeps inline quote editing styled as a table", () => {\n    expect(source).toContain("<style jsx global>");\n    expect(source).toContain("grid-template-columns: 52px minmax(300px, 1fr) 82px 72px 120px 120px 120px 82px;");\n    expect(source).toContain("<span>Total HT</span>");\n    expect(source).toContain("quoteLineTotal");\n  });\n\n  it("uses the requested hierarchy font sizes", () => {\n    expect(source).toContain(".quoteHeadingRow.isSection > strong");\n    expect(source).toContain("font-size: 18px;");\n    expect(source).toContain(".quoteHeadingRow.isSubsection > strong");\n    expect(source).toContain("font-size: 15px;");\n    expect(source).toContain(".quoteComponentRow");\n    expect(source).toContain("font-size: 13px;");\n  });\n});\n''',
    encoding="utf-8",
)
