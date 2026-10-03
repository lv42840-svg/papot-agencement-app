"use client";

import { FormEvent } from "react";
import { SharedResourceAccessBanner } from "@/components/shared-resource-access-banner";
import { useSharedResourceEditor } from "@/hooks/use-shared-resource-editor";

type ChantierPayload = {
  title: string;
  description: string;
};

export function ChantierEditor({ chantierId }: { chantierId: string }) {
  const editor = useSharedResourceEditor<ChantierPayload>({
    resource: { resource_type: "CHANTIER", resource_id: chantierId },
    emptyPayload: { title: "", description: "" },
    openingMessage: "Ouverture du chantier…",
    savedMessage: "Chantier enregistré.",
  });

  async function save(event: FormEvent) {
    event.preventDefault();
    await editor.save(editor.payload);
  }

  return (
    <section className="panel" style={{ maxWidth: 820 }}>
      {editor.access ? <SharedResourceAccessBanner {...editor.access} /> : null}
      <form className="loginForm" onSubmit={save}>
        <label>
          Nom du chantier
          <input
            value={editor.payload.title}
            onChange={(event) =>
              editor.setPayload({ ...editor.payload, title: event.target.value })
            }
            disabled={!editor.canEdit}
          />
        </label>
        <label>
          Description courte
          <textarea
            value={editor.payload.description}
            onChange={(event) =>
              editor.setPayload({ ...editor.payload, description: event.target.value })
            }
            disabled={!editor.canEdit}
            rows={5}
          />
        </label>
        <button className="primaryButton" disabled={!editor.canEdit} type="submit">
          Enregistrer
        </button>
        {editor.message ? <p className="muted">{editor.message}</p> : null}
      </form>
    </section>
  );
}
