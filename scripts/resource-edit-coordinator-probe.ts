import { randomUUID } from "node:crypto";
import { NextcloudDavClient } from "../src/lib/sync/nextcloud-dav";
import { SharedResourceEditCoordinator } from "../src/lib/sync/resource-edit-coordinator";
import { NextcloudResourceLockStore } from "../src/lib/sync/resource-lock-store";
import { resourceLockPathSegments, type ResourceLockOwner, type SharedResourceRef } from "../src/lib/sync/resource-lock";
import { NextcloudSharedResourceStore } from "../src/lib/sync/resource-state-store";

const baseUrl = process.env.NEXTCLOUD_BASE_URL?.trim() || "https://cloud.ideo-solutions.com";
const login = process.env.NEXTCLOUD_LOGIN?.trim();
const appPassword = process.env.NEXTCLOUD_APP_PASSWORD;
const expectedUserId = process.env.NEXTCLOUD_USER_ID?.trim();
const syncRoot = process.env.NEXTCLOUD_SYNC_ROOT?.trim() || "PAPOT_SYNC";

if (!login) throw new Error("NEXTCLOUD_LOGIN is required");
if (!appPassword) throw new Error("NEXTCLOUD_APP_PASSWORD is required");

const dav = new NextcloudDavClient({
  baseUrl,
  login,
  appPassword,
  userAgent: "PAPOT-Resource-Edit-Coordinator-Probe/1",
});

const resource: SharedResourceRef = {
  resource_type: "CHANTIER",
  resource_id: `probe-coordinator-${Date.now()}-${randomUUID()}`,
};

const lucien: ResourceLockOwner = {
  userId: randomUUID(),
  deviceId: randomUUID(),
  displayName: "Lucien (probe)",
};

const nadia: ResourceLockOwner = {
  userId: randomUUID(),
  deviceId: randomUUID(),
  displayName: "Nadia (probe)",
};

const lucienLeaseId = randomUUID();
const nadiaLeaseId = randomUUID();

async function getUrls(userId: string): Promise<{ lockUrl: string; stateUrl: string }> {
  const filesRoot = dav.filesRoot(userId);

  const [locksSegment, typeSegment, lockFile] = resourceLockPathSegments(resource);
  const lockCollection = await dav.ensurePath(filesRoot, [syncRoot, locksSegment, typeSegment]);
  const lockUrl = dav.childUrl(lockCollection, lockFile);

  const stateCollection = await dav.ensurePath(filesRoot, [
    syncRoot,
    "shared",
    resource.resource_type.toLowerCase(),
  ]);
  const stateUrl = dav.childUrl(stateCollection, `${resource.resource_id}.json`);

  return { lockUrl, stateUrl };
}

