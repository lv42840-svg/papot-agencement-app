import type { QuoteItemTextColorMark } from "./model";

export const QUOTE_INLINE_TEXT_COLOR_PRESETS = [
  { label: "Noir", value: "#111827" },
  { label: "Gris", value: "#475569" },
  { label: "Lavande", value: "#6554b5" },
  { label: "Bleu", value: "#2563eb" },
  { label: "Vert", value: "#15803d" },
  { label: "Rouge", value: "#b91c1c" },
  { label: "Orange", value: "#c2410c" },
] as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function normalizeMarks(
  textLength: number,
  marks: readonly QuoteItemTextColorMark[],
): QuoteItemTextColorMark[] {
  const safeLength = Math.max(0, textLength);
  const sorted = marks
    .map((mark) => ({
      start: clamp(mark.start, 0, safeLength),
      end: clamp(mark.end, 0, safeLength),
      color: mark.color,
    }))
    .filter((mark) => mark.end > mark.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: QuoteItemTextColorMark[] = [];
  for (const mark of sorted) {
    const previous = merged.at(-1);
    if (previous && previous.color === mark.color && previous.end === mark.start) {
      previous.end = mark.end;
      continue;
    }
    merged.push({ ...mark });
  }
  return merged;
}

export function applyQuoteInlineTextColor(
  textLength: number,
  marks: readonly QuoteItemTextColorMark[],
  start: number,
  end: number,
  color: string | null,
): QuoteItemTextColorMark[] {
  const safeStart = clamp(Math.min(start, end), 0, textLength);
  const safeEnd = clamp(Math.max(start, end), 0, textLength);
  if (safeEnd <= safeStart) return normalizeMarks(textLength, marks);

  const next: QuoteItemTextColorMark[] = [];
  for (const mark of normalizeMarks(textLength, marks)) {
    if (mark.end <= safeStart || mark.start >= safeEnd) {
      next.push(mark);
      continue;
    }
    if (mark.start < safeStart) {
      next.push({ ...mark, end: safeStart });
    }
    if (mark.end > safeEnd) {
      next.push({ ...mark, start: safeEnd });
    }
  }

  if (color) next.push({ start: safeStart, end: safeEnd, color });
  return normalizeMarks(textLength, next);
}

export type QuoteInlineTextSegment = {
  start: number;
  end: number;
  text: string;
  color: string | null;
};

export function buildQuoteInlineTextSegments(
  text: string,
  marks: readonly QuoteItemTextColorMark[],
): QuoteInlineTextSegment[] {
  if (!text) return [];
  const normalized = normalizeMarks(text.length, marks);
  if (normalized.length === 0) {
    return [{ start: 0, end: text.length, text, color: null }];
  }

  const segments: QuoteInlineTextSegment[] = [];
  let cursor = 0;
  for (const mark of normalized) {
    if (mark.start > cursor) {
      segments.push({
        start: cursor,
        end: mark.start,
        text: text.slice(cursor, mark.start),
        color: null,
      });
    }
    segments.push({
      start: mark.start,
      end: mark.end,
      text: text.slice(mark.start, mark.end),
      color: mark.color,
    });
    cursor = mark.end;
  }
  if (cursor < text.length) {
    segments.push({
      start: cursor,
      end: text.length,
      text: text.slice(cursor),
      color: null,
    });
  }
  return segments;
}
