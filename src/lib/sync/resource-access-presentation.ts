export type SharedResourceAccessPresentation = {
  canEdit: boolean;
  heading: string;
  detail: string;
  versionLabel: string;
};

export function describeSharedResourceAccess(params: {
  status: "editable" | "read-only";
  version: number;
  ownerDisplayName?: string;
}): SharedResourceAccessPresentation {
  if (!Number.isInteger(params.version) || params.version < 0) {
    throw new Error("RESOURCE_VERSION_INVALID");
  }

  const versionLabel = params.version === 0 ? "Nouveau" : `Version ${params.version}`;

  if (params.status === "editable") {
    return {
      canEdit: true,
      heading: "Modification autorisée",
      detail: "Vous avez la main sur cet élément.",
      versionLabel,
    };
  }

  const owner = params.ownerDisplayName?.trim() || "Un autre utilisateur";
  return {
    canEdit: false,
    heading: "Lecture seule",
    detail: `${owner} modifie actuellement cet élément.`,
    versionLabel,
  };
}
