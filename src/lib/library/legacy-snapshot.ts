import { randomUUID } from "node:crypto";
import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { LIBRARY_RESOURCE_REF, parseLibraryPayload } from "./storage";

const LOCK_TTL_MS = 30_000;

type Desktop = DesktopRequestContext["desktop"];
type Owner = DesktopRequestContext["owner"];

export async function acquireNextcloudLibrarySnapshot(params: { desktop: Desktop; owner: Owner }) {
  const leaseId = randomUUID();
  const opened = await params.desktop.coordinator.open({
    resource: LIBRARY_RESOURCE_REF,
    leaseId,
    owner: params.owner,
    ttlMs: LOCK_TTL_MS,
  });

  if (opened.status === "read-only") {
    throw new Error("LIBRARY_CUTOVER_LOCKED");
  }

  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await params.desktop.coordinator.release({
      resource: LIBRARY_RESOURCE_REF,
      leaseId,
      owner: params.owner,
    });
  };

  try {
    const resource = opened.resource;
    return {
      version: resource?.version ?? 0,
      payload: parseLibraryPayload(resource?.payload),
      updatedAt: resource?.updated_at ?? new Date().toISOString(),
      updatedByUserId: resource?.updated_by_user_id ?? params.owner.userId,
      updatedByDeviceId: resource?.updated_by_device_id ?? params.owner.deviceId,
      release,
    };
  } catch (error) {
    await release().catch((releaseError: unknown) => {
      const code =
        releaseError instanceof Error
          ? releaseError.message
          : "LIBRARY_CUTOVER_LOCK_RELEASE_FAILED";
      console.error("[PAPOT][Library] source lock release failed", { code });
    });
    throw error;
  }
}
