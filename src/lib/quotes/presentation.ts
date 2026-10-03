import type { QuoteItem, QuoteItemTextStyle } from "./model";

export const QUOTE_FONT_FAMILY_OPTIONS = [
  { value: "DEFAULT", label: "Par défaut" },
  { value: "ARIAL", label: "Arial" },
  { value: "CALIBRI", label: "Calibri" },
  { value: "GEORGIA", label: "Georgia" },
  { value: "TIMES_NEW_ROMAN", label: "Times New Roman" },
  { value: "VERDANA", label: "Verdana" },
] as const;

const FONT_FAMILY_CSS: Record<QuoteItemTextStyle["fontFamily"], string | undefined> = {
  DEFAULT: undefined,
  ARIAL: "Arial, sans-serif",
  CALIBRI: "Calibri, Candara, Segoe, sans-serif",
  GEORGIA: "Georgia, serif",
  TIMES_NEW_ROMAN: '"Times New Roman", Times, serif',
  VERDANA: "Verdana, sans-serif",
};

export function defaultQuoteItemTextStyle(item: QuoteItem): QuoteItemTextStyle {
  return {
    fontFamily: "DEFAULT",
    fontSizePx: item.kind === "SECTION" ? 18 : item.kind === "SUBSECTION" ? 15 : 13,
    textColor: "#111827",
    highlightColor: null,
    bold: item.kind !== "COMMENT",
    italic: false,
  };
}

export function quoteItemTextStyleToCss(style: QuoteItemTextStyle | undefined) {
  if (!style) return undefined;
  return {
    fontFamily: FONT_FAMILY_CSS[style.fontFamily],
    fontSize: `${style.fontSizePx}px`,
    color: style.textColor,
    backgroundColor: style.highlightColor ?? undefined,
    fontWeight: style.bold ? 800 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    padding: style.highlightColor ? "1px 3px" : undefined,
    borderRadius: style.highlightColor ? "3px" : undefined,
  };
}
