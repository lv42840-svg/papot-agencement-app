"use client";

import { type ChangeEvent, useEffect, useState } from "react";
import { ImagePlus, Trash2, X } from "lucide-react";
import type { QuoteItem } from "@/lib/quotes/model";
import type { NativeQuotesPayload } from "@/lib/quotes/store";

type Props = {
  quoteId: string;
  item: QuoteItem;
  editable: boolean;
  onSaved: (payload: NativeQuotesPayload) => void;
  onClose: () => void;
};

type ApiResponse = { payload?: NativeQuotesPayload; error?: string };

function itemLabel(item: QuoteItem): string {
  if (item.kind === "SECTION" || item.kind === "SUBSECTION") return item.title;
  if (item.kind === "LINE") return item.description;
  return item.text;
}

export function QuoteItemPresentationPanel({ quoteId, item, editable, onSaved, onClose }: Props) {
  const [uploading, setUploading] = useState(false);
  const [busyPhotoId, setBusyPhotoId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
  }, [item]);

  async function uploadPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!editable || files.length === 0) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      const response = await fetch(`/api/desktop/quotes/${quoteId}/items/${item.id}/photos`, {
        method: "POST",
        body: form,
      });
      const data = (await response.json()) as ApiResponse;
      if (!response.ok || !data.payload) {
        throw new Error(data.error ?? "QUOTE_ITEM_PHOTO_UPLOAD_FAILED");
      }
      onSaved(data.payload);
    } catch (uploadError) {
      const code = uploadError instanceof Error ? uploadError.message : "";
      setError(
        code === "QUOTE_ITEM_PHOTO_TYPE_INVALID"
          ? "Utilise une image JPG, PNG ou WebP."
          : code === "QUOTE_ITEM_PHOTO_TOO_LARGE"
            ? "Une photo dépasse 15 Mo."
            : "La photo n’a pas pu être ajoutée.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function setPhotoVisible(photoId: string, clientVisible: boolean) {
    if (!editable || busyPhotoId) return;
    setBusyPhotoId(photoId);
    setError("");
    try {
      const response = await fetch(
        `/api/desktop/quotes/${quoteId}/items/${item.id}/photos/${photoId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientVisible }),
        },
      );
      const data = (await response.json()) as ApiResponse;
      if (!response.ok || !data.payload) throw new Error();
      onSaved(data.payload);
    } catch {
      setError("La visibilité client de la photo n’a pas pu être modifiée.");
    } finally {
      setBusyPhotoId(null);
    }
  }

  async function deletePhoto(photoId: string) {
    if (!editable || busyPhotoId || !window.confirm("Supprimer cette photo du devis ?")) return;
    setBusyPhotoId(photoId);
    setError("");
    try {
      const response = await fetch(
        `/api/desktop/quotes/${quoteId}/items/${item.id}/photos/${photoId}`,
        { method: "DELETE" },
      );
      const data = (await response.json()) as ApiResponse;
      if (!response.ok || !data.payload) throw new Error();
      onSaved(data.payload);
    } catch {
      setError("La photo n’a pas pu être supprimée.");
    } finally {
      setBusyPhotoId(null);
    }
  }

  const photos = item.presentation?.photos ?? [];
  const label = itemLabel(item);

  return (
    <div className="quotePresentationPanel">
      <div className="quotePresentationHeader">
        <div>
          <strong>Photos</strong>
          <small>{label}</small>
        </div>
        <button type="button" className="iconButton" onClick={onClose} aria-label="Fermer">
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="quotePhotosPanel">
        <div className="quotePhotosTop">
          <div>
            <strong>Photos de la ligne</strong>
            <small>
              Interne par défaut. Active « Visible client » pour l’imprimer plus tard sur le devis.
            </small>
          </div>
          {editable ? (
            <label className="quotePhotoAddButton">
              <ImagePlus size={14} aria-hidden="true" /> {uploading ? "Ajout…" : "Ajouter"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(event) => void uploadPhotos(event)}
                disabled={uploading}
              />
            </label>
          ) : null}
        </div>
        {photos.length === 0 ? (
          <div className="quotePhotosEmpty">Aucune photo sur cette ligne.</div>
        ) : (
          <div className="quotePhotoGrid">
            {photos.map((photo) => (
              <div className="quotePhotoCard" key={photo.id}>
                <img
                  src={`/api/desktop/quotes/${quoteId}/items/${item.id}/photos/${photo.id}`}
                  alt={photo.fileName}
                />
                <div className="quotePhotoMeta">
                  <strong title={photo.fileName}>{photo.fileName}</strong>
                  <label>
                    <input
                      type="checkbox"
                      checked={photo.clientVisible}
                      onChange={(event) => void setPhotoVisible(photo.id, event.target.checked)}
                      disabled={!editable || busyPhotoId === photo.id}
                    />
                    Visible client
                  </label>
                </div>
                {editable ? (
                  <button
                    type="button"
                    className="quotePhotoDelete"
                    onClick={() => void deletePhoto(photo.id)}
                    disabled={busyPhotoId === photo.id}
                    aria-label={`Supprimer ${photo.fileName}`}
                    title="Supprimer la photo"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
      {error ? <div className="quotePresentationError">{error}</div> : null}
    </div>
  );
}
