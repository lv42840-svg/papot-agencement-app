import type { PlanningActivity } from "./domain";

export type PlanningClipboardKind = "firm" | "provisional";
export type PlanningClipboardCell = {
  kind: PlanningClipboardKind;
  id: string;
  activity: PlanningActivity;
  week: string;
};
export type PlanningClipboardUpdate = PlanningClipboardCell & { hours: number };

export type PlanningClipboardRow = {
  id: string;
  activities: { activity: PlanningActivity; weeklyHours: Record<string, number> }[];
};

export const PLANNING_CLIPBOARD_ACTIVITIES: PlanningActivity[] = ["BE", "WORKSHOP", "INSTALL"];
export const PLANNING_MAX_PASTE_CELLS = 200;

function cellColumn(cellule: PlanningClipboardCell, semaines: string[]) {
  const indiceSemaine = semaines.indexOf(cellule.week);
  const indiceActivite = PLANNING_CLIPBOARD_ACTIVITIES.indexOf(cellule.activity);
  return indiceSemaine < 0 || indiceActivite < 0 ? -1 : indiceSemaine * 3 + indiceActivite;
}

export function planningSelectionBounds(
  ancre: PlanningClipboardCell,
  fin: PlanningClipboardCell,
  lignes: PlanningClipboardRow[],
  semaines: string[],
): { top: number; bottom: number; left: number; right: number } | null {
  if (ancre.kind !== fin.kind) return null;
  const ligneA = lignes.findIndex((ligne) => ligne.id === ancre.id);
  const ligneB = lignes.findIndex((ligne) => ligne.id === fin.id);
  const colonneA = cellColumn(ancre, semaines);
  const colonneB = cellColumn(fin, semaines);
  if (ligneA < 0 || ligneB < 0 || colonneA < 0 || colonneB < 0) return null;
  return {
    top: Math.min(ligneA, ligneB),
    bottom: Math.max(ligneA, ligneB),
    left: Math.min(colonneA, colonneB),
    right: Math.max(colonneA, colonneB),
  };
}

function valueForCell(
  ligne: PlanningClipboardRow,
  semaine: string,
  activite: PlanningActivity,
) {
  return (
    ligne.activities.find((element) => element.activity === activite)?.weeklyHours[semaine] ?? 0
  );
}

function displayHours(valeur: number) {
  return Number.isInteger(valeur) ? String(valeur) : String(valeur).replace(".", ",");
}

export function formatPlanningSelection(
  ancre: PlanningClipboardCell,
  fin: PlanningClipboardCell,
  lignes: PlanningClipboardRow[],
  semaines: string[],
  brouillons: Record<string, string>,
): string {
  const rectangle = planningSelectionBounds(ancre, fin, lignes, semaines);
  if (!rectangle) throw new Error("Sélection introuvable dans le planning.");
  const lignesTexte: string[] = [];
  for (let indiceLigne = rectangle.top; indiceLigne <= rectangle.bottom; indiceLigne++) {
    const entrees: string[] = [];
    for (let indiceColonne = rectangle.left; indiceColonne <= rectangle.right; indiceColonne++) {
      const semaine = semaines[Math.floor(indiceColonne / 3)];
      const activite = PLANNING_CLIPBOARD_ACTIVITIES[indiceColonne % 3];
      const element = lignes[indiceLigne];
      entrees.push(
        brouillons[[ancre.kind, element.id, activite, semaine].join(":")] ??
          displayHours(valueForCell(element, semaine, activite)),
      );
    }
    lignesTexte.push(entrees.join("\t"));
  }
  return lignesTexte.join("\n");
}

export function planPlanningPaste(
  texte: string,
  ancre: PlanningClipboardCell,
  fin: PlanningClipboardCell,
  lignes: PlanningClipboardRow[],
  semaines: string[],
  estPassee: (semaine: string) => boolean,
): PlanningClipboardUpdate[] {
  const rectangle = planningSelectionBounds(ancre, fin, lignes, semaines);
  if (!rectangle) throw new Error("Sélection introuvable dans le planning.");
  const matrice = texte
    .replace(/\r/g, "")
    .replace(/\n$/, "")
    .split("\n")
    .map((ligne) => ligne.split("\t"));
  const hauteur =
    matrice.length === 1 && matrice[0].length === 1
      ? rectangle.bottom - rectangle.top + 1
      : matrice.length;
  const largeur =
    matrice.length === 1 && matrice[0].length === 1
      ? rectangle.right - rectangle.left + 1
      : matrice[0].length;
  if (
    hauteur < 1 ||
    largeur < 1 ||
    hauteur * largeur > PLANNING_MAX_PASTE_CELLS ||
    rectangle.top + hauteur > lignes.length ||
    rectangle.left + largeur > semaines.length * 3 ||
    matrice.some((ligne) => ligne.length !== matrice[0].length)
  ) {
    throw new Error("Bloc trop grand ou irrégulier : aucune heure n’a été modifiée.");
  }

  const misesAJour: PlanningClipboardUpdate[] = [];
  for (let indiceLigne = 0; indiceLigne < hauteur; indiceLigne++) {
    for (let indiceColonne = 0; indiceColonne < largeur; indiceColonne++) {
      const semaine = semaines[Math.floor((rectangle.left + indiceColonne) / 3)];
      if (estPassee(semaine)) {
        throw new Error(
          "Impossible de coller sur une semaine passée : aucune heure n’a été modifiée.",
        );
      }
      const brut =
        matrice.length === 1 && matrice[0].length === 1
          ? matrice[0][0]
          : matrice[indiceLigne][indiceColonne];
      const normalise = brut.trim().replace(",", ".");
      const heures = normalise === "" ? 0 : Number(normalise);
      if (!Number.isFinite(heures) || heures < 0 || heures > 10000) {
        throw new Error("Nombre d’heures invalide : aucune heure n’a été modifiée.");
      }
      misesAJour.push({
        kind: ancre.kind,
        id: lignes[rectangle.top + indiceLigne].id,
        week: semaine,
        activity: PLANNING_CLIPBOARD_ACTIVITIES[(rectangle.left + indiceColonne) % 3],
        hours: heures,
      });
    }
  }
  return misesAJour;
}
