"use client";

import { useState } from "react";
import { accentPalette, type AccentKey } from "@/lib/theme/palette";

export function AccentPicker({ initialAccent }: { initialAccent: string }) {
  const [accent, setAccent] = useState<AccentKey>(
    initialAccent in accentPalette ? (initialAccent as AccentKey) : "lavender",
  );
  const [busy, setBusy] = useState(false);

  async function choose(suivant: AccentKey) {
    if (busy || suivant === accent) return;
    setBusy(true);
    const reponse = await fetch("/api/me/accent", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accentKey: suivant }),
    });
    if (reponse.ok) {
      setAccent(suivant);
      document.documentElement.style.setProperty("--accent", accentPalette[suivant].value);
      document.documentElement.style.setProperty(
        "--accent-foreground",
        accentPalette[suivant].foreground,
      );
    }
    setBusy(false);
  }

  return (
    <div className="accentPicker" aria-label="Couleur d’accent">
      {Object.entries(accentPalette).map(([cle, element]) => (
        <button
          key={cle}
          type="button"
          className={cle === accent ? "accentDot selected" : "accentDot"}
          style={{ background: element.value }}
          title={element.label}
          aria-label={element.label}
          aria-pressed={cle === accent}
          disabled={busy}
          onClick={() => void choose(cle as AccentKey)}
        />
      ))}
    </div>
  );
}