async function main(): Promise<void> {
  console.log("\n--- DECOUVERTE NEXTCLOUD ---");
  const userId = await dav.discoverUserId();
  console.log(`[ok] Identifiant canonique: ${userId}`);

  if (expectedUserId && userId !== expectedUserId) {
    throw new Error(`NEXTCLOUD_USER_ID_MISMATCH expected=${expectedUserId} actual=${userId}`);
  }

  const locks = new NextcloudResourceLockStore(dav, userId, syncRoot);
  const states = new NextcloudSharedResourceStore(dav, userId, syncRoot);
  const coordinator = new SharedResourceEditCoordinator(locks, states);
  const { lockUrl, stateUrl } = await getUrls(userId);

  let lucienOwns = false;
  let nadiaOwns = false;

  try {
    console.log("\n--- 1. LUCIEN OUVRE LE CHANTIER ---");
    const openedByLucien = await coordinator.open({
      resource,
      leaseId: lucienLeaseId,
      owner: lucien,
    });

    if (openedByLucien.status !== "editable") throw new Error("LUCIEN_SHOULD_BE_EDITABLE");
    if (openedByLucien.baseVersion !== 0) throw new Error("LUCIEN_BASE_VERSION_UNEXPECTED");
    lucienOwns = true;
    console.log("[ok] Lucien ouvre le chantier en modification, version de base 0");

    console.log("\n--- 2. NADIA OUVRE LE MEME CHANTIER ---");
    const openedByNadia = await coordinator.open({
      resource,
      leaseId: nadiaLeaseId,
      owner: nadia,
    });

    if (openedByNadia.status !== "read-only") throw new Error("NADIA_SHOULD_BE_READ_ONLY");
    if (openedByNadia.lock.owner_display_name !== lucien.displayName) {
      throw new Error("NADIA_LOCK_OWNER_UNEXPECTED");
    }
    console.log("[ok] Nadia passe en lecture seule pendant que Lucien modifie");

    console.log("\n--- 3. LUCIEN ENREGISTRE ---");
    const savedByLucien = await coordinator.save({
      resource,
      leaseId: lucienLeaseId,
      owner: lucien,
      expectedVersion: openedByLucien.baseVersion,
      payload: { title: "Chantier test", note: "Enregistre par Lucien" },
    });

    if (savedByLucien.status !== "saved" || savedByLucien.resource.version !== 1) {
      throw new Error("LUCIEN_SAVE_FAILED");
    }
    console.log("[ok] Lucien enregistre la version 1 sous son verrou");

    console.log("\n--- 4. LUCIEN FERME ---");
    const lucienReleased = await coordinator.release({
      resource,
      leaseId: lucienLeaseId,
      owner: lucien,
    });
    if (!lucienReleased) throw new Error("LUCIEN_RELEASE_FAILED");
    lucienOwns = false;
    console.log("[ok] Lucien libere le chantier");

    console.log("\n--- 5. NADIA REOUVRE APRES LIBERATION ---");
    const reopenedByNadia = await coordinator.open({
      resource,
      leaseId: nadiaLeaseId,
      owner: nadia,
    });

    if (reopenedByNadia.status !== "editable") throw new Error("NADIA_SHOULD_BE_EDITABLE");
    if (reopenedByNadia.baseVersion !== 1) throw new Error("NADIA_BASE_VERSION_UNEXPECTED");
    nadiaOwns = true;
    console.log("[ok] Nadia recupere la modification et voit bien la version 1 de Lucien");

    console.log("\n--- 6. NADIA ENREGISTRE LA VERSION 2 ---");
    const savedByNadia = await coordinator.save({
      resource,
      leaseId: nadiaLeaseId,
      owner: nadia,
      expectedVersion: reopenedByNadia.baseVersion,
      payload: { title: "Chantier test", note: "Enregistre par Nadia" },
    });

    if (savedByNadia.status !== "saved" || savedByNadia.resource.version !== 2) {
      throw new Error("NADIA_SAVE_FAILED");
    }
    console.log("[ok] Nadia enregistre la version 2");

    const nadiaReleased = await coordinator.release({
      resource,
      leaseId: nadiaLeaseId,
      owner: nadia,
    });
    if (!nadiaReleased) throw new Error("NADIA_RELEASE_FAILED");
    nadiaOwns = false;

    console.log("\n--- 7. VERIFICATION FINALE ---");
    const current = await states.get(resource);
    if (!current || current.version !== 2) throw new Error("FINAL_VERSION_UNEXPECTED");
    if (
      typeof current.payload !== "object" ||
      current.payload === null ||
      !("note" in current.payload) ||
      current.payload.note !== "Enregistre par Nadia"
    ) {
      throw new Error("FINAL_PAYLOAD_UNEXPECTED");
    }
    console.log("[ok] La derniere version partagee est bien la version 2 de Nadia");

    console.log("\n--- 8. NETTOYAGE ---");
    await dav.delete(lockUrl, true);
    await dav.delete(stateUrl, true);
    console.log("[ok] Fichiers temporaires supprimes");

    console.log("\n--- VERDICT ---");
    console.log("[pass] Coordination reelle validee: verrou + lecture seule + version + passage de relais fonctionnent ensemble sur Nextcloud.");
  } catch (error) {
    if (nadiaOwns) {
      await coordinator
        .release({ resource, leaseId: nadiaLeaseId, owner: nadia })
        .catch(() => undefined);
    }
    if (lucienOwns) {
      await coordinator
        .release({ resource, leaseId: lucienLeaseId, owner: lucien })
        .catch(() => undefined);
    }
    await dav.delete(lockUrl, true).catch(() => undefined);
    await dav.delete(stateUrl, true).catch(() => undefined);
    throw error;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[fail] ${message}`);
  process.exitCode = 1;
});
