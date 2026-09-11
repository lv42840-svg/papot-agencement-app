"use client";

import { useState } from "react";
import { accentPalette, type AccentKey } from "@/lib/theme/palette";

export function AccentPicker({ initialAccent }: { initialAccent: string }) {
  const [accent, setAccent] = useState<AccentKey>(
    initialAccent in accentPalette ? (initialAccent as AccentKey) : "lavender",
  );
  const [busy, setBusy] = useState(false);

  async function choose(next: AccentKey) {
    if (busy || next === accent) return;
    setBusy(true);
    const response = await fetch("/api/me/accent", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accentKey: next }),
    });
    if (response.ok) {
      setAccent(next);
      document.documentElement.style.setProperty("--accent", accentPalette[next].value);
      document.documentElement.style.setProperty("--accent-foreground", accentPalette[next].foreground);
    }
    setBusy(false);
  }

  return (
    <div className="accentPicker" aria-label="Couleur d’accent">
      {Object.entries(accentPalette).map(([key, item]) => (
        <button
          key={key}
          type="button"
          className={key === accent ? "accentDot selected" : "accentDot"}
          style={{ background: item.value }}
          title={item.label}
          aria-label={item.label}
          aria-pressed={key === accent}
          disabled={busy}
          onClick={() => void choose(key as AccentKey)}
        />
      ))}
    </div>
  );
}
