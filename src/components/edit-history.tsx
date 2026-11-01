import type { z } from "zod";
import type { editHistorySchema } from "@/lib/edit-history";
export type EditEvent = z.infer<typeof editHistorySchema>;
function valueLabel(value: unknown): string {
  if (value == null) return "Aucune valeur";
  if (Array.isArray(value)) return value.length ? value.map(valueLabel).join(" · ") : "0 h";
  if (typeof value !== "object") return String(value);
  const row = value as Record<string, unknown>;
  if (typeof row.employerCostCents === "number")
    return `${new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(row.employerCostCents / 100)} / ${row.workedHours} h`;
  if (typeof row.be === "number")
    return `BE ${row.be} h · Atelier ${row.workshop} h · Pose ${row.install} h`;
  if (typeof row.hours === "number") {
    const labels: Record<string, string> = {
      BE: "BE",
      WORKSHOP: "Atelier",
      INSTALL: "Pose",
      SAV: "SAV",
      GENERAL: "Frais généraux",
    };
    return `${labels[String(row.activity ?? row.category)] ?? ""} ${row.hours} h`;
  }
  return "Valeur enregistrée";
}
export function EditHistory({
  events,
  people,
}: {
  events: EditEvent[];
  people: Array<{ id: string; name: string }>;
}) {
  if (!events.length) return null;
  const names = new Map(people.map((person) => [person.id, person.name]));
  return (
    <details style={{ marginTop: 16 }}>
      <summary>Historique des saisies et corrections ({events.length})</summary>
      <p>Les modifications antérieures à l’activation de cet historique ne sont pas disponibles.</p>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Modifié par</th>
              <th>Salarié</th>
              <th>Avant</th>
              <th>Après</th>
            </tr>
          </thead>
          <tbody>
            {[...events].reverse().map((event) => {
              const after = event.after as Record<string, unknown> | null;
              return (
                <tr key={`${event.key}:${event.revision}`}>
                  <td>
                    {new Date(event.at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}
                  </td>
                  <td>{event.actorName}</td>
                  <td>{names.get(String(after?.userId ?? after?.personId)) ?? "Ancien salarié"}</td>
                  <td>{valueLabel(event.before)}</td>
                  <td>{valueLabel(event.after)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
