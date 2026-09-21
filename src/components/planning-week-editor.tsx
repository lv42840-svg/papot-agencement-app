"use client";

import { FormEvent } from "react";
import { SharedResourceAccessBanner } from "@/components/shared-resource-access-banner";
import { useSharedResourceEditor } from "@/hooks/use-shared-resource-editor";

type PlanningWeekPayload = {
  label: string;
  targetHours: number;
  notes: string;
};

export function PlanningWeekEditor({ weekId }: { weekId: string }) {
  const editor = useSharedResourceEditor<PlanningWeekPayload>({
    resource: { resource_type: "PLANNING_WEEK", resource_id: weekId },
    emptyPayload: { label: weekId, targetHours: 39, notes: "" },
    openingMessage: "Ouverture du planning…",
    savedMessage: "Planning enregistré.",
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
          Semaine
          <input
            value={editor.payload.label}
            onChange={(event) =>
              editor.setPayload({ ...editor.payload, label: event.target.value })
            }
            disabled={!editor.canEdit}
          />
        </label>
        <label>
          Objectif hebdomadaire par personne
          <input
            type="number"
            min="0"
            step="0.5"
            value={editor.payload.targetHours}
            onChange={(event) =>
              editor.setPayload({
                ...editor.payload,
                targetHours: Number(event.target.value),
              })
            }
            disabled={!editor.canEdit}
          />
        </label>
        <label>
          Notes de la semaine
          <textarea
            value={editor.payload.notes}
            onChange={(event) =>
              editor.setPayload({ ...editor.payload, notes: event.target.value })
            }
            disabled={!editor.canEdit}
            rows={5}
          />
        </label>
        <button className="primaryButton" disabled={!editor.canEdit} type="submit">
          Enregistrer le planning
        </button>
        {editor.message ? <p className="muted">{editor.message}</p> : null}
      </form>
    </section>
  );
}
