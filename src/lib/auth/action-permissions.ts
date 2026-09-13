import type { SpecialPermissionKey } from "@/lib/auth/permission-catalog";

export function commercialSpecialPermissionForMutation(input: {
  action: string;
  status?: string;
  nextStatus?: string;
}): SpecialPermissionKey | null {
  if (input.action === "create") return "commercial.create";
  if (input.action === "updateProvision") return "commercial.provision";
  if (input.action === "setStatus" && input.status === "CONFIRMED") {
    return "commercial.confirm_launch";
  }
  if (input.action === "recordFollowUp" && input.nextStatus === "CONFIRMED") {
    return "commercial.confirm_launch";
  }
  return null;
}

export function chantierSpecialPermissionForMutation(input: {
  action: string;
}): SpecialPermissionKey | null {
  if (input.action === "archive" || input.action === "unarchive") {
    return "chantiers.archive_reactivate";
  }
  return null;
}
