"use client";

import { ChevronDown, ChevronUp, Plus, Save } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { EntriesPayload, EntriesTag } from "@/lib/entries/domain";

type Snapshot = { payload: EntriesPayload; capabilities: { canManageTags: boolean } };

export function EntriesSettingsWorkspace() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const response = await fetch("/api/desktop/entries", { cache: "no-store" });
    const body = (await response.json()) as Snapshot & { error?: string };
    if (!response.ok) {
      setError(body.error ?? "Impossible de charger les paramètres Entrées.");
      return;
    }
    setSnapshot(body);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const tags = useMemo(
    () => [...(snapshot?.payload.tags ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [snapshot?.payload.tags],
  );

  async function mutate(body: Record<string, unknown>, successMessage?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/desktop/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as Snapshot & { error?: string };
      if (!response.ok) {
        setError(result.error ?? "Enregistrement impossible.");
        return false;
      }
      setSnapshot(result);
      if (successMessage) setNotice(successMessage);
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function addTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newLabel.trim()) return;
    const ok = await mutate({ action: "tagAdd", label: newLabel }, "Tag ajouté.");
    if (ok) setNewLabel("");
  }

  return (
    <div className="panel">
      <div className="clientsDetailHeader">
        <div>
          <h1>Entrées</h1>
          <p className="muted">Gère les tags proposés dans le module Entrées.</p>
        </div>
      </div>

      {error ? <div className="clientsAlert clientsAlertError">{error}</div> : null}
      {notice ? <div className="clientsAlert clientsAlertSuccess">{notice}</div> : null}

      <form className="buttonRow" onSubmit={addTag}>
        <input
          value={newLabel}
          onChange={(event) => setNewLabel(event.target.value)}
          placeholder="Nouveau tag"
          disabled={busy}
        />
        <button className="primaryButton" type="submit" disabled={busy || !newLabel.trim()}>
          <Plus size={15} />
          Ajouter
        </button>
      </form>

      <div className="entriesTagAdminList">
        {tags.map((tag, index) => (
          <TagRow
            key={tag.id}
            tag={tag}
            first={index === 0}
            last={index === tags.length - 1}
            busy={busy}
            onMove={(direction) => mutate({ action: "tagMove", tagId: tag.id, direction })}
            onSave={(label, active) =>
              mutate({ action: "tagUpdate", tagId: tag.id, label, active }, "Tag enregistré.")
            }
          />
        ))}
      </div>
    </div>
  );
}

function TagRow({ tag, first, last, busy, onMove, onSave }: {
  tag: EntriesTag;
  first: boolean;
  last: boolean;
  busy: boolean;
  onMove: (direction: "up" | "down") => Promise<boolean>;
  onSave: (label: string, active: boolean) => Promise<boolean>;
}) {
  const [label, setLabel] = useState(tag.label);
  const [active, setActive] = useState(tag.active);

  useEffect(() => { setLabel(tag.label); setActive(tag.active); }, [tag.label, tag.active]);

  return (
    <div className="entriesTagAdminRow">
      <input value={label} onChange={(event) => setLabel(event.target.value)} disabled={busy} />
      <label>
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
          disabled={busy}
        />
        Actif
      </label>
      <button type="button" title="Monter" disabled={busy || first} onClick={() => void onMove("up")}>
        <ChevronUp size={15} />
      </button>
      <button type="button" title="Descendre" disabled={busy || last} onClick={() => void onMove("down")}>
        <ChevronDown size={15} />
      </button>
      <button className="secondaryButton" type="button" disabled={busy || !label.trim()} onClick={() => void onSave(label, active)}>
        <Save size={14} />
        Enregistrer
      </button>
    </div>
  );
}