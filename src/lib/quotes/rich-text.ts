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

function sameStyle(
  gauche: QuoteRichTextRunStyle,
  droite: QuoteRichTextRunStyle,
): boolean {
  return (
    gauche.bold === droite.bold &&
    gauche.italic === droite.italic &&
    gauche.underline === droite.underline &&
    gauche.textColor === droite.textColor &&
    gauche.highlightColor === droite.highlightColor &&
    gauche.fontSizePx === droite.fontSizePx
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
  texte: string,
  style: QuoteRichTextRunStyle = EMPTY_QUOTE_RICH_TEXT_STYLE,
): QuoteRichText {
  return {
    runs: texte.length > 0 ? [{ text: texte, style: cloneStyle(style) }] : [],
  };
}

export function normalizeQuoteRichText(
  texteEnrichi: QuoteRichText,
): QuoteRichText {
  const segments: QuoteRichTextRun[] = [];
  for (const candidat of texteEnrichi.runs) {
    if (!candidat.text) continue;
    const segment: QuoteRichTextRun = {
      text: candidat.text,
      style: cloneStyle(candidat.style),
    };
    const precedent = segments.at(-1);
    if (precedent && sameStyle(precedent.style, segment.style)) {
      precedent.text += segment.text;
    } else {
      segments.push(segment);
    }
  }
  return { runs: segments };
}

export function quoteRichTextToPlainText(
  texteEnrichi: QuoteRichText | undefined,
): string {
  return texteEnrichi?.runs.map((segment) => segment.text).join("") ?? "";
}

export function resolveQuoteRichText(
  texte: string,
  texteEnrichi: QuoteRichText | undefined,
  styleHistorique?: QuoteItemTextStyle,
): QuoteRichText {
  if (texteEnrichi && quoteRichTextToPlainText(texteEnrichi) === texte) {
    return normalizeQuoteRichText(texteEnrichi);
  }

  let resultat = quoteRichTextFromPlainText(
    texte,
    quoteRichTextStyleFromLegacy(styleHistorique),
  );
  for (const marque of styleHistorique?.textColorMarks ?? []) {
    resultat = applyQuoteRichTextStyle(resultat, marque.start, marque.end, {
      textColor: marque.color,
    });
  }
  return resultat;
}

export function applyQuoteRichTextStyle(
  texteEnrichi: QuoteRichText,
  debut: number,
  fin: number,
  modification: Partial<QuoteRichTextRunStyle>,
): QuoteRichText {
  if (fin <= debut) return normalizeQuoteRichText(texteEnrichi);

  const longueurTexte = quoteRichTextToPlainText(texteEnrichi).length;
  const debutSecurise = Math.max(0, Math.min(debut, longueurTexte));
  const finSecurisee = Math.max(
    debutSecurise,
    Math.min(fin, longueurTexte),
  );
  if (finSecurisee <= debutSecurise) {
    return normalizeQuoteRichText(texteEnrichi);
  }

  const segments: QuoteRichTextRun[] = [];
  let curseur = 0;

  for (const segment of texteEnrichi.runs) {
    const debutSegment = curseur;
    const finSegment = curseur + segment.text.length;
    curseur = finSegment;

    if (finSegment <= debutSecurise || debutSegment >= finSecurisee) {
      segments.push({ text: segment.text, style: cloneStyle(segment.style) });
      continue;
    }

    const debutLocal = Math.max(0, debutSecurise - debutSegment);
    const finLocale = Math.min(
      segment.text.length,
      finSecurisee - debutSegment,
    );

    if (debutLocal > 0) {
      segments.push({
        text: segment.text.slice(0, debutLocal),
        style: cloneStyle(segment.style),
      });
    }

    segments.push({
      text: segment.text.slice(debutLocal, finLocale),
      style: { ...segment.style, ...modification },
    });

    if (finLocale < segment.text.length) {
      segments.push({
        text: segment.text.slice(finLocale),
        style: cloneStyle(segment.style),
      });
    }
  }

  return normalizeQuoteRichText({ runs: segments });
}

export function quoteRichTextSelectionStyle(
  texteEnrichi: QuoteRichText,
  debut: number,
  fin: number,
): QuoteRichTextRunStyle | null {
  if (fin <= debut) return null;
  let curseur = 0;
  let styleCommun: QuoteRichTextRunStyle | null = null;

  for (const segment of texteEnrichi.runs) {
    const debutSegment = curseur;
    const finSegment = curseur + segment.text.length;
    curseur = finSegment;
    if (finSegment <= debut || debutSegment >= fin) continue;

    if (!styleCommun) styleCommun = cloneStyle(segment.style);
    else {
      if (styleCommun.bold !== segment.style.bold) styleCommun.bold = false;
      if (styleCommun.italic !== segment.style.italic) styleCommun.italic = false;
      if (styleCommun.underline !== segment.style.underline) {
        styleCommun.underline = false;
      }
      if (styleCommun.textColor !== segment.style.textColor) {
        styleCommun.textColor = null;
      }
      if (styleCommun.highlightColor !== segment.style.highlightColor) {
        styleCommun.highlightColor = null;
      }
      if (styleCommun.fontSizePx !== segment.style.fontSizePx) {
        styleCommun.fontSizePx = null;
      }
    }
  }

  return styleCommun;
}

export function quoteRichTextHasUniformBooleanStyle(
  texteEnrichi: QuoteRichText,
  debut: number,
  fin: number,
  cle: "bold" | "italic" | "underline",
): boolean {
  if (fin <= debut) return false;
  let curseur = 0;
  let texteSelectionneTrouve = false;

  for (const segment of texteEnrichi.runs) {
    const debutSegment = curseur;
    const finSegment = curseur + segment.text.length;
    curseur = finSegment;
    if (finSegment <= debut || debutSegment >= fin) continue;
    texteSelectionneTrouve = true;
    if (!segment.style[cle]) return false;
  }

  return texteSelectionneTrouve;
}
