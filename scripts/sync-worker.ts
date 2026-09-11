import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { createCaptureWithClient } from "../src/lib/capture/write";
import { NextcloudDavClient } from "../src/lib/sync/nextcloud-dav";
import {
  SYNC_SCHEMA_VERSION,
  syncPackageSchema,
  type SyncAttachment,
  type SyncPackage,
} from "../src/lib/sync/protocol";
import {
  syncBusinessRequestHash,
  syncPackagePayloadHash,
  verifySyncPackageSignature,
} from "../src/lib/sync/signature";

const DEFAULT_BASE_URL = "https://cloud.ideo-solutions.com";
const DEFAULT_SYNC_ROOT = "PAPOT_SYNC";
const DEFAULT_POLL_INTERVAL_MS = 15_000;

class PermanentSyncError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

type DeviceRow = {
  id: string;
  user_id: string;
  nextcloud_user_id: string;
  key_id: string;
  public_key_pem: string;
};

type AppliedRow = {
  package_id: string;
  request_sha256: string;
  result_json: unknown;
};

type AppliedResult = {
  captureId: string;
  duplicate: boolean;
};

type DeviceZones = {
  incoming: string;
  ack: string;
  error: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parsePacket(text: string): SyncPackage {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PermanentSyncError("INVALID_JSON");
  }

  if (
    typeof raw === "object" &&
    raw !== null &&
    "schema_version" in raw &&
    (raw as { schema_version?: unknown }).schema_version !== SYNC_SCHEMA_VERSION
  ) {
    throw new PermanentSyncError("UNSUPPORTED_SCHEMA_VERSION");
  }

  const parsed = syncPackageSchema.safeParse(raw);
  if (!parsed.success) throw new PermanentSyncError("INVALID_PACKET");
  return parsed.data;
}

function captureIdFromResult(result: unknown): string {
  if (
    typeof result !== "object" ||
    result === null ||
    !("capture_id" in result) ||
    typeof (result as { capture_id?: unknown }).capture_id !== "string"
  ) {
    throw new Error("SYNC_RESULT_INVALID");
  }
  return (result as { capture_id: string }).capture_id;
}

function attachmentTargetPath(captureId: string, attachment: SyncAttachment): string {
  return `documents/captures/${captureId}/${attachment.object_name}`;
}

async function verifyAttachmentBytes(
  dav: NextcloudDavClient,
  url: string,
  attachment: SyncAttachment,
): Promise<void> {
  const bytes = await dav.getBytes(url);
  if (bytes.length !== attachment.size_bytes) {
    throw new PermanentSyncError("ATTACHMENT_SIZE_MISMATCH");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== attachment.sha256) {
    throw new PermanentSyncError("ATTACHMENT_HASH_MISMATCH");
  }
}

async function verifyArchivedAttachment(
  dav: NextcloudDavClient,
  url: string,
  attachment: SyncAttachment,
): Promise<void> {
  try {
    await verifyAttachmentBytes(dav, url, attachment);
  } catch (error) {
    if (error instanceof PermanentSyncError) {
      throw new Error(`DOCUMENT_${error.code}`);
    }
    throw error;
  }
}

async function verifyIncomingAttachments(
  dav: NextcloudDavClient,
  incomingUrl: string,
  packet: SyncPackage,
): Promise<void> {
  if (!packet.attachments.length) return;

  const attachmentDir = dav.childUrl(incomingUrl, `${packet.package_id}.attachments`);
  if (!(await dav.exists(`${attachmentDir}/`))) {
    throw new PermanentSyncError("ATTACHMENT_DIRECTORY_MISSING");
  }

  for (const attachment of packet.attachments) {
    const sourceUrl = dav.childUrl(attachmentDir, attachment.object_name);
    if (!(await dav.exists(sourceUrl))) {
      throw new PermanentSyncError("ATTACHMENT_MISSING");
    }
    await verifyAttachmentBytes(dav, sourceUrl, attachment);
  }
}

