import type { ProductionActivity } from "../production-activity";
import type { LibraryComponent } from "./component";
import { parseLibraryPayload, type LibraryPayload } from "./storage";

export const REQUIRED_LABOR_COMPONENT_IDS = {
  BE: "00000000-0000-4000-8000-0000000000b1",
  ATELIER: "00000000-0000-4000-8000-0000000000a1",
  POSE: "00000000-0000-4000-8000-0000000000c1",
} as const satisfies Record<ProductionActivity, string>;

const REQUIRED_LABOR_COMPONENTS: LibraryComponent[] = [
  {
    id: REQUIRED_LABOR_COMPONENT_IDS.BE,
    name: "Heure BE",
    description: "Temps de bureau d’études réutilisable pour les devis et le planning.",
    unit: "h",
    costPriceCents: 0,
    marginPercent: 0,
    salePriceCents: 0,
    activity: "BE",
  },
  {
    id: REQUIRED_LABOR_COMPONENT_IDS.ATELIER,
    name: "Heure atelier",
    description: "Temps d’atelier réutilisable pour les devis et le planning.",
    unit: "h",
    costPriceCents: 0,
    marginPercent: 0,
    salePriceCents: 0,
    activity: "ATELIER",
  },
  {
    id: REQUIRED_LABOR_COMPONENT_IDS.POSE,
    name: "Heure pose",
    description: "Temps de pose réutilisable pour les devis et le planning.",
    unit: "h",
    costPriceCents: 0,
    marginPercent: 0,
    salePriceCents: 0,
    activity: "POSE",
  },
];

export function requiredLaborComponents(): LibraryComponent[] {
  return REQUIRED_LABOR_COMPONENTS.map((composant) => ({
    ...composant,
  }));
}

export function isRequiredLaborComponentId(idComposant: string): boolean {
  return Object.values(REQUIRED_LABOR_COMPONENT_IDS).includes(
    idComposant as (typeof REQUIRED_LABOR_COMPONENT_IDS)[ProductionActivity],
  );
}

export function ensureRequiredLaborComponents(donnees: LibraryPayload): LibraryPayload {
  const composants = [...donnees.components];

  for (const composantRequis of REQUIRED_LABOR_COMPONENTS) {
    const existantPourActivite = composants.find(
      (composant) => composant.activity === composantRequis.activity,
    );
    if (existantPourActivite) continue;

    const indiceIdFixe = composants.findIndex((composant) => composant.id === composantRequis.id);
    if (indiceIdFixe >= 0) {
      composants[indiceIdFixe] = {
        ...composants[indiceIdFixe],
        activity: composantRequis.activity,
      };
      continue;
    }

    composants.push({ ...composantRequis });
  }

  return parseLibraryPayload({
    ...donnees,
    components: composants,
  });
}
