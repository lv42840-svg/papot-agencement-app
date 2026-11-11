import { parseLibraryComponent, type LibraryComponent } from "./component";
import { parseLibraryOuvrage, type LibraryOuvrage } from "./ouvrage";
import { isRequiredLaborComponentId } from "./required-labor-components";
import { parseLibraryPayload, type LibraryPayload } from "./storage";

export function upsertLibraryComponent(
  donnees: LibraryPayload,
  valeurComposant: unknown,
): LibraryPayload {
  const composant = parseLibraryComponent(valeurComposant);
  const indiceExistant = donnees.components.findIndex((element) => element.id === composant.id);
  const composants = [...donnees.components];

  if (indiceExistant >= 0) {
    composants[indiceExistant] = composant;
  } else {
    composants.push(composant);
  }

  return parseLibraryPayload({ ...donnees, components: composants });
}

export function removeLibraryComponent(
  donnees: LibraryPayload,
  idComposant: string,
): LibraryPayload {
  const composant = donnees.components.find((element) => element.id === idComposant);
  if (!composant) throw new Error("LIBRARY_COMPONENT_NOT_FOUND");
  if (isRequiredLaborComponentId(idComposant)) {
    throw new Error("LIBRARY_COMPONENT_REQUIRED");
  }

  const utiliseParOuvrage = donnees.ouvrages.some((ouvrage) =>
    ouvrage.components.some((ligne) => ligne.componentId === idComposant),
  );
  if (utiliseParOuvrage) throw new Error("LIBRARY_COMPONENT_IN_USE");

  return parseLibraryPayload({
    ...donnees,
    components: donnees.components.filter((element) => element.id !== idComposant),
  });
}

export function upsertLibraryOuvrage(
  donnees: LibraryPayload,
  valeurOuvrage: unknown,
): LibraryPayload {
  const ouvrage = parseLibraryOuvrage(valeurOuvrage);
  const indiceExistant = donnees.ouvrages.findIndex((element) => element.id === ouvrage.id);
  const ouvrages = [...donnees.ouvrages];

  if (indiceExistant >= 0) {
    ouvrages[indiceExistant] = ouvrage;
  } else {
    ouvrages.push(ouvrage);
  }

  return parseLibraryPayload({ ...donnees, ouvrages });
}

export function removeLibraryOuvrage(donnees: LibraryPayload, idOuvrage: string): LibraryPayload {
  if (!donnees.ouvrages.some((element) => element.id === idOuvrage)) {
    throw new Error("LIBRARY_OUVRAGE_NOT_FOUND");
  }

  return parseLibraryPayload({
    ...donnees,
    ouvrages: donnees.ouvrages.filter((element) => element.id !== idOuvrage),
  });
}

export function libraryComponentUsageCount(
  ouvrages: LibraryOuvrage[],
  composant: Pick<LibraryComponent, "id">,
): number {
  return ouvrages.reduce(
    (total, ouvrage) =>
      total + ouvrage.components.filter((ligne) => ligne.componentId === composant.id).length,
    0,
  );
}
