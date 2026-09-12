"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { SharedResourceAccessBanner } from "@/components/shared-resource-access-banner";

type EditorState = {
  status: "editable" | "read-only";
  version: number;
  ownerDisplayName?: string;
};

const endpoint = "/api/desktop/shared-resource";

export function ChantierEditor({ chantierId }: { chantierId: string }) {
  const leaseId = useRef(crypto.randomUUID());
  const resource = useRef({ resource_type: "CHANTIER" as const, resource_id: chantierId });
  const editable = useRef(false);
  const [access, setAccess] = useState<EditorState | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("Ouverture du chantier…");

  useEffect(() => {
    let active = true;
    const currentLeaseId = leaseId.current;
    const currentResource = resource.current;
    const call = (body: unknown) =>
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    call({ action: "open", resource: currentResource, leaseId: currentLeaseId })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Ouverture impossible");
        if (!active) return;
        const payload = result.resource?.payload as
          | { title?: string; description?: string }
          | undefined;
        setTitle(payload?.title ?? "");
        setDescription(payload?.description ?? "");
        setAccess({
          status: result.status,
          version: result.baseVersion,
          ownerDisplayName:
            result.status === "read-only" ? result.lock.owner_display_name : undefined,
        });
        editable.current = result.status === "editable";
        setMessage("");
      })
      .catch(
        (error) =>
          active && setMessage(error instanceof Error ? error.message : "Ouverture impossible"),
      );

    const renewal = window.setInterval(() => {
      if (!editable.current) return;
      void call({ action: "renew", resource: currentResource, leaseId: currentLeaseId });
    }, 120_000);

    return () => {
      active = false;
      window.clearInterval(renewal);
      if (editable.current) {
        navigator.sendBeacon(
          endpoint,
          new Blob(
            [
              JSON.stringify({
                action: "release",
                resource: currentResource,
                leaseId: currentLeaseId,
              }),
            ],
            { type: "application/json" },
          ),
        );
      }
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!access || access.status !== "editable") return;
    setMessage("Enregistrement…");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save",
        resource: resource.current,
        leaseId: leaseId.current,
        expectedVersion: access.version,
        payload: { title, description },
      }),
    });
    const result = await response.json();
    if (!response.ok || result.status === "conflict") {
      setMessage("La fiche a changé ailleurs. Rechargez-la avant de poursuivre.");
      return;
    }
    setAccess({ status: "editable", version: result.resource.version });
    setMessage("Chantier enregistré.");
  }

  return (
    <section className="panel" style={{ maxWidth: 820 }}>
      {access ? <SharedResourceAccessBanner {...access} /> : null}
      <form className="loginForm" onSubmit={save}>
        <label>
          Nom du chantier
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={access?.status !== "editable"}
          />
        </label>
        <label>
          Description courte
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={access?.status !== "editable"}
            rows={5}
          />
        </label>
        <button className="primaryButton" disabled={access?.status !== "editable"} type="submit">
          Enregistrer
        </button>
        {message ? <p className="muted">{message}</p> : null}
      </form>
    </section>
  );
}
