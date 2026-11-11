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
  const [erreur, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const reponse = await fetch("/api/desktop/entries", { cache: "no-store" });
      const corps = (await reponse.json()) as EntriesSettingsSnapshot & { error?: string };
      if (!reponse.ok) throw new Error(corps.error ?? "ENTRIES_SETTINGS_LOAD_FAILED");
      setSnapshot(corps);
    } catch (loadError) {
      const code = loadError instanceof Error ? loadError.message : "ENTRIES_SETTINGS_LOAD_FAILED";
      setError(errorMessages[code] ?? "Impossible de charger les tags.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const etiquettes = useMemo(
    () => [...(snapshot?.payload.tags ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [snapshot?.payload.tags],
  );

  async function mutate(corps: Record<string, unknown>, successMessage?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const reponse = await fetch("/api/desktop/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corps),
      });
      const resultat = (await reponse.json()) as EntriesSettingsSnapshot & { error?: string };
      if (!reponse.ok) throw new Error(resultat.error ?? "ENTRIES_SETTINGS_SAVE_FAILED");
      setSnapshot(resultat);
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

  async function addTag(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
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

      {erreur ? <div className="formError">{erreur}</div> : null}
      {notice ? <div className="entriesSettingsSuccess">{notice}</div> : null}

      <form className="entriesSettingsAdd" onSubmit={addTag}>
        <input
          value={newLabel}
          onChange={(evenement) => setNewLabel(evenement.target.value)}
          placeholder="Nouveau tag"
          disabled={busy}
        />
        <button className="primaryButton" type="submit" disabled={busy || !newLabel.trim()}>
          <Plus size={15} /> Ajouter
        </button>
      </form>

      <div className="entriesSettingsList">
        {etiquettes.map((etiquette, indice) => (
          <TagRow
            key={etiquette.id}
            tag={etiquette}
            first={indice === 0}
            last={indice === etiquettes.length - 1}
            busy={busy}
            onMove={(direction) => mutate({ action: "tagMove", tagId: etiquette.id, direction })}
            onSave={(libelle, active) =>
              mutate(
                { action: "tagUpdate", tagId: etiquette.id, label: libelle, active },
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
  tag: etiquette,
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
  onSave: (libelle: string, active: boolean) => Promise<boolean>;
}) {
  const [libelle, setLabel] = useState(etiquette.label);
  const [active, setActive] = useState(etiquette.active);

  useEffect(() => {
    setLabel(etiquette.label);
    setActive(etiquette.active);
  }, [etiquette.label, etiquette.active]);

  return (
    <div className="entriesSettingsRow">
      <input
        value={libelle}
        onChange={(evenement) => setLabel(evenement.target.value)}
        disabled={busy}
      />
      <label className="entriesSettingsActive">
        <input
          type="checkbox"
          checked={active}
          onChange={(evenement) => setActive(evenement.target.checked)}
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
        disabled={busy || !libelle.trim()}
        onClick={() => void onSave(libelle, active)}
      >
        <Save size={14} /> Enregistrer
      </button>
    </div>
  );
}
