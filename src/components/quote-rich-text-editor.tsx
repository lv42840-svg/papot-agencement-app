"use client";

import { Bold, Highlighter, Italic, RotateCcw, Underline } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { QuoteRichText, QuoteRichTextRunStyle } from "@/lib/quotes/model";
import {
  applyQuoteRichTextStyle,
  EMPTY_QUOTE_RICH_TEXT_STYLE,
  normalizeQuoteRichText,
  quoteRichTextHasUniformBooleanStyle,
  quoteRichTextSelectionStyle,
} from "@/lib/quotes/rich-text";

type SelectionOffsets = { start: number; end: number };

type Props = {
  value: QuoteRichText;
  onChange: (value: QuoteRichText) => void;
  ariaLabel: string;
  maxLength: number;
};

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40];
const HIGHLIGHT_COLOR = "#fff2a8";
const TEXT_COLORS = [
  { label: "Noir", value: "#111827" },
  { label: "Violet PAPOT", value: "#6554b5" },
  { label: "Bleu", value: "#2563eb" },
  { label: "Vert", value: "#15803d" },
  { label: "Rouge", value: "#b42318" },
] as const;

function styleToCss(style: QuoteRichTextRunStyle) {
  return {
    fontWeight: style.bold ? 800 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    textDecoration: style.underline ? "underline" : "none",
    color: style.textColor ?? undefined,
    backgroundColor: style.highlightColor ?? undefined,
    fontSize: style.fontSizePx ? `${style.fontSizePx}px` : undefined,
  };
}

function renderRichText(root: HTMLElement, value: QuoteRichText) {
  root.replaceChildren();
  for (const run of value.runs) {
    const span = root.ownerDocument.createElement("span");
    span.dataset.quoteRichRun = "true";
    Object.assign(span.style, styleToCss(run.style));
    span.append(root.ownerDocument.createTextNode(run.text));
    root.append(span);
  }
}

function styleFromNode(node: Node): QuoteRichTextRunStyle {
  const span = node.parentElement?.closest<HTMLElement>("[data-quote-rich-run='true']");
  if (!span) return { ...EMPTY_QUOTE_RICH_TEXT_STYLE };
  return {
    bold: Number(span.style.fontWeight || 400) >= 700,
    italic: span.style.fontStyle === "italic",
    underline: span.style.textDecorationLine.includes("underline"),
    textColor: span.style.color ? rgbToHex(span.style.color) : null,
    highlightColor: span.style.backgroundColor ? rgbToHex(span.style.backgroundColor) : null,
    fontSizePx: span.style.fontSize ? Number.parseInt(span.style.fontSize, 10) || null : null,
  };
}

