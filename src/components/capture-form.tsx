"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckCircle2, Send, Zap } from "lucide-react";

export type CaptureUser = { id: string; displayName: string };
export type CaptureTag = { id: string; label: string };

export function CaptureForm({
  currentUserId,
  users,
  tags,
}: {
  currentUserId: string;
  users: CaptureUser[];
  tags: CaptureTag[];
}) {
  const [title, setTitle] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState(currentUserId);
  const [priority, setPriority] = useState<"NORMAL" | "URGENT">("NORMAL");
  const [dueAt, setDueAt] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentId, setSentId] = useState<string | null>(null);
  const [clientRequestId, setClientRequestId] = useState(() => crypto.randomUUID());

  const canSend = useMemo(
    () => title.trim().length > 0 && responsibleUserId.length > 0 && !busy,
    [title, responsibleUserId, busy],
  );

  function reset() {
    setTitle("");
    setResponsibleUserId(currentUserId);
    setPriority("NORMAL");
    setDueAt("");
    setSelectedTags([]);
    setSentId(null);
    setError("");
    setClientRequestId(crypto.randomUUID());
  }

  function toggleTag(tagId: string) {
    setSelectedTags((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
    );
  }

  async function send() {
    if (!canSend) return;
    setBusy(true);
    setError("");
    const response = await fetch("/api/captures", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientRequestId,
        title: title.trim(),
        responsibleUserId,
        priority,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        tagIds: selectedTags,
      }),
    });
    const body = (await response.json().catch(() => null)) as {
      id?: string;
      error?: string;
    } | null;
    if (!response.ok || !body?.id) {
      setError(body?.error ?? "Impossible d’envoyer la capture.");
      setBusy(false);
      return;
    }
    setSentId(body.id);
    setBusy(false);
  }

  if (sentId) {
    return (
      <section className="successPanel" aria-live="polite">
        <CheckCircle2 size={44} />
        <h1>Capture envoyée</h1>
        <p>La piste est enregistrée et visible dans la boîte « À qualifier ».</p>
        <div className="buttonRow">
          <button className="primaryButton" type="button" onClick={reset}>
            Nouvelle capture
          </button>
          <Link className="secondaryButton" href="/">
            Retour à l’accueil
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="captureCard">
      <div className="captureHeading">
        <div>
          <p className="eyebrow">PAPOT Capture</p>
          <h1>Nouvelle piste</h1>
          <p className="muted">Saisie rapide, qualification ensuite.</p>
        </div>
        <span className="typeBadge">
          <Zap size={15} /> Piste commerciale
        </span>
      </div>

      <div className="captureFields">
        <label className="fullField">
          Nom libre de la piste
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Client, lieu ou sujet…"
            autoFocus
            maxLength={240}
          />
        </label>

        <label>
          Responsable
          <select
            value={responsibleUserId}
            onChange={(event) => setResponsibleUserId(event.target.value)}
            required
          >
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="priorityField">
          <legend>Priorité</legend>
          <div className="segmented">
            <button
              type="button"
              className={priority === "NORMAL" ? "active" : ""}
              onClick={() => setPriority("NORMAL")}
            >
              Normale
            </button>
            <button
              type="button"
              className={priority === "URGENT" ? "active urgent" : ""}
              onClick={() => setPriority("URGENT")}
            >
              Urgent
            </button>
          </div>
        </fieldset>

        <label>
          À faire pour le <span className="optional">facultatif</span>
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
        </label>
      </div>

      {tags.length > 0 && (
        <fieldset className="tagField">
          <legend>
            Tags <span className="optional">facultatif</span>
          </legend>
          <div className="tagList">
            {tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                aria-pressed={selectedTags.includes(tag.id)}
                className={selectedTags.includes(tag.id) ? "tag selected" : "tag"}
                onClick={() => toggleTag(tag.id)}
              >
                {tag.label}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {error && (
        <p className="formError" role="alert">
          {error}
        </p>
      )}
      <button
        className="primaryButton sendButton"
        type="button"
        disabled={!canSend}
        onClick={() => void send()}
      >
        <Send size={18} /> {busy ? "Envoi en cours…" : "Envoyer"}
      </button>
    </section>
  );
}
