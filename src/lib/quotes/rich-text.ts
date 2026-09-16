import type {
  QuoteItemTextStyle,
  QuoteRichText,
  QuoteRichTextRun,
  QuoteRichTextRunStyle,
} from "./model";

export const EMPTY_QUOTE_RICH_TEXT_STYLE: QuoteRichTextRunStyle = {
  bold: false,
  italic: false,
  underline: false,
  textColor: null,
  highlightColor: null,
  fontSizePx: null,
};

function sameStyle(left: QuoteRichTextRunStyle, right: QuoteRichTextRunStyle): boolean {
  return (
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.underline === right.underline &&
    left.textColor === right.textColor &&
    left.highlightColor === right.highlightColor &&
    left.fontSizePx === right.fontSizePx
  );
}

function cloneStyle(style: QuoteRichTextRunStyle): QuoteRichTextRunStyle {
  return { ...style };
}

export function quoteRichTextStyleFromLegacy(
  style: QuoteItemTextStyle | undefined,
): QuoteRichTextRunStyle {
  if (!style) return { ...EMPTY_QUOTE_RICH_TEXT_STYLE };
  return {
    bold: style.bold,
    italic: style.italic,
    underline: false,
    textColor: style.textColor,
    highlightColor: style.highlightColor,
    fontSizePx: style.fontSizePx,
  };
}

export function quoteRichTextFromPlainText(
  text: string,
  style: QuoteRichTextRunStyle = EMPTY_QUOTE_RICH_TEXT_STYLE,
): QuoteRichText {
  return {
    runs: text.length > 0 ? [{ text, style: cloneStyle(style) }] : [],
  };
}

export function normalizeQuoteRichText(richText: QuoteRichText): QuoteRichText {
  const runs: QuoteRichTextRun[] = [];
  for (const candidate of richText.runs) {
    if (!candidate.text) continue;
    const run: QuoteRichTextRun = {
      text: candidate.text,
      style: cloneStyle(candidate.style),
    };
    const previous = runs.at(-1);
    if (previous && sameStyle(previous.style, run.style)) previous.text += run.text;
    else runs.push(run);
  }
  return { runs };
}

export function quoteRichTextToPlainText(richText: QuoteRichText | undefined): string {
  return richText?.runs.map((run) => run.text).join("") ?? "";
}

export function resolveQuoteRichText(
  text: string,
  richText: QuoteRichText | undefined,
  legacyStyle?: QuoteItemTextStyle,
): QuoteRichText {
  if (richText && quoteRichTextToPlainText(richText) === text) {
    return normalizeQuoteRichText(richText);
  }

  let result = quoteRichTextFromPlainText(text, quoteRichTextStyleFromLegacy(legacyStyle));
  for (const mark of legacyStyle?.textColorMarks ?? []) {
    result = applyQuoteRichTextStyle(result, mark.start, mark.end, { textColor: mark.color });
  }
  return result;
}

export function applyQuoteRichTextStyle(
  richText: QuoteRichText,
  start: number,
  end: number,
  patch: Partial<QuoteRichTextRunStyle>,
): QuoteRichText {
  if (end <= start) return normalizeQuoteRichText(richText);

  const textLength = quoteRichTextToPlainText(richText).length;
  const safeStart = Math.max(0, Math.min(start, textLength));
  const safeEnd = Math.max(safeStart, Math.min(end, textLength));
  if (safeEnd <= safeStart) return normalizeQuoteRichText(richText);

  const runs: QuoteRichTextRun[] = [];
  let cursor = 0;

  for (const run of richText.runs) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;

    if (runEnd <= safeStart || runStart >= safeEnd) {
      runs.push({ text: run.text, style: cloneStyle(run.style) });
      continue;
    }

    const localStart = Math.max(0, safeStart - runStart);
    const localEnd = Math.min(run.text.length, safeEnd - runStart);

    if (localStart > 0) {
      runs.push({ text: run.text.slice(0, localStart), style: cloneStyle(run.style) });
    }

    runs.push({
      text: run.text.slice(localStart, localEnd),
      style: { ...run.style, ...patch },
    });

    if (localEnd < run.text.length) {
      runs.push({ text: run.text.slice(localEnd), style: cloneStyle(run.style) });
    }
  }

  return normalizeQuoteRichText({ runs });
}

export function quoteRichTextSelectionStyle(
  richText: QuoteRichText,
  start: number,
  end: number,
): QuoteRichTextRunStyle | null {
  if (end <= start) return null;
  let cursor = 0;
  let common: QuoteRichTextRunStyle | null = null;

  for (const run of richText.runs) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;
    if (runEnd <= start || runStart >= end) continue;

    if (!common) common = cloneStyle(run.style);
    else {
      if (common.bold !== run.style.bold) common.bold = false;
      if (common.italic !== run.style.italic) common.italic = false;
      if (common.underline !== run.style.underline) common.underline = false;
      if (common.textColor !== run.style.textColor) common.textColor = null;
      if (common.highlightColor !== run.style.highlightColor) common.highlightColor = null;
      if (common.fontSizePx !== run.style.fontSizePx) common.fontSizePx = null;
    }
  }

  return common;
}

export function quoteRichTextHasUniformBooleanStyle(
  richText: QuoteRichText,
  start: number,
  end: number,
  key: "bold" | "italic" | "underline",
): boolean {
  if (end <= start) return false;
  let cursor = 0;
  let sawSelectedText = false;

  for (const run of richText.runs) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;
    if (runEnd <= start || runStart >= end) continue;
    sawSelectedText = true;
    if (!run.style[key]) return false;
  }

  return sawSelectedText;
}
