import { readFileSync, writeFileSync } from "node:fs";

const path = "src/components/quote-structured-lines-editor.tsx";
let source = readFileSync(path, "utf8");

function replaceOnce(before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Motif introuvable: ${label}`);
  }
  source = source.replace(before, after);
}

replaceOnce(
  "grid-template-columns: 44px minmax(250px, 1fr) 64px 56px 104px 100px 110px 228px;",
  "grid-template-columns: 44px minmax(250px, 1fr) 64px 56px 104px 100px 126px 220px;",
  "colonnes ligne ouvrage",
);

replaceOnce(
  "<small>incl. {formatMoney(adjustmentDeltaCents)} d’ajustements</small>",
  `<small>\n                <span>incl. {formatMoney(adjustmentDeltaCents)}</span>\n                <span>d’ajustements</span>\n              </small>`,
  "detail ajustements",
);

replaceOnce(
  `        .quoteLineTotalCell small {\n          color: #7867bb;\n          font-size: 9px;\n          font-weight: 800;\n          white-space: nowrap;\n        }`,
  `        .quoteLineTotalCell small {\n          display: grid;\n          gap: 0;\n          max-width: 100%;\n          color: #7867bb;\n          font-size: 9px;\n          font-weight: 800;\n          line-height: 1.15;\n        }\n        .quoteLineTotalCell small span {\n          white-space: nowrap;\n        }`,
  "detail ajustements css",
);

replaceOnce(
  `        .quoteRowActions {\n          justify-content: flex-end;\n          gap: 4px;\n        }`,
  `        .quoteRowActions {\n          min-width: 0;\n          justify-content: flex-end;\n          gap: 4px;\n          flex-wrap: nowrap;\n        }`,
  "actions ouvrage css",
);

writeFileSync(path, source);
