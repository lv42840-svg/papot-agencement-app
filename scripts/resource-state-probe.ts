import { randomUUID } from "node:crypto";
import { NextcloudDavClient } from "../src/lib/sync/nextcloud-dav";
import { NextcloudSharedResourceStore } from "../src/lib/sync/resource-state-store";
import type { SharedResourceRef } from "../src/lib/sync/resource-lock";

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
  userAgent: "PAPOT-Resource-State-Probe/1",
});

const lucien = {
  userId: randomUUID(),
  deviceId: randomUUID(),
};

const nadia = {
  userId: randomUUID(),
  deviceId: randomUUID(),
};

const resource: SharedResourceRef = {
  resource_type: "CHANTIER",
  resource_id: `probe-state-${Date.now()}-${randomUUID()}`,
};

async function resourceFileUrl(userId: string): Promise<string> {
  const filesRoot = dav.filesRoot(userId);
  const collection = await dav.ensurePath(filesRoot, [
    syncRoot,
    "shared",
    resource.resource_type.toLowerCase(),
  ]);
  return dav.childUrl(collection, `${resource.resource_id}.json`);
}

async function main(): Promise<void> {
  console.log("\n--- DECOUVERTE NEXTCLOUD ---");
  const userId = await dav.discoverUserId();
  console.log(`[ok] Identifiant canonique: ${userId}`);

  if (expectedUserId && userId !== expectedUserId) {
    throw new Error(`NEXTCLOUD_USER_ID_MISMATCH expected=${expectedUserId} actual=${userId}`);
  }

  const store = new NextcloudSharedResourceStore(dav, userId, syncRoot);
  const fileUrl = await resourceFileUrl(userId);

  try {
    console.log("\n--- 1. LUCIEN CREE LA VERSION 1 ---");
    const first = await store.save({
      resource,
      expectedVersion: 0,
      payload: { title: "Chantier test", note: "Version Lucien 1" },
      actor: lucien,
    });

    if (first.status !== "saved" || first.resource.version !== 1) {
      throw new Error("VERSION_1_NOT_SAVED");
    }
    console.log("[ok] Version 1 enregistree par Lucien");

    console.log("\n--- 2. NADIA ENREGISTRE LA VERSION 2 ---");
    const second = await store.save({
      resource,
      expectedVersion: 1,
      payload: { title: "Chantier test", note: "Version Nadia 2" },
      actor: nadia,
    });

    if (second.status !== "saved" || second.resource.version !== 2) {
      throw new Error("VERSION_2_NOT_SAVED");
    }
    console.log("[ok] Version 2 enregistree par Nadia");

    console.log("\n--- 3. LUCIEN TENTE D'ECRASER AVEC SON ANCIENNE VERSION 1 ---");
    const stale = await store.save({
      resource,
      expectedVersion: 1,
      payload: { title: "Chantier test", note: "Ancienne copie Lucien" },
      actor: lucien,
    });

    if (stale.status !== "conflict") {
      throw new Error("STALE_WRITE_SHOULD_BE_BLOCKED");
    }
    if (!stale.current || stale.current.version !== 2) {
      throw new Error("CONFLICT_CURRENT_VERSION_UNEXPECTED");
    }
    console.log("[ok] Ecrasement refuse: la version courante est bien 2");

    console.log("\n--- 4. VERIFICATION FINALE ---");
    const current = await store.get(resource);
    if (!current || current.version !== 2) {
      throw new Error("FINAL_VERSION_UNEXPECTED");
    }
    if (
      typeof current.payload !== "object" ||
      current.payload === null ||
      !("note" in current.payload) ||
      current.payload.note !== "Version Nadia 2"
    ) {
      throw new Error("FINAL_PAYLOAD_WAS_OVERWRITTEN");
    }
    console.log("[ok] La version 2 de Nadia est toujours intacte");

    console.log("\n--- 5. NETTOYAGE ---");
    await dav.delete(fileUrl, true);
    console.log("[ok] Ressource temporaire supprimee");

    console.log("\n--- VERDICT ---");
    console.log(
      "[pass] Controle de version reel Nextcloud valide: une ancienne copie ne peut pas ecraser une version plus recente.",
    );
  } catch (error) {
    await dav.delete(fileUrl, true).catch(() => undefined);
    throw error;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[fail] ${message}`);
  process.exitCode = 1;
});
