"use client";

import { type ChangeEvent, useEffect, useState } from "react";
import { Bold, Check, ImagePlus, Italic, RotateCcw, Trash2, X } from "lucide-react";
import type { QuoteItem, QuoteItemTextStyle } from "@/lib/quotes/model";
import {
  defaultQuoteItemTextStyle,
  QUOTE_FONT_FAMILY_OPTIONS,
  quoteItemTextStyleToCss,
} from "@/lib/quotes/presentation";
import type { NativeQuotesPayload } from "@/lib/quotes/store";

type Props = {
  quoteId: string;
  item: QuoteItem;
  editable: boolean;
  onSaved: (payload: NativeQuotesPayload) => void;
  onClose: () => void;
};

type ApiResponse = { payload?: NativeQuotesPayload; error?: string };

const TEXT_COLOR_PRESETS = [
  { label: "Noir", value: "#111827" },
  { label: "Gris", value: "#475569" },
  { label: "Lavande", value: "#6554b5" },
  { label: "Bleu", value: "#2563eb" },
  { label: "Vert", value: "#15803d" },
  { label: "Rouge", value: "#b91c1c" },
  { label: "Orange", value: "#c2410c" },
  { label: "Brun", value: "#7c2d12" },
] as const;

const HIGHLIGHT_COLOR_PRESETS = [
  { label: "Jaune", value: "#fff2a8" },
  { label: "Lavande", value: "#ede9fe" },
  { label: "Bleu", value: "#dbeafe" },
  { label: "Vert", value: "#dcfce7" },
  { label: "Rose", value: "#fce7f3" },
  { label: "Orange", value: "#ffedd5" },
  { label: "Gris", value: "#e2e8f0" },
] as const;

function itemLabel(item: QuoteItem): string {
  if (item.kind === "SECTION" || item.kind === "SUBSECTION") return item.title;
  if (item.kind === "LINE") return item.description;
  return item.text;
}

export function QuoteItemPresentationPanel({ quoteId, item, editable, onSaved, onClose }: Props) {
  const [style, setStyle] = useState<QuoteItemTextStyle>(
    item.presentation?.textStyle ?? defaultQuoteItemTextStyle(item),
  );
  const [savingStyle, setSavingStyle] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyPhotoId, setBusyPhotoId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setStyle(item.presentation?.textStyle ?? defaultQuoteItemTextStyle(item));
    setError("");
  }, [item]);

  async function saveStyle(nextStyle: QuoteItemTextStyle | null) {
    if (!editable || savingStyle) return;
    setSavingStyle(true);
    setError("");
    try {
      const response = await fetch("/api/desktop/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateItemPresentation",
          quoteId,
          itemId: item.id,
          textStyle: nextStyle,
        }),
      });
      const data = (await response.json()) as ApiResponse;
      if (!response.ok || !data.payload)
        throw new Error(data.error ?? "QUOTE_PRESENTATION_SAVE_FAILED");
      onSaved(data.payload);
      if (nextStyle === null) setStyle(defaultQuoteItemTextStyle(item));
    } catch {
      setError("La mise en forme n’a pas pu être enregistrée.");
    } finally {
      setSavingStyle(false);
    }
  }

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
      if (!response.ok || !data.payload)
        throw new Error(data.error ?? "QUOTE_ITEM_PHOTO_UPLOAD_FAILED");
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
  const legacyTextColor = TEXT_COLOR_PRESETS.some((preset) => preset.value === style.textColor)
    ? null
    : style.textColor;
  const legacyHighlightColor =
    style.highlightColor &&
    !HIGHLIGHT_COLOR_PRESETS.some((preset) => preset.value === style.highlightColor)
      ? style.highlightColor
      : null;

  return (
    <div className="quotePresentationPanel">
      <div className="quotePresentationHeader">
        <div>
          <strong>Mise en forme et photos client</strong>
          <small>{label}</small>
        </div>
        <button type="button" className="iconButton" onClick={onClose} aria-label="Fermer">
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="quoteStyleEditor">
        <label>
          Police
          <select
            value={style.fontFamily}
            onChange={(event) =>
              setStyle((current) => ({
                ...current,
                fontFamily: event.target.value as QuoteItemTextStyle["fontFamily"],
              }))
            }
            disabled={!editable}
          >
            {QUOTE_FONT_FAMILY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Taille
          <select
            value={style.fontSizePx}
            onChange={(event) =>
              setStyle((current) => ({ ...current, fontSizePx: Number(event.target.value) }))
            }
            disabled={!editable}
          >
            {[10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40].map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
        </label>
        <label className="quoteColorControl">
          Couleur
          <select
            value={style.textColor}
            onChange={(event) =>
              setStyle((current) => ({ ...current, textColor: event.target.value }))
            }
            disabled={!editable}
          >
            {legacyTextColor ? <option value={legacyTextColor}>Couleur existante</option> : null}
            {TEXT_COLOR_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <label className="quoteHighlightControl">
          Surligneur
          <select
            value={style.highlightColor ?? ""}
            onChange={(event) =>
              setStyle((current) => ({
                ...current,
                highlightColor: event.target.value || null,
              }))
            }
            disabled={!editable}
          >
            <option value="">Aucun</option>
            {legacyHighlightColor ? (
              <option value={legacyHighlightColor}>Couleur existante</option>
            ) : null}
            {HIGHLIGHT_COLOR_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <div className="quoteStyleToggles">
          <button
            type="button"
            className={style.bold ? "isActive" : ""}
            onClick={() => setStyle((current) => ({ ...current, bold: !current.bold }))}
            disabled={!editable}
            title="Gras"
          >
            <Bold size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={style.italic ? "isActive" : ""}
            onClick={() => setStyle((current) => ({ ...current, italic: !current.italic }))}
            disabled={!editable}
            title="Italique"
          >
            <Italic size={14} aria-hidden="true" />
          </button>
        </div>
        <div className="quoteStylePreview" style={quoteItemTextStyleToCss(style)}>
          Aperçu client
        </div>
        {editable ? (
          <div className="quoteStyleActions">
            <button type="button" onClick={() => void saveStyle(style)} disabled={savingStyle}>
              <Check size={13} aria-hidden="true" /> Enregistrer
            </button>
            <button type="button" onClick={() => void saveStyle(null)} disabled={savingStyle}>
              <RotateCcw size={13} aria-hidden="true" /> Style par défaut
            </button>
          </div>
        ) : null}
      </div>

      <div className="quotePhotosPanel">
        <div className="quotePhotosTop">
          <div>
            <strong>Photos</strong>
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
