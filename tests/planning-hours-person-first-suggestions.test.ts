import { describe, expect, it } from "vitest";
import { scheduledChantiersByPerson } from "../src/lib/planning/actual-hours-suggestions";
import type { PlanningPayload } from "../src/lib/planning/domain";

const personA = "11111111-1111-4111-8111-111111111111";
const personB = "22222222-2222-4222-8222-222222222222";
const chantierA = "33333333-3333-4333-8333-333333333333";
const chantierB = "44444444-4444-4444-8444-444444444444";
const chantierC = "55555555-5555-4555-8555-555555555555";
const sites = [
  { id: chantierA, name: "Pralus Chambéry" },
  { id: chantierB, name: "Clinique Annecy" },
  { id: chantierC, name: "Atelier interne" },
];
type Assignment = PlanningPayload["dailyAssignments"][number];
function assignment(
  userId: string,
  date: string,
  chantierId: string | null,
  label: string,
): Assignment {
  return { id: crypto.randomUUID(), userId, date, chantierId, label, activity: "INSTALL" };
}

describe("weekly person-first actual hours suggestions", () => {
  it("finds every chantier per person from each day of the small board", () => {
    const rows = [
      assignment(personA, "2026-10-19", chantierA, "Pralus Chambéry"),
      assignment(personA, "2026-10-20", chantierB, "Clinique Annecy"),
      assignment(personA, "2026-10-21", chantierA, "Pralus Chambéry"),
      assignment(personB, "2026-10-22", chantierC, "Atelier interne"),
      assignment(personA, "2026-10-26", chantierC, "Atelier interne"),
    ];
    expect(scheduledChantiersByPerson(rows, "2026-W43", sites)).toEqual({
      [personA]: [chantierA, chantierB],
      [personB]: [chantierC],
    });
  });

  it("resolves old free-text chantier labels only when the matching name is unique", () => {
    const rows = [
      assignment(personA, "2026-10-19", null, " prALus chambéry "),
      assignment(personA, "2026-10-20", null, "Livraison et nettoyage"),
      assignment(personB, "2026-10-21", null, "Clinique Annecy"),
      assignment(personB, "2026-10-22", chantierC, "Autre intitulé"),
    ];
    expect(scheduledChantiersByPerson(rows, "2026-W43", sites)).toEqual({
      [personA]: [chantierA],
      [personB]: [chantierB, chantierC],
    });
    expect(
      scheduledChantiersByPerson(rows, "2026-W43", [
        ...sites,
        { id: crypto.randomUUID(), name: "Clinique Annecy" },
      ])[personB],
    ).toEqual([chantierC]);
  });

  it("handles ISO year boundary, empty weeks and deleted chantiers", () => {
    const rows = [
      assignment(personA, "2027-01-01", chantierA, "Pralus Chambéry"),
      assignment(personB, "2026-12-28", chantierB, "Clinique Annecy"),
      assignment(personA, "2027-01-04", chantierC, "Atelier interne"),
      assignment(personB, "2027-01-02", crypto.randomUUID(), "Chantier supprimé"),
    ];
    expect(scheduledChantiersByPerson(rows, "2026-W53", sites)).toEqual({
      [personA]: [chantierA],
      [personB]: [chantierB],
    });
    expect(scheduledChantiersByPerson([], "2026-W53", sites)).toEqual({});
    expect(scheduledChantiersByPerson(rows, "2026-W52", sites)).toEqual({});
  });
});
