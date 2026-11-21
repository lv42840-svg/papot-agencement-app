"use client";

import { useState } from "react";
import { FlaskConical } from "lucide-react";

/**
 * Only metadata marking. Never removes or mutates linked business records.
 * Cleanup is a separate audited operation, not exposed by this control.
 */
export function TestDataMarker({
  isTest,
  disabled,
  onToggle,
}: {
  isTest: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function toggle() {
    if (disabled || busy) return;
    if (
      !isTest &&
      !window.confirm(
        "Marquer ce dossier comme TEST ? Il restera enregistré, et ce marquage ne supprimera rien. " +
          "Vérifie qu'il ne s'agit pas d'un vrai dossier client.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const changed = await onToggle(!isTest);
      if (!changed) setError("Le marquage n'a pas été enregistré.");
    } catch {
      setError("Le marquage n'a pas été enregistré.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="testDataMarker">
      {isTest && (
        <span className="testDataBadge" aria-label="Donnée de test">
          <FlaskConical size={14} aria-hidden="true" /> TEST
        </span>
      )}
      {!disabled && (
        <button
          className="secondaryButton testDataMarkerButton"
          type="button"
          disabled={busy}
          onClick={() => void toggle()}
        >
          {isTest ? "Retirer le marquage TEST" : "Marquer comme donnée TEST"}
        </button>
      )}
      {error && (
        <span role="alert" className="testDataMarkerError">
          {error}
        </span>
      )}
    </div>
  );
}
