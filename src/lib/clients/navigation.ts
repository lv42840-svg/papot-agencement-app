type NavigableClient = {
  id: string;
  isArchived: boolean;
};

export function clientWorkspaceHref(idClient: string): string {
  return `/clients?focus=${encodeURIComponent(idClient)}`;
}

export function resolveClientWorkspaceSelection(
  clients: NavigableClient[],
  idFocusDemande: string | null,
  idSelectionCourante: string | null,
): { selectedId: string | null; revealArchived: boolean } {
  const clientFocus = idFocusDemande
    ? clients.find((client) => client.id === idFocusDemande)
    : undefined;
  if (clientFocus) {
    return {
      selectedId: clientFocus.id,
      revealArchived: clientFocus.isArchived,
    };
  }

  const clientCourant = idSelectionCourante
    ? clients.find((client) => client.id === idSelectionCourante)
    : undefined;
  if (clientCourant) {
    return {
      selectedId: clientCourant.id,
      revealArchived: clientCourant.isArchived,
    };
  }

  const clientSecours = clients.find((client) => !client.isArchived) ?? clients[0] ?? null;
  return {
    selectedId: clientSecours?.id ?? null,
    revealArchived: clientSecours?.isArchived ?? false,
  };
}
