"use client";

import { Minus, Plus, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import {
  COMMERCIAL_DOCUMENT_PREVIEW_DEFAULT_HEIGHT,
  canPreviewCommercialDocument,
  clampCommercialDocumentPreviewHeight,
} from "@/lib/commercial/document-preview";
import type { CommercialDocument } from "@/lib/commercial/domain";

const HEIGHT_STEP = 80;
const KEYBOARD_STEP = 40;

export function CommercialDocumentActions({
  caseId,
  document,
  downloadIcon,
}: {
  caseId: string;
  document: CommercialDocument;
  downloadIcon: ReactNode;
}) {
  const previewable = canPreviewCommercialDocument(document);
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState(COMMERCIAL_DOCUMENT_PREVIEW_DEFAULT_HEIGHT);
  const dragState = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);
  const source = `/api/desktop/affaires/${caseId}/documents/${document.id}`;

  function adjustHeight(delta: number) {
    setHeight((current) => clampCommercialDocumentPreviewHeight(current + delta));
  }

  return (
    <>
      <div className="commercialDocumentActions">
        {previewable ? (
          <button className="secondaryButton" type="button" onClick={() => setOpen((value) => !value)}>
            {open ? "Masquer" : "Visualiser"}
          </button>
        ) : null}
        <a className="secondaryButton" href={`${source}?download=1`}>
          {downloadIcon} Télécharger
        </a>
      </div>
      {open ? (
        <section
          className="commercialDocumentPreview"
          style={{ gridColumn: "1 / -1" }}
          aria-label={`Aperçu de ${document.fileName}`}
        >
          <header>
            <div>
              <span>Aperçu</span>
              <strong>{document.fileName}</strong>
            </div>
            <div className="commercialDocumentPreviewActions">
              <button
                type="button"
                className="secondaryButton"
                title="Réduire la hauteur"
                aria-label="Réduire la hauteur de l’aperçu"
                onClick={() => adjustHeight(-HEIGHT_STEP)}
              >
                <Minus size={14} />
              </button>
              <button
                type="button"
                className="secondaryButton"
                title="Augmenter la hauteur"
                aria-label="Augmenter la hauteur de l’aperçu"
                onClick={() => adjustHeight(HEIGHT_STEP)}
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                className="secondaryButton"
                title="Fermer l’aperçu"
                aria-label="Fermer l’aperçu"
                onClick={() => setOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
          </header>
          <div className="commercialDocumentPreviewFrame" style={{ height }}>
            <iframe src={source} title={`Aperçu de ${document.fileName}`} />
          </div>
          <div
            className="commercialDocumentPreviewResize"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Redimensionner la hauteur de l’aperçu"
            tabIndex={0}
            onPointerDown={(event) => {
              dragState.current = {
                pointerId: event.pointerId,
                startY: event.clientY,
                startHeight: height,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const drag = dragState.current;
              if (!drag || drag.pointerId !== event.pointerId) return;
              setHeight(
                clampCommercialDocumentPreviewHeight(
                  drag.startHeight + (event.clientY - drag.startY),
                ),
              );
            }}
            onPointerUp={(event) => {
              if (dragState.current?.pointerId !== event.pointerId) return;
              dragState.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onLostPointerCapture={() => {
              dragState.current = null;
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") {
                event.preventDefault();
                adjustHeight(-KEYBOARD_STEP);
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                adjustHeight(KEYBOARD_STEP);
              }
            }}
          >
            <span aria-hidden="true" />
            <small>↕ Glisser pour régler la hauteur</small>
          </div>
        </section>
      ) : null}
      <style jsx>{`
        .commercialDocumentActions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
          flex-wrap: wrap;
        }
        .commercialDocumentActions button,
        .commercialDocumentActions a {
          min-height: 30px;
          font-size: 8px;
        }
        .commercialDocumentPreview {
          display: grid;
          overflow: hidden;
          margin-top: 4px;
          border: 1px solid #ddd7e8;
          border-radius: 10px;
          background: #f7f5fa;
        }
        .commercialDocumentPreview header {
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 8px 10px;
          border-bottom: 1px solid #e5e0ea;
          background: white;
        }
        .commercialDocumentPreview header > div:first-child {
          min-width: 0;
          display: grid;
          gap: 1px;
        }
        .commercialDocumentPreview header span {
          color: #8a8294;
          font-size: 8px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .commercialDocumentPreview header strong {
          overflow: hidden;
          color: #4f4957;
          font-size: 10px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .commercialDocumentPreviewActions {
          display: flex;
          align-items: center;
          gap: 5px;
          flex: 0 0 auto;
        }
        .commercialDocumentPreviewActions button {
          min-width: 32px;
          min-height: 30px;
          padding: 5px 7px;
        }
        .commercialDocumentPreviewFrame {
          min-height: 220px;
          max-height: 900px;
          background: #ebe8ef;
        }
        .commercialDocumentPreviewFrame iframe {
          width: 100%;
          height: 100%;
          display: block;
          border: 0;
          background: white;
        }
        .commercialDocumentPreviewResize {
          min-height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          border-top: 1px solid #e2dce8;
          background: white;
          color: #81778e;
          cursor: ns-resize;
          user-select: none;
          touch-action: none;
          outline: 0;
        }
        .commercialDocumentPreviewResize:focus-visible {
          box-shadow: inset 0 0 0 2px #8f80dd;
        }
        .commercialDocumentPreviewResize > span {
          width: 26px;
          height: 3px;
          border-radius: 999px;
          background: #c8c0d2;
        }
        .commercialDocumentPreviewResize small {
          font-size: 8px;
        }
      `}</style>
    </>
  );
}