function rgbToHex(value: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return null;
  return `#${[match[1], match[2], match[3]]
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function readRichText(root: HTMLElement): QuoteRichText {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const runs: QuoteRichText["runs"] = [];
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? "";
    if (text) runs.push({ text, style: styleFromNode(node) });
    node = walker.nextNode();
  }
  return normalizeQuoteRichText({ runs });
}

function textOffset(root: HTMLElement, node: Node, offset: number): number | null {
  try {
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return null;
  }
}

function selectionOffsets(root: HTMLElement): SelectionOffsets | null {
  const selection = root.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return null;
  }
  const start = textOffset(root, range.startContainer, range.startOffset);
  const end = textOffset(root, range.endContainer, range.endOffset);
  if (start === null || end === null) return null;
  return start <= end ? { start, end } : { start: end, end: start };
}

function pointAtOffset(root: HTMLElement, offset: number): { node: Node; offset: number } | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cursor = 0;
  let node = walker.nextNode();
  let lastNode: Node | null = null;
  while (node) {
    lastNode = node;
    const length = node.textContent?.length ?? 0;
    if (offset <= cursor + length) {
      return { node, offset: Math.max(0, offset - cursor) };
    }
    cursor += length;
    node = walker.nextNode();
  }
  if (!lastNode) return null;
  return { node: lastNode, offset: lastNode.textContent?.length ?? 0 };
}

function restoreSelection(root: HTMLElement, offsets: SelectionOffsets) {
  const start = pointAtOffset(root, offsets.start);
  const end = pointAtOffset(root, offsets.end);
  if (!start || !end) return;
  const range = root.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  const selection = root.ownerDocument.defaultView?.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function insertPlainTextAtSelection(
  root: HTMLElement,
  text: string,
  maxLength: number,
): QuoteRichText | null {
  const offsets = selectionOffsets(root);
  const nativeSelection = root.ownerDocument.defaultView?.getSelection();
  if (!offsets || !nativeSelection || nativeSelection.rangeCount === 0) return null;

  const currentRichText = readRichText(root);
  const plain = currentRichText.runs.map((run) => run.text).join("");
  if (plain.length - (offsets.end - offsets.start) + text.length > maxLength) return null;

  const range = nativeSelection.getRangeAt(0);
  range.deleteContents();
  const inserted = root.ownerDocument.createTextNode(text);
  range.insertNode(inserted);

  const caret = root.ownerDocument.createRange();
  caret.setStartAfter(inserted);
  caret.collapse(true);
  nativeSelection.removeAllRanges();
  nativeSelection.addRange(caret);

  return readRichText(root);
}

export function QuoteRichTextEditor({ value, onChange, ariaLabel, maxLength }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<SelectionOffsets>({ start: 0, end: 0 });
  const [selection, setSelection] = useState<SelectionOffsets>({
    start: 0,
    end: 0,
  });

  useEffect(() => {
    const root = editorRef.current;
    if (!root || root.ownerDocument.activeElement === root) return;
    renderRichText(root, value);
  }, [value]);

  useEffect(() => {
    const root = editorRef.current;
    if (!root) return;
    const document = root.ownerDocument;
    const handleSelectionChange = () => {
      const next = selectionOffsets(root);
      if (!next) return;
      selectionRef.current = next;
      setSelection(next);
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  function currentValue(): QuoteRichText {
    return editorRef.current ? readRichText(editorRef.current) : value;
  }

  function applyPatch(patch: Partial<QuoteRichTextRunStyle>) {
    const root = editorRef.current;
    const offsets = selectionRef.current;
    if (!root || offsets.end <= offsets.start) return;
    const next = applyQuoteRichTextStyle(currentValue(), offsets.start, offsets.end, patch);
    renderRichText(root, next);
    restoreSelection(root, offsets);
    root.focus();
    onChange(next);
  }

  function toggle(key: "bold" | "italic" | "underline") {
    const offsets = selectionRef.current;
    if (offsets.end <= offsets.start) return;
    const current = currentValue();
    applyPatch({
      [key]: !quoteRichTextHasUniformBooleanStyle(current, offsets.start, offsets.end, key),
    });
  }

  function resetSelection() {
    applyPatch({ ...EMPTY_QUOTE_RICH_TEXT_STYLE });
  }

  function rememberSelection() {
    const root = editorRef.current;
    if (!root) return;
    const next = selectionOffsets(root);
    if (!next) return;
    selectionRef.current = next;
    setSelection(next);
  }

  const hasSelection = selection.end > selection.start;
  const current = value;
  const selectionStyle = hasSelection
    ? quoteRichTextSelectionStyle(current, selection.start, selection.end)
    : null;
  const boldActive =
    hasSelection &&
    quoteRichTextHasUniformBooleanStyle(current, selection.start, selection.end, "bold");
  const italicActive =
    hasSelection &&
    quoteRichTextHasUniformBooleanStyle(current, selection.start, selection.end, "italic");
  const underlineActive =
    hasSelection &&
    quoteRichTextHasUniformBooleanStyle(current, selection.start, selection.end, "underline");
  const highlightActive = selectionStyle?.highlightColor?.toLowerCase() === HIGHLIGHT_COLOR;

  return (
    <div className="quoteRichEditorShell">
      <div
        className="quoteRichToolbar"
        role="toolbar"
        aria-label="Mise en forme du texte sélectionné"
      >
        <button
          type="button"
          className={boldActive ? "isActive" : ""}
          disabled={!hasSelection}
          aria-pressed={boldActive}
          title="Gras"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => toggle("bold")}
        >
          <Bold size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={italicActive ? "isActive" : ""}
          disabled={!hasSelection}
          aria-pressed={italicActive}
          title="Italique"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => toggle("italic")}
        >
          <Italic size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={underlineActive ? "isActive" : ""}
          disabled={!hasSelection}
          aria-pressed={underlineActive}
          title="Souligné"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => toggle("underline")}
        >
          <Underline size={15} aria-hidden="true" />
        </button>

        <span className="quoteRichDivider" aria-hidden="true" />

        <label className="quoteRichSize" title="Taille du texte">
          <span>Taille</span>
          <select
            defaultValue="13"
            disabled={!hasSelection}
            onMouseDown={rememberSelection}
            onChange={(event) => applyPatch({ fontSizePx: Number(event.target.value) })}
          >
            {FONT_SIZES.map((size) => (
              <option value={size} key={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <span className="quoteRichDivider" aria-hidden="true" />

        <div className="quoteRichPalette" role="group" aria-label="Couleur du texte">
          <span>Couleur</span>
          {TEXT_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              className="quoteRichSwatch"
              style={{ backgroundColor: color.value }}
              disabled={!hasSelection}
              title={color.label}
              aria-label={`Couleur ${color.label}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyPatch({ textColor: color.value })}
            />
          ))}
        </div>

        <button
          type="button"
          className={highlightActive ? "isActive" : ""}
          disabled={!hasSelection}
          aria-pressed={highlightActive}
          title="Surlignage jaune"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => applyPatch({ highlightColor: highlightActive ? null : HIGHLIGHT_COLOR })}
        >
          <Highlighter size={14} aria-hidden="true" />
        </button>

        <button
          type="button"
          disabled={!hasSelection}
          title="Effacer la mise en forme de la sélection"
          onMouseDown={(event) => event.preventDefault()}
          onClick={resetSelection}
        >
          <RotateCcw size={14} aria-hidden="true" />
        </button>
      </div>

      <div
        ref={editorRef}
        className="quoteRichEditable"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline="true"
        spellCheck
        onInput={(event) => {
          const root = event.currentTarget;
          const next = readRichText(root);
          const textLength = next.runs.reduce((total, run) => total + run.text.length, 0);
          if (textLength <= maxLength) onChange(next);
          rememberSelection();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          const next = insertPlainTextAtSelection(event.currentTarget, "\n", maxLength);
          if (!next) return;
          onChange(next);
          rememberSelection();
        }}
        onPaste={(event) => {
          event.preventDefault();
          const text = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
          const next = insertPlainTextAtSelection(event.currentTarget, text, maxLength);
          if (!next) return;
          onChange(next);
          rememberSelection();
        }}
      />

      <style jsx>{`
        .quoteRichEditorShell {
          overflow: hidden;
          border: 1px solid #cfc6eb;
          border-radius: 7px;
          background: #fff;
        }
        .quoteRichToolbar {
          min-height: 36px;
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 4px;
          padding: 4px 6px;
          border-bottom: 1px solid #e7e1f5;
          background: #f8f6fd;
        }
        .quoteRichToolbar button,
        .quoteRichSize,
        .quoteRichPalette {
          min-height: 28px;
          border: 1px solid transparent;
          border-radius: 6px;
          background: transparent;
          color: #3d3650;
        }
        .quoteRichToolbar button {
          width: 30px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .quoteRichToolbar button:hover:not(:disabled),
        .quoteRichToolbar button.isActive {
          border-color: #cfc6eb;
          background: #ede9f8;
          color: #604bb5;
        }
        .quoteRichToolbar button:disabled,
        .quoteRichToolbar label:has(select:disabled) {
          opacity: 0.42;
        }
        .quoteRichDivider {
          width: 1px;
          height: 22px;
          margin: 0 3px;
          background: #ddd6ef;
        }
        .quoteRichSize,
        .quoteRichPalette {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 0 6px;
          font-size: 11px;
          font-weight: 700;
        }
        .quoteRichSize select {
          width: 56px;
          border: 0;
          outline: 0;
          background: transparent;
          font: inherit;
          color: inherit;
        }
        .quoteRichPalette .quoteRichSwatch {
          width: 20px;
          min-height: 20px;
          height: 20px;
          padding: 0;
          border: 2px solid #fff;
          border-radius: 999px;
          box-shadow: 0 0 0 1px #bcb4d7;
        }
        .quoteRichPalette .quoteRichSwatch:hover:not(:disabled) {
          border-color: #fff;
          box-shadow: 0 0 0 2px #7867bb;
        }
        .quoteRichEditable {
          min-height: 38px;
          padding: 8px 10px;
          outline: none;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          color: #111827;
          font-size: 13px;
          line-height: 1.45;
        }
        .quoteRichEditable:focus {
          box-shadow: inset 0 0 0 2px rgba(113, 88, 190, 0.12);
        }
      `}</style>
    </div>
  );
}

function rootSelection(root: HTMLElement | null): SelectionOffsets | null {
  return root ? selectionOffsets(root) : null;
}