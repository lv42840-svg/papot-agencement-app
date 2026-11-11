import type { z } from "zod";
import type { editHistorySchema } from "@/lib/edit-history";
export type EditEvent = z.infer<typeof editHistorySchema>;
function valueLabel(valeur: unknown): string {
  if (valeur == null) return "Aucune valeur";
  if (Array.isArray(valeur)) return valeur.length ? valeur.map(valueLabel).join(" · ") : "0 h";
  if (typeof valeur !== "object") return String(valeur);
  const ligneTableau = valeur as Record<string, unknown>;
  if (typeof ligneTableau.employerCostCents === "number")
    return `${new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(ligneTableau.employerCostCents / 100)} / ${ligneTableau.workedHours} h`;
  if (typeof ligneTableau.be === "number")
    return `BE ${ligneTableau.be} h · Atelier ${ligneTableau.workshop} h · Pose ${ligneTableau.install} h`;
  if (typeof ligneTableau.hours === "number") {
    const libelles: Record<string, string> = {
      BE: "BE",
      WORKSHOP: "Atelier",
      INSTALL: "Pose",
      SAV: "SAV",
      GENERAL: "Frais généraux",
    };
    return `${libelles[String(ligneTableau.activity ?? ligneTableau.category)] ?? ""} ${ligneTableau.hours} h`;
  }
  return "Valeur enregistrée";
}
export function EditHistory({
  events: evenements,
  people: personnes,
}: {
  events: EditEvent[];
  people: Array<{ id: string; name: string }>;
}) {
  if (!evenements.length) return null;
  const noms = new Map(personnes.map((personne) => [personne.id, personne.name]));
  return (
    <details style={{ marginTop: 16 }}>
      <summary>Historique des saisies et corrections ({evenements.length})</summary>
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
            {[...evenements].reverse().map((evenement) => {
              const after = evenement.after as Record<string, unknown> | null;
              return (
                <tr key={`${evenement.key}:${evenement.revision}`}>
                  <td>
                    {new Date(evenement.at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}
                  </td>
                  <td>{evenement.actorName}</td>
                  <td>{noms.get(String(after?.userId ?? after?.personId)) ?? "Ancien salarié"}</td>
                  <td>{valueLabel(evenement.before)}</td>
                  <td>{valueLabel(evenement.after)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
