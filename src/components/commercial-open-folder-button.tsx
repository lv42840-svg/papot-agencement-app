"use client";

import { Eye, FolderOpen, Minus, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  COMMERCIAL_DOCUMENT_PREVIEW_DEFAULT_HEIGHT,
  canPreviewCommercialDocument,
  clampCommercialDocumentPreviewHeight,
} from "@/lib/commercial/document-preview";
import type { CommercialDocument } from "@/lib/commercial/domain";

const HEIGHT_STEP = 80;
const KEYBOARD_STEP = 40;

const folderErrors: Record<string, string> = {
  COMMERCIAL_CASE_NOT_FOUND: "Cette affaire n’existe plus.",
  COMMERCIAL_FOLDER_NOT_FOUND: "Le dossier physique de cette affaire n’existe pas encore.",
  DESKTOP_BUSINESS_FOLDER_INVALID: "Le dossier de cette affaire ne peut pas être ouvert.",
  DESKTOP_BUSINESS_FOLDER_ROOT_UNAVAILABLE:
    "Le stockage des documents n’est pas disponible sur ce poste.",
  DESKTOP_BUSINESS_FOLDER_NOT_FOUND: "Le dossier physique de cette affaire n’existe pas encore.",
  DESKTOP_BUSINESS_FOLDER_OPEN_FAILED: "Windows n’a pas pu ouvrir le dossier de cette affaire.",
};

type CommercialDocumentsSnapshot = {
  payload?: {
    cases?: Array<{
      id: string;
      documents: CommercialDocument[];
    }>;
  };
  error?: string;
};

