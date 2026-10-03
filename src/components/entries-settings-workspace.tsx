"use client";

import { ChevronDown, ChevronUp, Plus, Save } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { EntriesPayload, EntriesTag } from "@/lib/entries/domain";

type EntriesSettingsSnapshot = {
  payload: EntriesPayload;
  capabilities: { canManageTags: boolean };
};

const errorMessages: Record<string, string> = {
  TAG_ADMIN_FORBIDDEN: "Tu n'as pas le droit de gérer les tags.",
  TAG_LABEL_EXISTS: "Ce tag existe déjà.",
  TAG_NOT_FOUND: "Ce tag n'existe plus.",
  ENTRIES_REQUEST_INVALID: "Les informations envoyées sont invalides.",
};

export function EntriesSettingsWorkspace() {
  const [snapshot, setSnapshot] = useState<EntriesSettingsSnapshot | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/desktop/entries", { cache: "no-store" });
      const body = (await response.json()) as EntriesSettingsSnapshot & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "ENTRIES_SETTINGS_LOAD_FAILED");
      setSnapshot(body);
    } catch (loadError) {
      const code =
        loadError instanceof Error ? loadError.message : "ENTRIES_SETTINGS_LOAD_FAILED";
      setError(errorMessages[code] ?? "Impossible de charger les tags.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      const result = (await response.json()) as EntriesSettingsSnapshot & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "ENTRIES_SETTINGS_SAVE_FAILED");
      setSnapshot(result);
      if (successMessage) setNotice(successMessage);
      return true;
    } catch (mutationError) {
      const code =
        mutationError instanceof Error ? mutationError.message : "ENTRIES_SETTINGS_SAVE_FAILED";
      setError(errorMessages[code] ?? "Le tag n'a pas pu être enregistré.");
      return false;
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
    <section className="panel entriesSettingsPanel">
      <div>
        <h1>Entrées</h1>
        <p className="muted">Gère les tags proposés dans Capture et lors de la qualification.</p>
      </div>

      {error ? <div className="formError">{error}</div> : null}
      {notice ? <div className="entriesSettingsSuccess">{notice}</div> : null}

      <form className="entriesSettingsAdd" onSubmit={addTag}>
        <input
          value={newLabel}
          onChange={(event) => setNewLabel(event.target.value)}
          placeholder="Nouveau tag"
          disabled={busy}
        />
        <button className="primaryButton" type="submit" disabled={busy || !newLabel.trim()}>
          <Plus size={15} /> Ajouter
        </button>
      </form>

      <div className="entriesSettingsList">
        {tags.map((tag, index) => (
          <TagRow
            key={tag.id}
            tag={tag}
            first={index === 0}
            last={index === tags.length - 1}
            busy={busy}
            onMove={(direction) =>
              mutate({ action: "tagMove", tagId: tag.id, direction })
            }
            onSave={(label, active) =>
              mutate(
                { action: "tagUpdate", tagId: tag.id, label, active },
                "Tag enregistré.",
              )
            }
          />
        ))}
      </div>

      <style jsx global>{`
        .entriesSettingsPanel {
          display: grid;
          gap: 16px;
        }
        .entriesSettingsPanel h1 {
          margin-bottom: 4px;
        }
        .entriesSettingsAdd {
          display: grid;
          grid-template-columns: minmax(0, 420px) auto;
          gap: 10px;
          justify-content: start;
        }
        .entriesSettingsList {
          display: grid;
          gap: 8px;
        }
        .entriesSettingsRow {
          display: grid;
          grid-template-columns: minmax(180px, 1fr) auto 36px 36px auto;
          gap: 8px;
          align-items: center;
          padding: 10px;
          border: 1px solid var(--border);
          border-radius: 10px;
          background: #fff;
        }
        .entriesSettingsActive {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
          font-size: 12px;
        }
        .entriesSettingsActive input {
          width: auto;
          min-height: auto;
        }
        .entriesSettingsMove {
          width: 36px;
          height: 36px;
          display: grid;
          place-items: center;
          padding: 0;
          border: 1px solid #ddd9e8;
          border-radius: 8px;
          background: #fff;
        }
        .entriesSettingsSuccess {
          padding: 10px 12px;
          border: 1px solid #bfe4cc;
          border-radius: 8px;
          background: #effaf3;
          color: #27774a;
          font-size: 13px;
        }
        @media (max-width: 760px) {
          .entriesSettingsAdd,
          .entriesSettingsRow {
            grid-template-columns: 1fr auto auto;
          }
          .entriesSettingsAdd input,
          .entriesSettingsRow > input {
            grid-column: 1 / -1;
          }
        }
      `}</style>
    </section>
  );
}

function TagRow({
  tag,
  first,
  last,
  busy,
  onMove,
  onSave,
}: {
  tag: EntriesTag;
  first: boolean;
  last: boolean;
  busy: boolean;
  onMove: (direction: "up" | "down") => Promise<boolean>;
  onSave: (label: string, active: boolean) => Promise<boolean>;
}) {
  const [label, setLabel] = useState(tag.label);
  const [active, setActive] = useState(tag.active);

  useEffect(() => {
    setLabel(tag.label);
    setActive(tag.active);
  }, [tag.label, tag.active]);

  return (
    <div className="entriesSettingsRow">
      <input
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        disabled={busy}
      />
      <label className="entriesSettingsActive">
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
          disabled={busy}
        />
        Actif
      </label>
      <button
        className="entriesSettingsMove"
        type="button"
        title="Monter"
        disabled={busy || first}
        onClick={() => void onMove("up")}
      >
        <ChevronUp size={15} />
      </button>
      <button
        className="entriesSettingsMove"
        type="button"
        title="Descendre"
        disabled={busy || last}
        onClick={() => void onMove("down")}
      >
        <ChevronDown size={15} />
      </button>
      <button
        className="secondaryButton"
        type="button"
        disabled={busy || !label.trim()}
        onClick={() => void onSave(label, active)}
      >
        <Save size={14} /> Enregistrer
      </button>
    </div>
  );
}
