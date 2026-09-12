import { randomUUID } from "node:crypto";
import { NextcloudDavClient } from "../src/lib/sync/nextcloud-dav";
import { NextcloudResourceLockStore } from "../src/lib/sync/resource-lock-store";
import type { ResourceLockOwner, SharedResourceRef } from "../src/lib/sync/resource-lock";

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
  userAgent: "PAPOT-Resource-Lock-Probe/1",
});

const resource: SharedResourceRef = {
  resource_type: "CHANTIER",
  resource_id: `probe-${Date.now()}-${randomUUID()}`,
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

let store: NextcloudResourceLockStore | null = null;
let lucienOwns = false;
let nadiaOwns = false;

async function cleanup(): Promise<void> {
  if (!store) return;

  if (nadiaOwns) {
    await store
      .release({
        resource,
        leaseId: nadiaLeaseId,
        owner: nadia,
      })
      .catch(() => undefined);
    nadiaOwns = false;
  }

  if (lucienOwns) {
    await store
      .release({
        resource,
        leaseId: lucienLeaseId,
        owner: lucien,
      })
      .catch(() => undefined);
    lucienOwns = false;
  }
}

async function main(): Promise<void> {
  console.log("\n--- DECOUVERTE NEXTCLOUD ---");
  const userId = await dav.discoverUserId();
  console.log(`[ok] Identifiant canonique: ${userId}`);

  if (expectedUserId && userId !== expectedUserId) {
    throw new Error(`NEXTCLOUD_USER_ID_MISMATCH expected=${expectedUserId} actual=${userId}`);
  }

  store = new NextcloudResourceLockStore(dav, userId, syncRoot);

  console.log("\n--- 1. LUCIEN OUVRE LE CHANTIER ---");
  const first = await store.acquire({
    resource,
    leaseId: lucienLeaseId,
    owner: lucien,
    baseVersion: 42,
  });

  if (first.status !== "acquired") throw new Error("LUCIEN_LOCK_NOT_ACQUIRED");
  lucienOwns = true;
  console.log("[ok] Lucien obtient le verrou et peut modifier");

  console.log("\n--- 2. RENOUVELLEMENT DU VERROU ---");
  await store.renew({
    resource,
    leaseId: lucienLeaseId,
    owner: lucien,
  });
  console.log("[ok] Le verrou de Lucien est renouvele avec controle de version Nextcloud");

  console.log("\n--- 3. NADIA OUVRE LE MEME CHANTIER ---");
  const second = await store.acquire({
    resource,
    leaseId: nadiaLeaseId,
    owner: nadia,
    baseVersion: 42,
  });

  if (second.status !== "locked") throw new Error("NADIA_SHOULD_BE_READ_ONLY");
  if (second.lock.owner_display_name !== lucien.displayName) {
    throw new Error("LOCK_OWNER_UNEXPECTED");
  }
  console.log(`[ok] Nadia est bloquee en modification: verrou detenu par ${second.lock.owner_display_name}`);
  console.log("[ok] Nadia doit etre affichee en lecture seule");

  console.log("\n--- 4. LUCIEN FERME LE CHANTIER ---");
  const released = await store.release({
    resource,
    leaseId: lucienLeaseId,
    owner: lucien,
  });
  if (!released) throw new Error("LUCIEN_LOCK_NOT_RELEASED");
  lucienOwns = false;
  console.log("[ok] Verrou de Lucien libere");

  console.log("\n--- 5. NADIA REESSAIE ---");
  const third = await store.acquire({
    resource,
    leaseId: nadiaLeaseId,
    owner: nadia,
    baseVersion: 42,
  });

  if (third.status !== "acquired") throw new Error("NADIA_LOCK_NOT_ACQUIRED_AFTER_RELEASE");
  nadiaOwns = true;
  console.log("[ok] Nadia obtient maintenant le verrou et peut modifier");

  console.log("\n--- 6. NETTOYAGE ---");
  const nadiaReleased = await store.release({
    resource,
    leaseId: nadiaLeaseId,
    owner: nadia,
  });
  if (!nadiaReleased) throw new Error("NADIA_LOCK_NOT_RELEASED");
  nadiaOwns = false;

  const finalLock = await store.getActiveLock(resource);
  if (finalLock !== null) throw new Error("LOCK_STILL_ACTIVE_AFTER_CLEANUP");
  console.log("[ok] Verrou temporaire supprime");

  console.log("\n--- VERDICT ---");
  console.log("[pass] Verrou reel Nextcloud valide: Lucien edite, Nadia lit, puis Nadia peut reprendre apres liberation.");
}

main()
  .catch(async (error) => {
    await cleanup();
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[fail] ${message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    // Keep credentials scoped to the caller environment only. This script never writes them to disk.
  });
