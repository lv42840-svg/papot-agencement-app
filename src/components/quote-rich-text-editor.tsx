"use client";

import { Bold, Highlighter, Italic, RotateCcw, Underline } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { QuoteRichText, QuoteRichTextRunStyle } from "@/lib/quotes/model";
import {
  applyQuoteRichTextStyle,
  EMPTY_QUOTE_RICH_TEXT_STYLE,
  normalizeQuoteRichText,
  quoteRichTextHasUniformBooleanStyle,
} from "@/lib/quotes/rich-text";

type SelectionOffsets = { start: number; end: number };

type Props = {
  value: QuoteRichText;
  onChange: (value: QuoteRichText) => void;
  ariaLabel: string;
  maxLength: number;
};

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40];

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
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
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
    if (offset <= cursor + length) return { node, offset: Math.max(0, offset - cursor) };
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

export function QuoteRichTextEditor({ value, onChange, ariaLabel, maxLength }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<SelectionOffsets>({ start: 0, end: 0 });
  const [selection, setSelection] = useState<SelectionOffsets>({ start: 0, end: 0 });

  useEffect(() => {
    const root = editorRef.current;
    if (!root || root.ownerDocument.activeElement === root) return;
    renderRichText(root, value);
  }, [value]);

  useEffect(() => {
    const root = editorRef.current;
    if (!root) return;
    renderRichText(root, value);
  }, []);

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
  const boldActive = hasSelection && quoteRichTextHasUniformBooleanStyle(current, selection.start, selection.end, "bold");
  const italicActive = hasSelection && quoteRichTextHasUniformBooleanStyle(current, selection.start, selection.end, "italic");
  const underlineActive = hasSelection && quoteRichTextHasUniformBooleanStyle(current, selection.start, selection.end, "underline");

  return (
    <div className="quoteRichEditorShell">
      <div className="quoteRichToolbar" role="toolbar" aria-label="Mise en forme du texte sélectionné">
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

        <label className="quoteRichColor" title="Couleur du texte">
          <span>A</span>
          <input
            type="color"
            defaultValue="#111827"
            disabled={!hasSelection}
            onPointerDown={rememberSelection}
            onChange={(event) => applyPatch({ textColor: event.target.value })}
            aria-label="Couleur du texte"
          />
        </label>

        <label className="quoteRichColor" title="Surlignage">
          <Highlighter size={14} aria-hidden="true" />
          <input
            type="color"
            defaultValue="#fff2a8"
            disabled={!hasSelection}
            onPointerDown={rememberSelection}
            onChange={(event) => applyPatch({ highlightColor: event.target.value })}
            aria-label="Couleur de surlignage"
          />
        </label>

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
        aria-multiline="false"
        spellCheck
        onInput={(event) => {
          const root = event.currentTarget;
          const next = readRichText(root);
          const textLength = next.runs.reduce((total, run) => total + run.text.length, 0);
          if (textLength <= maxLength) onChange(next);
          rememberSelection();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
        onPaste={(event) => {
          event.preventDefault();
          const text = event.clipboardData.getData("text/plain").replace(/[\r\n]+/g, " ");
          const selection = rootSelection(editorRef.current);
          if (!selection || !editorRef.current) return;
          const currentRichText = readRichText(editorRef.current);
          const plain = currentRichText.runs.map((run) => run.text).join("");
          if (plain.length - (selection.end - selection.start) + text.length > maxLength) return;
          const range = editorRef.current.ownerDocument.defaultView?.getSelection()?.getRangeAt(0);
          if (!range) return;
          range.deleteContents();
          range.insertNode(editorRef.current.ownerDocument.createTextNode(text));
          onChange(readRichText(editorRef.current));
          rememberSelection();
        }}
      />

      <style jsx>{`
        .quoteRichEditorShell {
          overflow: hidden;
          border: 1px solid #cfc6eb;
          border-radius: 9px;
          background: #fff;
          box-shadow: 0 12px 30px rgba(58, 45, 105, 0.13);
        }
        .quoteRichToolbar {
          min-height: 38px;
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 5px 7px;
          border-bottom: 1px solid #e7e1f5;
          background: #f8f6fd;
        }
        .quoteRichToolbar button,
        .quoteRichSize,
        .quoteRichColor {
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
        .quoteRichToolbar label:has(input:disabled),
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
        .quoteRichColor {
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
        .quoteRichColor input {
          width: 23px;
          height: 20px;
          padding: 0;
          border: 0;
          background: transparent;
          cursor: pointer;
        }
        .quoteRichEditable {
          min-height: 42px;
          padding: 10px 12px;
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
