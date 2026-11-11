import type { SpecialPermissionKey } from "@/lib/auth/permission-catalog";

export function commercialSpecialPermissionForMutation(saisie: {
  action: string;
  status?: string;
  nextStatus?: string;
}): SpecialPermissionKey | null {
  if (saisie.action === "create") return "commercial.create";
  if (
    saisie.action === "updateProvision" ||
    saisie.action === "setForecastQuotes" ||
    saisie.action === "useManualProvision"
  ) {
    return "commercial.provision";
  }
  if (saisie.action === "retainAdditionalQuote") return "commercial.confirm_launch";
  if (saisie.action === "setStatus" && saisie.status === "CONFIRMED") {
    return "commercial.confirm_launch";
  }
  if (saisie.action === "recordFollowUp" && saisie.nextStatus === "CONFIRMED") {
    return "commercial.confirm_launch";
  }
  return null;
}

export function chantierSpecialPermissionForMutation(saisie: {
  action: string;
}): SpecialPermissionKey | null {
  if (
    saisie.action === "markDone" ||
    saisie.action === "cancel" ||
    saisie.action === "reactivate"
  ) {
    return "chantiers.close_reopen";
  }
  if (saisie.action === "archive" || saisie.action === "unarchive") {
    return "chantiers.archive_reactivate";
  }
  return null;
}
