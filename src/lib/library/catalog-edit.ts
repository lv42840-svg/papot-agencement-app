import { parseLibraryComponent, type LibraryComponent } from "./component";
import { parseLibraryOuvrage, type LibraryOuvrage } from "./ouvrage";
import { parseLibraryPayload, type LibraryPayload } from "./storage";

export function upsertLibraryComponent(
  payload: LibraryPayload,
  componentValue: unknown,
): LibraryPayload {
  const component = parseLibraryComponent(componentValue);
  const existingIndex = payload.components.findIndex((item) => item.id === component.id);
  const components = [...payload.components];

  if (existingIndex >= 0) {
    components[existingIndex] = component;
  } else {
    components.push(component);
  }

  return parseLibraryPayload({ ...payload, components });
}

export function removeLibraryComponent(
  payload: LibraryPayload,
  componentId: string,
): LibraryPayload {
  const component = payload.components.find((item) => item.id === componentId);
  if (!component) throw new Error("LIBRARY_COMPONENT_NOT_FOUND");

  const usedByOuvrage = payload.ouvrages.some((ouvrage) =>
    ouvrage.components.some((line) => line.componentId === componentId),
  );
  if (usedByOuvrage) throw new Error("LIBRARY_COMPONENT_IN_USE");

  return parseLibraryPayload({
    ...payload,
    components: payload.components.filter((item) => item.id !== componentId),
  });
}

export function upsertLibraryOuvrage(
  payload: LibraryPayload,
  ouvrageValue: unknown,
): LibraryPayload {
  const ouvrage = parseLibraryOuvrage(ouvrageValue);
  const existingIndex = payload.ouvrages.findIndex((item) => item.id === ouvrage.id);
  const ouvrages = [...payload.ouvrages];

  if (existingIndex >= 0) {
    ouvrages[existingIndex] = ouvrage;
  } else {
    ouvrages.push(ouvrage);
  }

  return parseLibraryPayload({ ...payload, ouvrages });
}

export function removeLibraryOuvrage(payload: LibraryPayload, ouvrageId: string): LibraryPayload {
  if (!payload.ouvrages.some((item) => item.id === ouvrageId)) {
    throw new Error("LIBRARY_OUVRAGE_NOT_FOUND");
  }

  return parseLibraryPayload({
    ...payload,
    ouvrages: payload.ouvrages.filter((item) => item.id !== ouvrageId),
  });
}

export function libraryComponentUsageCount(
  ouvrages: LibraryOuvrage[],
  component: Pick<LibraryComponent, "id">,
): number {
  return ouvrages.reduce(
    (total, ouvrage) =>
      total + ouvrage.components.filter((line) => line.componentId === component.id).length,
    0,
  );
}
