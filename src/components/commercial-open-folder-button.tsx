"use client";

import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";

const folderErrors: Record<string, string> = {
  COMMERCIAL_CASE_NOT_FOUND: "Cette affaire n’existe plus.",
  COMMERCIAL_FOLDER_NOT_FOUND: "Le dossier physique de cette affaire n’existe pas encore.",
  DESKTOP_BUSINESS_FOLDER_INVALID: "Le dossier de cette affaire ne peut pas être ouvert.",
  DESKTOP_BUSINESS_FOLDER_ROOT_UNAVAILABLE:
    "Le stockage des documents n’est pas disponible sur ce poste.",
  DESKTOP_BUSINESS_FOLDER_NOT_FOUND: "Le dossier physique de cette affaire n’existe pas encore.",
  DESKTOP_BUSINESS_FOLDER_OPEN_FAILED: "Windows n’a pas pu ouvrir le dossier de cette affaire.",
};

export function CommercialOpenFolderButton({
  caseId,
  hasDocuments,
}: {
  caseId: string;
  createdAt: string;
  hasDocuments: boolean;
}) {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAvailable(Boolean(window.papotDesktop?.openBusinessFolder));
  }, []);

  if (!available) return null;

  async function openFolder() {
    const bridge = window.papotDesktop;
    if (!bridge?.openBusinessFolder || busy || !hasDocuments) return;

    setBusy(true);
    setError(null);
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
        setError(folderErrors[result.error] ?? folderErrors.DESKTOP_BUSINESS_FOLDER_OPEN_FAILED);
      }
    } catch (openError) {
      const code = openError instanceof Error ? openError.message : "DESKTOP_BUSINESS_FOLDER_OPEN_FAILED";
      setError(folderErrors[code] ?? folderErrors.DESKTOP_BUSINESS_FOLDER_OPEN_FAILED);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 6, justifyItems: "start" }}>
      <button
        className="secondaryButton"
        type="button"
        disabled={busy || !hasDocuments}
        title={
          hasDocuments
            ? "Ouvrir le dossier physique de l’affaire"
            : "Ajoute d’abord un document à l’affaire"
        }
        onClick={() => void openFolder()}
      >
        <FolderOpen size={14} /> {busy ? "Ouverture…" : "Ouvrir le dossier"}
      </button>
      {error ? <span className="formError">{error}</span> : null}
    </div>
  );
}
