"use client";

import { useEffect, useMemo, useState } from "react";

type Folder = { id: string; parentId: string | null; name: string };
type Template = { revision: number; folders: Folder[] };
type Change =
  | { action: "add"; parentId: string | null; name: string }
  | { action: "rename"; id: string; name: string }
  | { action: "move"; id: string; parentId: string | null }
  | { action: "reorder"; id: string; direction: "up" | "down" };

function listTree(template: Template) {
  const result: Array<{ folder: Folder; depth: number; path: string }> = [];
  function visit(parentId: string | null, depth: number, prefix: string) {
    for (const folder of template.folders.filter((item) => item.parentId === parentId)) {
      const folderPath = prefix ? prefix + "/" + folder.name : folder.name;
      result.push({ folder, depth, path: folderPath });
      visit(folder.id, depth + 1, folderPath);
    }
  }
  visit(null, 0, "");
  return result;
}

const ERRORS: Record<string, string> = {
  CHANTIER_TEMPLATE_CONFLICT: "Cette structure a été modifiée sur un autre poste. Actualise.",
  CHANTIER_TEMPLATE_DUPLICATE_NAME: "Un dossier porte déjà ce nom à cet emplacement.",
  CHANTIER_TEMPLATE_NAME_INVALID: "Ce nom n'est pas autorisé dans un dossier Windows.",
  CHANTIER_TEMPLATE_CYCLE: "Impossible de déplacer un dossier à l'intérieur de lui-même.",
  CHANTIER_TEMPLATE_TOO_DEEP: "Trop de niveaux dans la structure.",
  CHANTIER_TEMPLATE_FOLDER_NOT_FOUND: "Dossier introuvable.",
  CHANTIER_TEMPLATE_PARENT_NOT_FOUND: "Destination introuvable.",
};
const PANEL = {
  display: "grid",
  gap: 10,
  padding: 12,
  border: "1px solid #e5deed",
  borderRadius: 10,
} as const;
const LABEL = { display: "grid", gap: 4, fontSize: 12 } as const;
const INPUT = {
  padding: "7px 9px",
  border: "1px solid #d9cfe6",
  borderRadius: 7,
  minWidth: 0,
  width: "100%",
  background: "white",
  color: "#352c43",
} as const;

