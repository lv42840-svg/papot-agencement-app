"use client";

import { ExternalLink, Eye, FolderOpen } from "lucide-react";
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

  useEffect(() => {
    setFolderAvailable(Boolean(window.papotDesktop?.openBusinessFolder));
  }, []);

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

  if (!folderAvailable) return null;

  return (
    <div className="commercialDocumentFolderAction">
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
      {folderError ? <span className="formError">{folderError}</span> : null}

      <style jsx>{`
        .commercialDocumentFolderAction {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
      `}</style>
    </div>
  );
}

export function CommercialDocumentActions({
  document,
  previewOpen,
  onTogglePreview,
}: {
  caseId: string;
  document: CommercialDocument;
  previewOpen: boolean;
  onTogglePreview: () => void;
}) {
  const [fileOpenAvailable, setFileOpenAvailable] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const previewable = canPreviewCommercialDocument(document);

  useEffect(() => {
    setFileOpenAvailable(Boolean(window.papotDesktop?.openBusinessFile));
  }, []);

  async function openDocument() {
    const bridge = window.papotDesktop;
    if (!bridge?.openBusinessFile || fileBusy) return;

    setFileBusy(true);
    setFileError(null);
    try {
      const result = await bridge.openBusinessFile({
        kind: "commercial-document",
        storagePath: document.storagePath,
      });
      if (!result.ok) {
        setFileError(fileErrors[result.error] ?? fileErrors.DESKTOP_BUSINESS_FILE_OPEN_FAILED);
      }
    } finally {
      setFileBusy(false);
    }
  }

  return (
    <div className="commercialDocumentRowActions">
      <div>
        {previewable ? (
          <button
            className="secondaryButton"
            type="button"
            title="Prévisualiser ce document dans PAPOT"
            aria-pressed={previewOpen}
            onClick={onTogglePreview}
          >
            <Eye size={13} /> {previewOpen ? "Masquer" : "Visualiser"}
          </button>
        ) : null}
        {fileOpenAvailable ? (
          <button
            className="secondaryButton"
            type="button"
            disabled={fileBusy}
            title="Ouvrir le fichier original avec le logiciel Windows par défaut"
            onClick={() => void openDocument()}
          >
            <ExternalLink size={13} /> {fileBusy ? "Ouverture…" : "Ouvrir"}
          </button>
        ) : null}
      </div>
      {fileError ? <small>{fileError}</small> : null}

      <style jsx>{`
        .commercialDocumentRowActions {
          min-width: max-content;
          display: grid;
          justify-items: end;
          gap: 4px;
        }
        .commercialDocumentRowActions > div {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 5px;
        }
        .commercialDocumentRowActions button {
          min-height: 30px;
          padding: 5px 8px;
          font-size: 8px;
        }
        .commercialDocumentRowActions small {
          max-width: 260px;
          color: #9d4438;
          font-size: 8px;
          text-align: right;
        }
        @media (max-width: 700px) {
          .commercialDocumentRowActions {
            width: 100%;
            justify-items: stretch;
          }
          .commercialDocumentRowActions > div {
            justify-content: flex-start;
            flex-wrap: wrap;
          }
          .commercialDocumentRowActions small {
            max-width: none;
            text-align: left;
          }
        }
      `}</style>
    </div>
  );
}