export function CommercialOpenFolderButton({
  caseId,
  hasDocuments,
}: {
  caseId: string;
  createdAt: string;
  hasDocuments: boolean;
}) {
  const [folderAvailable, setFolderAvailable] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerBusy, setViewerBusy] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<CommercialDocument[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [height, setHeight] = useState(COMMERCIAL_DOCUMENT_PREVIEW_DEFAULT_HEIGHT);
  const dragState = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);

  const previewableDocuments = useMemo(
    () => documents.filter(canPreviewCommercialDocument),
    [documents],
  );
  const selectedDocument =
    previewableDocuments.find((document) => document.id === selectedDocumentId) ??
    previewableDocuments[0] ??
    null;

  useEffect(() => {
    setFolderAvailable(Boolean(window.papotDesktop?.openBusinessFolder));
  }, []);

  useEffect(() => {
    setViewerOpen(false);
    setViewerError(null);
    setDocuments([]);
    setSelectedDocumentId(null);
    setHeight(COMMERCIAL_DOCUMENT_PREVIEW_DEFAULT_HEIGHT);
  }, [caseId]);

  async function openFolder() {
    const bridge = window.papotDesktop;
    if (!bridge?.openBusinessFolder || folderBusy || !hasDocuments) return;

    setFolderBusy(true);
    setFolderError(null);
    try {
      const response = await fetch(`/api/desktop/commercial/${caseId}/folder`, {
        cache: "no-store",
      });
      const body = (await response.json()) as { storagePath?: string; error?: string };
      if (!response.ok || !body.storagePath) {
        throw new Error(body.error ?? "COMMERCIAL_FOLDER_NOT_FOUND");
      }

      const result = await bridge.openBusinessFolder({
        kind: "commercial-case",
        storagePath: body.storagePath,
      });
      if (!result.ok) {
        setFolderError(
          folderErrors[result.error] ?? folderErrors.DESKTOP_BUSINESS_FOLDER_OPEN_FAILED,
        );
      }
    } catch (openError) {
      const code =
        openError instanceof Error ? openError.message : "DESKTOP_BUSINESS_FOLDER_OPEN_FAILED";
      setFolderError(folderErrors[code] ?? folderErrors.DESKTOP_BUSINESS_FOLDER_OPEN_FAILED);
    } finally {
      setFolderBusy(false);
    }
  }

  async function toggleViewer() {
    if (viewerOpen) {
      setViewerOpen(false);
      return;
    }
    if (!hasDocuments) return;

    if (documents.length) {
      setViewerOpen(true);
      return;
    }

    setViewerBusy(true);
    setViewerError(null);
    try {
      const response = await fetch("/api/desktop/commercial", { cache: "no-store" });
      const body = (await response.json()) as CommercialDocumentsSnapshot;
      if (!response.ok) throw new Error(body.error ?? "COMMERCIAL_LOAD_FAILED");
      const item = body.payload?.cases?.find((candidate) => candidate.id === caseId);
      if (!item) throw new Error("COMMERCIAL_CASE_NOT_FOUND");

      const nextDocuments = item.documents ?? [];
      const firstPreviewable = nextDocuments.find(canPreviewCommercialDocument) ?? null;
      setDocuments(nextDocuments);
      setSelectedDocumentId(firstPreviewable?.id ?? null);
      setViewerOpen(true);
      if (!firstPreviewable) {
        setViewerError("Aucun PDF ou image à visualiser dans cette affaire.");
      }
    } catch {
      setViewerError("Impossible de charger les documents à visualiser.");
      setViewerOpen(true);
    } finally {
      setViewerBusy(false);
    }
  }

  function adjustHeight(delta: number) {
    setHeight((current) => clampCommercialDocumentPreviewHeight(current + delta));
  }

  const previewSource = selectedDocument
    ? `/api/desktop/affaires/${caseId}/documents/${selectedDocument.id}`
    : null;

  return (
    <div className="commercialDocumentTools">
      <div className="commercialDocumentToolActions">
        {folderAvailable ? (
          <button
            className="secondaryButton"
            type="button"
            disabled={folderBusy || !hasDocuments}
            title={
              hasDocuments
                ? "Ouvrir le dossier physique de l’affaire"
                : "Ajoute d’abord un document à l’affaire"
            }
            onClick={() => void openFolder()}
          >
            <FolderOpen size={14} /> {folderBusy ? "Ouverture…" : "Ouvrir le dossier"}
          </button>
        ) : null}
        <button
          className="secondaryButton"
          type="button"
          disabled={viewerBusy || !hasDocuments}
          title={hasDocuments ? "Visualiser un PDF ou une image" : "Ajoute d’abord un document"}
          onClick={() => void toggleViewer()}
        >
          <Eye size={14} /> {viewerBusy ? "Chargement…" : viewerOpen ? "Masquer" : "Visualiser"}
        </button>
      </div>

      {folderError ? <span className="formError">{folderError}</span> : null}

      {viewerOpen ? (
        <section className="commercialDocumentPreview" aria-label="Visualiseur de documents">
          <header>
            <label>
              <span>Document</span>
              <select
                value={selectedDocument?.id ?? ""}
                disabled={!previewableDocuments.length}
                onChange={(event) => {
                  setSelectedDocumentId(event.target.value || null);
                  setViewerError(null);
                }}
              >
                {previewableDocuments.length ? (
                  previewableDocuments.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.fileName}
                    </option>
                  ))
                ) : (
                  <option value="">Aucun PDF ou image</option>
                )}
              </select>
            </label>
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
                title="Fermer le visualiseur"
                aria-label="Fermer le visualiseur"
                onClick={() => setViewerOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
          </header>

          {viewerError ? <div className="commercialDocumentPreviewEmpty">{viewerError}</div> : null}
          {previewSource && !viewerError ? (
            <div className="commercialDocumentPreviewFrame" style={{ height }}>
              <iframe
                src={previewSource}
                title={`Aperçu de ${selectedDocument?.fileName ?? "document"}`}
              />
            </div>
          ) : null}

          {previewSource && !viewerError ? (
            <div
              className="commercialDocumentPreviewResize"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Redimensionner la hauteur du visualiseur"
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
          ) : null}
        </section>
      ) : null}

      <style jsx>{`
        .commercialDocumentTools {
          width: 100%;
          display: grid;
          gap: 7px;
        }
        .commercialDocumentToolActions {
          display: flex;
          align-items: center;
          gap: 7px;
          flex-wrap: wrap;
        }
        .commercialDocumentPreview {
          width: 100%;
          display: grid;
          overflow: hidden;
          border: 1px solid #ddd7e8;
          border-radius: 10px;
          background: #f7f5fa;
        }
        .commercialDocumentPreview header {
          min-width: 0;
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 10px;
          padding: 8px 10px;
          border-bottom: 1px solid #e5e0ea;
          background: white;
        }
        .commercialDocumentPreview label {
          min-width: 0;
          flex: 1;
          display: grid;
          gap: 3px;
          color: #625d68;
          font-size: 9px;
          font-weight: 750;
        }
        .commercialDocumentPreview select {
          width: 100%;
          min-height: 34px;
          padding: 6px 8px;
          border: 1px solid #ddd8e5;
          border-radius: 8px;
          background: white;
          color: var(--text);
          font: inherit;
        }
        .commercialDocumentPreviewActions {
          display: flex;
          align-items: center;
          gap: 5px;
          flex: 0 0 auto;
        }
        .commercialDocumentPreviewActions button {
          min-width: 32px;
          min-height: 32px;
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
        .commercialDocumentPreviewEmpty {
          min-height: 120px;
          display: grid;
          place-items: center;
          padding: 18px;
          color: #81798b;
          font-size: 10px;
          text-align: center;
        }
        .commercialDocumentPreviewResize {
          min-height: 30px;
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
          width: 28px;
          height: 3px;
          border-radius: 999px;
          background: #c8c0d2;
        }
        .commercialDocumentPreviewResize small {
          font-size: 8px;
        }
        @media (max-width: 620px) {
          .commercialDocumentPreview header {
            align-items: stretch;
            flex-direction: column;
          }
          .commercialDocumentPreviewActions {
            justify-content: flex-end;
          }
        }
      `}</style>
    </div>
  );
}