export function ChantierFolderTemplateEditor({ onUpdated }: { onUpdated?: () => void }) {
  const [template, setTemplate] = useState<Template | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [newName, setNewName] = useState("");
  const [addParent, setAddParent] = useState("");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const tree = useMemo(() => (template ? listTree(template) : []), [template]);
  const selected = template?.folders.find((folder) => folder.id === selectedId);

  const descendants = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedId || !template) return ids;
    ids.add(selectedId);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of template.folders) {
        if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
          ids.add(folder.id);
          changed = true;
        }
      }
    }
    return ids;
  }, [template, selectedId]);

  async function reload() {
    setError("");
    try {
      const response = await fetch("/api/admin/chantiers/folder-template", { cache: "no-store" });
      const body = (await response.json()) as { template?: Template; error?: string };
      if (!response.ok || !body.template) throw new Error(body.error ?? "Chargement impossible");
      setTemplate(body.template);
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "Erreur inconnue";
      setError(ERRORS[code] ?? code);
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  function choose(folder: Folder) {
    setSelectedId(folder.id);
    setName(folder.name);
    setDestination(folder.parentId ?? "");
    setAddParent(folder.id);
    setError("");
    setSuccess("");
  }

  async function apply(change: Change) {
    if (!template || busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/admin/chantiers/folder-template", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: template.revision, change }),
      });
      const body = (await response.json()) as { template?: Template; error?: string };
      if (!response.ok || !body.template)
        throw new Error(body.error ?? "Enregistrement impossible");
      setTemplate(body.template);
      if (change.action === "add") setNewName("");
      setSuccess("Arborescence type enregistrée.");
      onUpdated?.();
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "Erreur inconnue";
      setError(ERRORS[code] ?? code);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article style={{ ...PANEL, padding: 16, background: "white" }}>
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}
      >
        <div>
          <h2 style={{ margin: "0 0 6px" }}>Arborescence type des chantiers</h2>
          <p style={{ margin: 0, fontSize: 13 }}>
            Renommer, ajouter, déplacer ou réordonner les dossiers.
          </p>
        </div>
        <button
          type="button"
          className="secondaryButton"
          disabled={busy}
          onClick={() => void reload()}
        >
          Actualiser
        </button>
      </div>
      <p
        style={{
          background: "#f4f0fc",
          borderRadius: 8,
          padding: 10,
          margin: 0,
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        Les nouveaux dossiers suivent ce modèle. Pour les chantiers déjà créés, la réparation
        ci-dessous ajoute les dossiers manquants. Les anciens fichiers et répertoires ne sont jamais
        supprimés automatiquement lors d&apos;une modification du modèle.
      </p>
      {error ? (
        <p className="formError" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" style={{ color: "#346f52", margin: 0 }}>
          {success}
        </p>
      ) : null}
      {template ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
            gap: 16,
          }}
        >
          <div
            role="list"
            aria-label="Arborescence des dossiers"
            style={{
              border: "1px solid #e5deed",
              borderRadius: 8,
              padding: 5,
              maxHeight: 460,
              overflowY: "auto",
            }}
          >
            {tree.map(({ folder, depth, path }) => (
              <button
                key={folder.id}
                role="listitem"
                type="button"
                title={path}
                onClick={() => choose(folder)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "7px 8px",
                  paddingLeft: 9 + depth * 18,
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  background: selectedId === folder.id ? "#eae2fc" : "transparent",
                  fontWeight: selectedId === folder.id ? 700 : 400,
                  color: "#473b57",
                }}
              >
                📁 {folder.name}
              </button>
            ))}
          </div>
          <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
            <section style={PANEL}>
              <strong>Ajouter un dossier</strong>
              <label style={LABEL}>
                Nom
                <input
                  style={INPUT}
                  maxLength={80}
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="Ex. Photos chantier"
                />
              </label>
              <label style={LABEL}>
                Créer dans
                <select
                  style={INPUT}
                  value={addParent}
                  onChange={(event) => setAddParent(event.target.value)}
                >
                  <option value="">Racine du chantier</option>
                  {tree.map(({ folder, path }) => (
                    <option key={folder.id} value={folder.id}>
                      {path}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="secondaryButton"
                disabled={busy || !newName.trim()}
                onClick={() =>
                  void apply({ action: "add", parentId: addParent || null, name: newName.trim() })
                }
              >
                Ajouter
              </button>
            </section>
            {selected ? (
              <>
                <section style={PANEL}>
                  <strong>Renommer : {selected.name}</strong>
                  <label style={LABEL}>
                    Nom
                    <input
                      style={INPUT}
                      maxLength={80}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={busy || !name.trim() || name.trim() === selected.name}
                    onClick={() =>
                      void apply({ action: "rename", id: selected.id, name: name.trim() })
                    }
                  >
                    Renommer
                  </button>
                </section>
                <section style={PANEL}>
                  <strong>Déplacer ce dossier</strong>
                  <label style={LABEL}>
                    Nouvel emplacement
                    <select
                      style={INPUT}
                      value={destination}
                      onChange={(event) => setDestination(event.target.value)}
                    >
                      <option value="">Racine du chantier</option>
                      {tree
                        .filter(({ folder }) => !descendants.has(folder.id))
                        .map(({ folder, path }) => (
                          <option key={folder.id} value={folder.id}>
                            {path}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={busy || destination === (selected.parentId ?? "")}
                    onClick={() =>
                      void apply({ action: "move", id: selected.id, parentId: destination || null })
                    }
                  >
                    Déplacer
                  </button>
                </section>
                <section style={PANEL}>
                  <strong>Modifier l&apos;ordre</strong>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <button
                      type="button"
                      className="secondaryButton"
                      disabled={busy}
                      onClick={() =>
                        void apply({ action: "reorder", id: selected.id, direction: "up" })
                      }
                    >
                      ↑ Monter
                    </button>
                    <button
                      type="button"
                      className="secondaryButton"
                      disabled={busy}
                      onClick={() =>
                        void apply({ action: "reorder", id: selected.id, direction: "down" })
                      }
                    >
                      ↓ Descendre
                    </button>
                  </div>
                </section>
              </>
            ) : (
              <p>Sélectionne un dossier pour le modifier.</p>
            )}
          </div>
        </div>
      ) : (
        <p>Chargement de l&apos;arborescence…</p>
      )}
    </article>
  );
}