async function assertDeviceAndPermission(
  client: PoolClient,
  packet: SyncPackage,
  nextcloudUserId: string,
): Promise<void> {
  const deviceResult = await client.query<DeviceRow & { app_user_active: boolean; is_active: boolean }>(
    `SELECT d.id, d.user_id, d.nextcloud_user_id, d.key_id, d.public_key_pem,
            d.is_active, u.is_active AS app_user_active
     FROM sync_device d
     JOIN app_user u ON u.id = d.user_id
     WHERE d.id = $1
     FOR SHARE`,
    [packet.device_id],
  );
  const device = deviceResult.rows[0];
  if (!device || !device.is_active || !device.app_user_active) {
    throw new PermanentSyncError("DEVICE_NOT_AUTHORIZED");
  }
  if (device.user_id !== packet.papot_user_id || device.nextcloud_user_id !== nextcloudUserId) {
    throw new PermanentSyncError("DEVICE_IDENTITY_MISMATCH");
  }
  if (device.key_id !== packet.proof.key_id) {
    throw new PermanentSyncError("DEVICE_KEY_MISMATCH");
  }

  const permission = await client.query<{ access_level: "READ" | "WRITE" }>(
    `SELECT access_level
     FROM user_module_permission
     WHERE user_id = $1 AND module_key = 'capture'`,
    [packet.papot_user_id],
  );
  if (permission.rows[0]?.access_level !== "WRITE") {
    throw new PermanentSyncError("NO_CAPTURE_WRITE_PERMISSION");
  }
}

