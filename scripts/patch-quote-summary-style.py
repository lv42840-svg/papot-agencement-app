from pathlib import Path

p = Path("src/components/quote-structured-lines-editor.tsx")
s = p.read_text(encoding="utf-8")
old = '''        .quoteAddActions button:disabled {
          opacity: 0.4;
          cursor: default;
        }
        @media (max-width: 1000px) {'''
new = '''        .quoteAddActions button:disabled {
          opacity: 0.4;
          cursor: default;
        }
        .quoteFixedSummary {
          position: fixed;
          right: 24px;
          bottom: 20px;
          z-index: 50;
          display: flex;
          align-items: stretch;
          gap: 8px;
          padding: 8px;
          border: 1px solid #d7cfed;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.97);
          box-shadow: 0 12px 34px rgba(65, 50, 110, 0.18);
          backdrop-filter: blur(10px);
        }
        .quoteSummaryMetric {
          min-width: 165px;
          display: grid;
          align-content: center;
          gap: 3px;
          padding: 7px 10px;
          border-radius: 8px;
          background: #faf8ff;
        }
        .quoteSummaryMetric > span {
          color: var(--muted);
          font-size: 9px;
          font-weight: 850;
          text-transform: uppercase;
          letter-spacing: 0.045em;
        }
        .quoteSummaryMetric > strong {
          color: var(--text);
          font-size: 15px;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .quoteSummaryMetric > strong small {
          margin-left: 7px;
          color: #31724b;
          font-size: 11px;
          font-weight: 850;
        }
        .quoteSummaryMetric.isNegative > strong,
        .quoteSummaryMetric.isNegative > strong small {
          color: #a53d3d;
        }
        .quoteSummaryMetric.isMissing > strong {
          color: var(--muted);
          font-size: 12px;
        }
        @media (max-width: 700px) {
          .quoteFixedSummary {
            right: 12px;
            bottom: 12px;
            left: 12px;
          }
          .quoteSummaryMetric {
            min-width: 0;
            flex: 1 1 0;
          }
        }
        @media (max-width: 1000px) {'''
if s.count(old) != 1:
    raise SystemExit("summary css anchor not found")
p.write_text(s.replace(old, new, 1), encoding="utf-8")
