from pathlib import Path

p = Path("src/components/quote-structured-lines-editor.tsx")
s = p.read_text(encoding="utf-8")

old = '''  const numbers = useMemo(() => buildQuoteItemNumbers(items), [items]);
  const lastSection = useMemo(() => latestSection(items), [items]);
  const editable = canWrite && quote?.status === "DRAFT";'''
new = '''  const numbers = useMemo(() => buildQuoteItemNumbers(items), [items]);
  const lastSection = useMemo(() => latestSection(items), [items]);
  const economicSummary = useMemo(() => calculateQuoteEconomicSummary(items), [items]);
  const editable = canWrite && quote?.status === "DRAFT";'''
if s.count(old) != 1:
    raise SystemExit("summary memo anchor not found")
s = s.replace(old, new, 1)

old = '''      </div>

      <style jsx global>{`
        .quoteLinesPanel {
          overflow: hidden;
        }'''
new = '''      </div>

      <div className="quoteFixedSummary" aria-label="Synthèse économique du devis">
        <div className="quoteSummaryMetric">
          <span>Total HT</span>
          <strong>{formatMoney(economicSummary.totalSaleCents)}</strong>
        </div>
        <div
          className={`quoteSummaryMetric${
            economicSummary.marginAmountCents === null
              ? " isMissing"
              : economicSummary.marginAmountCents < 0
                ? " isNegative"
                : ""
          }`}
        >
          <span>Marge globale prévue</span>
          {economicSummary.marginAmountCents === null ? (
            <strong>À renseigner</strong>
          ) : (
            <strong>
              {formatMoney(economicSummary.marginAmountCents)}
              <small>{formatPercent(economicSummary.marginPercent)}</small>
            </strong>
          )}
        </div>
      </div>

      <style jsx global>{`
        .quoteLinesPanel {
          overflow: hidden;
          padding-bottom: 82px;
        }'''
if s.count(old) != 1:
    raise SystemExit("summary render anchor not found")
s = s.replace(old, new, 1)

p.write_text(s, encoding="utf-8")
