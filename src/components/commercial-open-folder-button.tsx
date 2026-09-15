"use client";

import { ExternalLink, Eye, FolderOpen, X } from "lucide-react";
import { useEffect, useState } from "react";
import { canPreviewCommercialDocument } from "@/lib/commercial/document-preview";
import type { CommercialDocument } from "@/lib/commercial/domain";

const folderErrors: Record<string, string> = {
  COMMERCIAL_CASE_NOT_FOUND: "Cette affaire n’existe plus.",
  COMMERCIAL_FOLDER_NOT_FOUND: "Le dossier physique de cette affaire n’existe pas encore.",
  DESKTOP_BUSINESS_FOLDER_INVALID: "Le dossier de cette affaire ne peut pas être ouvert.",
  DESKTOP_BUSINESS_FOLDER_ROOT_UNAVAILABLE:
    "Le stockage des documents n’est pas disponible sur ce poste.",
  DESKTOP_BUSINESS_FOLDER_NOT_FOUND: "Le dossier physique de cette affaire n’existe pas encore.",
  DESKTOP_BUSINESS_FOLDER_OPEN_FAILED: "Windows n’a pas pu ouvrir le dossier de cette affaire.",
};

const fileErrors: Record<string, string> = {
  DESKTOP_BUSINESS_FILE_INVALID: "Ce document ne peut pas être ouvert.",
  DESKTOP_BUSINESS_FILE_ROOT_UNAVAILABLE:
    "Le stockage des documents n’est pas disponible sur ce poste.",
  DESKTOP_BUSINESS_FILE_NOT_FOUND: "Le fichier n’existe plus à son emplacement enregistré.",
  DESKTOP_BUSINESS_FILE_OPEN_FAILED: "Windows n’a pas pu ouvrir ce document.",
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
  const [fileOpenAvailable, setFileOpenAvailable] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerBusy, setViewerBusy] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<CommercialDocument[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);

  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ?? documents[0] ?? null;
  const previewable = selectedDocument ? canPreviewCommercialDocument(selectedDocument) : false;
  const previewSource =
    selectedDocument && previewable
      ? `/api/desktop/affaires/${caseId}/documents/${selectedDocument.id}`
      : null;

  useEffect(() => {
    setFolderAvailable(Boolean(window.papotDesktop?.openBusinessFolder));
    setFileOpenAvailable(Boolean(window.papotDesktop?.openBusinessFile));
  }, []);

  useEffect(() => {
    setViewerOpen(false);
    setViewerError(null);
    setFileError(null);
    setDocuments([]);
    setSelectedDocumentId(null);
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

  async function openSelectedDocument() {
    const bridge = window.papotDesktop;
    if (!bridge?.openBusinessFile || !selectedDocument || fileBusy) return;

    setFileBusy(true);
    setFileError(null);
    try {
      const result = await bridge.openBusinessFile({
        kind: "commercial-document",
        storagePath: selectedDocument.storagePath,
      });
      if (!result.ok) {
        setFileError(fileErrors[result.error] ?? fileErrors.DESKTOP_BUSINESS_FILE_OPEN_FAILED);
      }
    } finally {
      setFileBusy(false);
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
      const firstDocument =
        nextDocuments.find(canPreviewCommercialDocument) ?? nextDocuments[0] ?? null;
      setDocuments(nextDocuments);
      setSelectedDocumentId(firstDocument?.id ?? null);
      setViewerOpen(true);
      if (!nextDocuments.length) setViewerError("Aucun document dans cette affaire.");
    } catch {
      setViewerError("Impossible de charger les documents à visualiser.");
      setViewerOpen(true);
    } finally {
      setViewerBusy(false);
    }
  }

  return (
    <div className={`commercialDocumentTools${fileOpenAvailable ? " fileOpenAvailable" : ""}`}>
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
          title={hasDocuments ? "Visualiser ou ouvrir un document" : "Ajoute d’abord un document"}
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
                disabled={!documents.length}
                onChange={(event) => {
                  setSelectedDocumentId(event.target.value || null);
                  setViewerError(null);
                  setFileError(null);
                }}
              >
                {documents.length ? (
                  documents.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.fileName}
                    </option>
                  ))
                ) : (
                  <option value="">Aucun document</option>
                )}
              </select>
            </label>
            <div className="commercialDocumentPreviewActions">
              {fileOpenAvailable && selectedDocument ? (
                <button
                  type="button"
                  className="secondaryButton commercialDocumentOpenButton"
                  disabled={fileBusy}
                  title="Ouvrir le fichier original avec le logiciel Windows par défaut"
                  onClick={() => void openSelectedDocument()}
                >
                  <ExternalLink size={14} /> {fileBusy ? "Ouverture…" : "Ouvrir"}
                </button>
              ) : null}
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
          {fileError ? <div className="commercialDocumentPreviewError">{fileError}</div> : null}
          {!viewerError && selectedDocument && !previewable ? (
            <div className="commercialDocumentPreviewEmpty">
              Ce format ne se prévisualise pas dans PAPOT. Utilise Ouvrir pour lancer directement le
              fichier original.
            </div>
          ) : null}
          {previewSource && !viewerError ? (
            <>
              <div className="commercialDocumentPreviewFrame">
                <iframe
                  src={previewSource}
                  title={`Aperçu de ${selectedDocument?.fileName ?? "document"}`}
                />
              </div>
              <small className="commercialDocumentPreviewHint">
                ↕ Tire le bord inférieur de l’aperçu pour régler sa hauteur.
              </small>
            </>
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
        .commercialDocumentPreviewActions .commercialDocumentOpenButton {
          padding-inline: 9px;
        }
        .commercialDocumentPreviewFrame {
          height: 460px;
          min-height: 220px;
          max-height: 900px;
          overflow: auto;
          resize: vertical;
          background: #ebe8ef;
        }
        .commercialDocumentPreviewFrame iframe {
          width: 100%;
          height: 100%;
          display: block;
          border: 0;
          background: white;
        }
        .commercialDocumentPreviewHint {
          padding: 6px 10px;
          border-top: 1px solid #e2dce8;
          background: white;
          color: #81778e;
          font-size: 8px;
          text-align: center;
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
        .commercialDocumentPreviewError {
          padding: 8px 10px;
          border-bottom: 1px solid #efc6bf;
          background: #fff1ef;
          color: #9d4438;
          font-size: 9px;
        }
        @media (max-width: 620px) {
          .commercialDocumentPreview header {
            align-items: stretch;
            flex-direction: column;
          }
          .commercialDocumentPreviewActions {
            justify-content: flex-end;
            flex-wrap: wrap;
          }
        }
      `}</style>
      <style jsx global>{`
        .commercialDocumentTools.fileOpenAvailable ~ .commercialV2Docs a[href*="?download=1"] {
          display: none;
        }
      `}</style>
    </div>
  );
}
