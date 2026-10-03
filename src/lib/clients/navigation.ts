type NavigableClient = {
  id: string;
  isArchived: boolean;
};

export function clientWorkspaceHref(clientId: string): string {
  return `/clients?focus=${encodeURIComponent(clientId)}`;
}

export function resolveClientWorkspaceSelection(
  clients: NavigableClient[],
  requestedFocusId: string | null,
  currentSelectedId: string | null,
): { selectedId: string | null; revealArchived: boolean } {
  const focused = requestedFocusId
    ? clients.find((client) => client.id === requestedFocusId)
    : undefined;
  if (focused) {
    return { selectedId: focused.id, revealArchived: focused.isArchived };
  }

  const current = currentSelectedId
    ? clients.find((client) => client.id === currentSelectedId)
    : undefined;
  if (current) {
    return { selectedId: current.id, revealArchived: current.isArchived };
  }

  const fallback = clients.find((client) => !client.isArchived) ?? clients[0] ?? null;
  return {
    selectedId: fallback?.id ?? null,
    revealArchived: fallback?.isArchived ?? false,
  };
}
