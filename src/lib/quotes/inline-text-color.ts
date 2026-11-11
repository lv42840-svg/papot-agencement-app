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

function clamp(valeur: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(valeur, minimum), maximum);
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
    .sort((gauche, droite) => gauche.start - droite.start || gauche.end - droite.end);

  const merged: QuoteItemTextColorMark[] = [];
  for (const mark of sorted) {
    const precedent = merged.at(-1);
    if (precedent && precedent.color === mark.color && precedent.end === mark.start) {
      precedent.end = mark.end;
      continue;
    }
    merged.push({ ...mark });
  }
  return merged;
}

export function applyQuoteInlineTextColor(
  textLength: number,
  marks: readonly QuoteItemTextColorMark[],
  debut: number,
  fin: number,
  color: string | null,
): QuoteItemTextColorMark[] {
  const safeStart = clamp(Math.min(debut, fin), 0, textLength);
  const safeEnd = clamp(Math.max(debut, fin), 0, textLength);
  if (safeEnd <= safeStart) return normalizeMarks(textLength, marks);

  const suivant: QuoteItemTextColorMark[] = [];
  for (const mark of normalizeMarks(textLength, marks)) {
    if (mark.end <= safeStart || mark.start >= safeEnd) {
      suivant.push(mark);
      continue;
    }
    if (mark.start < safeStart) {
      suivant.push({ ...mark, end: safeStart });
    }
    if (mark.end > safeEnd) {
      suivant.push({ ...mark, start: safeEnd });
    }
  }

  if (color) suivant.push({ start: safeStart, end: safeEnd, color });
  return normalizeMarks(textLength, suivant);
}

export type QuoteInlineTextSegment = {
  start: number;
  end: number;
  text: string;
  color: string | null;
};

export function buildQuoteInlineTextSegments(
  texte: string,
  marks: readonly QuoteItemTextColorMark[],
): QuoteInlineTextSegment[] {
  if (!texte) return [];
  const normalized = normalizeMarks(texte.length, marks);
  if (normalized.length === 0) {
    return [{ start: 0, end: texte.length, text: texte, color: null }];
  }

  const segments: QuoteInlineTextSegment[] = [];
  let cursor = 0;
  for (const mark of normalized) {
    if (mark.start > cursor) {
      segments.push({
        start: cursor,
        end: mark.start,
        text: texte.slice(cursor, mark.start),
        color: null,
      });
    }
    segments.push({
      start: mark.start,
      end: mark.end,
      text: texte.slice(mark.start, mark.end),
      color: mark.color,
    });
    cursor = mark.end;
  }
  if (cursor < texte.length) {
    segments.push({
      start: cursor,
      end: texte.length,
      text: texte.slice(cursor),
      color: null,
    });
  }
  return segments;
}