async function findAppliedPackage(client: PoolClient, packet: SyncPackage): Promise<AppliedRow | null> {
  const result = await client.query<AppliedRow>(
    `SELECT package_id, request_sha256, result_json
     FROM sync_received_package
     WHERE package_id = $1
        OR (operation_type = $2 AND client_request_id = $3)
     ORDER BY CASE WHEN package_id = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [packet.package_id, packet.operation, packet.client_request_id],
  );
  return result.rows[0] ?? null;
}

async function recoverAppliedResult(pool: Pool, packet: SyncPackage): Promise<AppliedResult | null> {
  const client = await pool.connect();
  try {
    const existing = await findAppliedPackage(client, packet);
    if (!existing) return null;
    if (existing.request_sha256 !== syncBusinessRequestHash(packet)) {
      throw new PermanentSyncError("IDEMPOTENCE_CONFLICT");
    }
    return { captureId: captureIdFromResult(existing.result_json), duplicate: true };
  } finally {
    client.release();
  }
}

async function applyPackageToDatabase(
  pool: Pool,
  packet: SyncPackage,
  nextcloudUserId: string,
): Promise<AppliedResult> {
  const payloadHash = syncPackagePayloadHash(packet);
  const requestHash = syncBusinessRequestHash(packet);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await assertDeviceAndPermission(client, packet, nextcloudUserId);

    const existing = await findAppliedPackage(client, packet);
    if (existing) {
      if (existing.request_sha256 !== requestHash) {
        throw new PermanentSyncError("IDEMPOTENCE_CONFLICT");
      }
      const captureId = captureIdFromResult(existing.result_json);
      await client.query("COMMIT");
      return { captureId, duplicate: true };
    }

    const capture = await createCaptureWithClient(
      {
        ...packet.payload,
        clientRequestId: packet.client_request_id,
      },
      packet.papot_user_id,
      client,
    );
    if (!capture.created) throw new PermanentSyncError("CLIENT_REQUEST_ALREADY_USED");

    for (const attachment of packet.attachments) {
      await client.query(
        `INSERT INTO capture_attachment(
           id, capture_entry_id, file_name, content_type, size_bytes, sha256, nextcloud_path
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          attachment.attachment_id,
          capture.id,
          attachment.file_name,
          attachment.content_type,
          attachment.size_bytes,
          attachment.sha256,
          attachmentTargetPath(capture.id, attachment),
        ],
      );
    }

    const resultJson = { capture_id: capture.id };
    await client.query(
      `INSERT INTO sync_received_package(
         package_id, client_request_id, schema_version, app_version, operation_type,
         papot_user_id, device_id, payload_sha256, request_sha256, package_created_at, result_json
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
      [
        packet.package_id,
        packet.client_request_id,
        packet.schema_version,
        packet.app_version,
        packet.operation,
        packet.papot_user_id,
        packet.device_id,
        payloadHash,
        requestHash,
        new Date(packet.created_at),
        JSON.stringify(resultJson),
      ],
    );

    await client.query("COMMIT");
    return { captureId: capture.id, duplicate: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function archiveAttachments(
  dav: NextcloudDavClient,
  syncRootUrl: string,
  incomingUrl: string,
  packet: SyncPackage,
  captureId: string,
): Promise<void> {
  if (!packet.attachments.length) return;

  const sourceDir = dav.childUrl(incomingUrl, `${packet.package_id}.attachments`);
  const targetDir = await dav.ensurePath(syncRootUrl, ["documents", "captures", captureId]);

  for (const attachment of packet.attachments) {
    const sourceUrl = dav.childUrl(sourceDir, attachment.object_name);
    const targetUrl = dav.childUrl(targetDir, attachment.object_name);

    if (await dav.exists(targetUrl)) {
      await verifyArchivedAttachment(dav, targetUrl, attachment);
      continue;
    }
    if (!(await dav.exists(sourceUrl))) {
      throw new Error("ATTACHMENT_RECOVERY_SOURCE_MISSING");
    }

    await dav.move(sourceUrl, targetUrl, false);
    await verifyArchivedAttachment(dav, targetUrl, attachment);
  }

  await dav.delete(sourceDir, true);
}

function responseJson(value: Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeAck(
  dav: NextcloudDavClient,
  ackUrl: string,
  packet: SyncPackage,
  result: AppliedResult,
): Promise<void> {
  const url = dav.childUrl(ackUrl, `${packet.package_id}.json`);
  await dav.putFinalizedJson(
    url,
    responseJson({
      schema_version: SYNC_SCHEMA_VERSION,
      package_id: packet.package_id,
      client_request_id: packet.client_request_id,
      operation: packet.operation,
      status: "RECEIVED_BY_PAPOT",
      acknowledged_at: new Date().toISOString(),
      duplicate: result.duplicate,
      result: { capture_id: result.captureId },
    }),
  );
}

async function writePermanentError(
  dav: NextcloudDavClient,
  errorUrl: string,
  packetFileName: string,
  packet: SyncPackage | null,
  code: string,
): Promise<void> {
  const responseName = `${packetFileName.slice(0, -5)}.json`;
  await dav.putFinalizedJson(
    dav.childUrl(errorUrl, responseName),
    responseJson({
      schema_version: SYNC_SCHEMA_VERSION,
      package_id: packet?.package_id ?? null,
      client_request_id: packet?.client_request_id ?? null,
      status: "ERROR",
      code,
      occurred_at: new Date().toISOString(),
    }),
  );
}

async function processPacketFile(
  pool: Pool,
  dav: NextcloudDavClient,
  nextcloudUserId: string,
  syncRootUrl: string,
  device: DeviceRow,
  zones: DeviceZones,
  packetFileName: string,
): Promise<void> {
  const packetUrl = dav.childUrl(zones.incoming, packetFileName);
  let packet: SyncPackage | null = null;

  try {
    packet = parsePacket(await dav.getText(packetUrl));
    if (packetFileName !== `${packet.package_id}.json`) {
      throw new PermanentSyncError("PACKAGE_FILENAME_MISMATCH");
    }
    if (packet.device_id !== device.id || packet.papot_user_id !== device.user_id) {
      throw new PermanentSyncError("DEVICE_IDENTITY_MISMATCH");
    }
    if (packet.proof.key_id !== device.key_id) {
      throw new PermanentSyncError("DEVICE_KEY_MISMATCH");
    }
    if (!verifySyncPackageSignature(packet, device.public_key_pem)) {
      throw new PermanentSyncError("INVALID_DEVICE_SIGNATURE");
    }

    let result = await recoverAppliedResult(pool, packet);
    if (!result) {
      await verifyIncomingAttachments(dav, zones.incoming, packet);
      result = await applyPackageToDatabase(pool, packet, nextcloudUserId);
    }

    await archiveAttachments(dav, syncRootUrl, zones.incoming, packet, result.captureId);
    await writeAck(dav, zones.ack, packet, result);
    await dav.delete(packetUrl, true);

    console.log(
      `[ok] package ${packet.package_id} capture ${result.captureId} ${
        result.duplicate ? "idempotent-retry" : "applied"
      }`,
    );
  } catch (error) {
    if (error instanceof PermanentSyncError) {
      await writePermanentError(dav, zones.error, packetFileName, packet, error.code);
      await dav.delete(packetUrl, true);
      if (packet) {
        const attachmentDir = dav.childUrl(zones.incoming, `${packet.package_id}.attachments`);
        await dav.delete(attachmentDir, true).catch(() => undefined);
      }
      console.warn(`[reject] ${packetFileName} code=${error.code}`);
      return;
    }

    const code = error instanceof Error ? error.message : "UNKNOWN_TRANSIENT_ERROR";
    console.error(`[retry] ${packetFileName} code=${code}`);
  }
}

async function ensureDeviceZones(
  dav: NextcloudDavClient,
  syncRootUrl: string,
  device: DeviceRow,
): Promise<DeviceZones> {
  const deviceRoot = await dav.ensurePath(syncRootUrl, [
    "users",
    device.user_id,
    "devices",
    device.id,
  ]);
  const incoming = await dav.ensurePath(deviceRoot, ["incoming"]);
  const ack = await dav.ensurePath(deviceRoot, ["ack"]);
  const error = await dav.ensurePath(deviceRoot, ["error"]);
  await dav.ensurePath(deviceRoot, ["outgoing"]);
  await dav.ensurePath(deviceRoot, ["snapshot"]);
  return { incoming, ack, error };
}

async function runOnce(pool: Pool, dav: NextcloudDavClient, syncRoot: string): Promise<void> {
  const nextcloudUserId = await dav.discoverUserId();
  const filesRoot = dav.filesRoot(nextcloudUserId);
  const syncRootUrl = await dav.ensurePath(filesRoot, [syncRoot]);

  const devicesResult = await pool.query<DeviceRow>(
    `SELECT d.id, d.user_id, d.nextcloud_user_id, d.key_id, d.public_key_pem
     FROM sync_device d
     JOIN app_user u ON u.id = d.user_id
     WHERE d.is_active = true
       AND u.is_active = true
       AND d.nextcloud_user_id = $1
     ORDER BY d.created_at, d.id`,
    [nextcloudUserId],
  );

  if (!devicesResult.rows.length) {
    console.log("[info] no active sync devices registered for this Nextcloud account");
    return;
  }

  for (const device of devicesResult.rows) {
    const zones = await ensureDeviceZones(dav, syncRootUrl, device);
    const names = await dav.listNames(zones.incoming);
    const finalizedPackets = names.filter((name) => name.endsWith(".json"));
    for (const packetFileName of finalizedPackets) {
      await processPacketFile(
        pool,
        dav,
        nextcloudUserId,
        syncRootUrl,
        device,
        zones,
        packetFileName,
      );
    }
  }
}

async function main() {
  const pool = new Pool({ connectionString: requiredEnv("DATABASE_URL") });
  const dav = new NextcloudDavClient({
    baseUrl: process.env.NEXTCLOUD_BASE_URL?.trim() || DEFAULT_BASE_URL,
    login: requiredEnv("NEXTCLOUD_LOGIN"),
    appPassword: requiredEnv("NEXTCLOUD_APP_PASSWORD"),
  });
  const syncRoot = process.env.NEXTCLOUD_SYNC_ROOT?.trim() || DEFAULT_SYNC_ROOT;
  const pollIntervalMs = Number(process.env.SYNC_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS);
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1_000) {
    throw new Error("SYNC_POLL_INTERVAL_MS must be at least 1000");
  }
  const watch = process.argv.includes("--watch");

  try {
    do {
      try {
        await runOnce(pool, dav, syncRoot);
      } catch (error) {
        const code = error instanceof Error ? error.message : "UNKNOWN_WORKER_ERROR";
        console.error(`[worker] cycle failed code=${code}`);
      }
      if (!watch) break;
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    } while (watch);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const code = error instanceof Error ? error.message : "UNKNOWN_FATAL_ERROR";
  console.error(`[fatal] sync worker stopped code=${code}`);
  process.exitCode = 1;
});
