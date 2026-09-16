from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one occurrence, got {count}: {old[:120]!r}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


editor = Path("src/components/quote-structured-lines-editor.tsx")
replace_once(
    editor,
    'import { duplicateQuoteComponent } from "@/lib/quotes/component-order";\n',
    'import { calculateQuoteAdjustedPricing } from "@/lib/quotes/adjustments";\nimport { duplicateQuoteComponent } from "@/lib/quotes/component-order";\n',
)
replace_once(
    editor,
    '''  const lines = useMemo(\n    () => items.filter((item): item is QuoteLine => item.kind === "LINE"),\n    [items],\n  );\n  const numbers = useMemo(() => buildQuoteItemNumbers(items), [items]);''',
    '''  const lines = useMemo(\n    () => items.filter((item): item is QuoteLine => item.kind === "LINE"),\n    [items],\n  );\n  const adjustedLinesById = useMemo(() => {\n    if (!quote) return new Map();\n    const adjusted = calculateQuoteAdjustedPricing(quote.model.items, quote.pricingConfig);\n    return new Map(adjusted.lines.map((line) => [line.lineId, line]));\n  }, [quote]);\n  const numbers = useMemo(() => buildQuoteItemNumbers(items), [items]);''',
)
replace_once(
    editor,
    '''    const publishedNow = publishedLineIds.has(line.id);\n    const lineTotalCents = Math.round(line.quantity * salePriceCents);\n    const directOption = directOptionForItem(line.id);''',
    '''    const publishedNow = publishedLineIds.has(line.id);\n    const baseLineTotalCents = Math.round(line.quantity * salePriceCents);\n    const adjustedLine = adjustedLinesById.get(line.id);\n    const lineTotalCents = adjustedLine?.saleCents ?? baseLineTotalCents;\n    const adjustmentDeltaCents = lineTotalCents - baseLineTotalCents;\n    const directOption = directOptionForItem(line.id);''',
)
replace_once(
    editor,
    '''          <strong className="quoteLineTotal">{formatMoney(lineTotalCents)}</strong>\n          <div className="quoteRowActions">''',
    '''          <div className="quoteLineTotalCell">\n            <strong className="quoteLineTotal">{formatMoney(lineTotalCents)}</strong>\n            {adjustmentDeltaCents !== 0 ? (\n              <small>incl. {formatMoney(adjustmentDeltaCents)} d’ajustements</small>\n            ) : null}\n          </div>\n          <div className="quoteRowActions">''',
)
replace_once(
    editor,
    '''        .quoteLineTotal {\n          white-space: nowrap;\n          font-variant-numeric: tabular-nums;\n        }''',
    '''        .quoteLineTotalCell {\n          min-width: 0;\n          display: grid;\n          gap: 2px;\n          justify-items: start;\n        }\n        .quoteLineTotalCell small {\n          color: #7867bb;\n          font-size: 9px;\n          font-weight: 800;\n          white-space: nowrap;\n        }\n        .quoteLineTotal {\n          white-space: nowrap;\n          font-variant-numeric: tabular-nums;\n        }''',
)

test = Path("tests/quote-adjusted-line-totals-ui.test.ts")
test.write_text(
    '''import { readFileSync } from "node:fs";\nimport { describe, expect, it } from "vitest";\n\nconst source = readFileSync(\n  new URL("../src/components/quote-structured-lines-editor.tsx", import.meta.url),\n  "utf-8",\n);\n\ndescribe("quote adjusted line totals UI", () => {\n  it("uses the adjusted pricing engine for each displayed ouvrage total", () => {\n    expect(source).toContain("calculateQuoteAdjustedPricing");\n    expect(source).toContain("adjustedLinesById");\n    expect(source).toContain("adjustedLine?.saleCents ?? baseLineTotalCents");\n    expect(source).toContain("d’ajustements");\n  });\n});\n''',
    encoding="utf-8",
)

adjustments_test = Path("tests/quote-adjustments.test.ts")
replace_once(
    adjustments_test,
    '''    expect(result.totalSaleCents).toBe(10_526_316);\n    expect(result.totalCostCents).toBe(6_526_316);''',
    '''    expect(result.lines[0].saleCents).toBe(10_526_316);\n    expect(result.totalSaleCents).toBe(10_526_316);\n    expect(result.totalCostCents).toBe(6_526_316);''',
)
replace_once(
    adjustments_test,
    '''    expect(result.lines.map((entry) => entry.poseHours)).toEqual([24, 12, 12]);\n    expect(result.totalPoseHours).toBe(48);''',
    '''    expect(result.lines.map((entry) => entry.poseHours)).toEqual([24, 12, 12]);\n    expect(result.lines.map((entry) => entry.saleCents)).toEqual([1_028_000, 514_000, 514_000]);\n    expect(result.totalPoseHours).toBe(48);''',
)
