import "server-only";

import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { getServerDbPool } from "../server-db/pool";
import { sha256Bytes, type ServerFileStore } from "../server-files/storage";
import { parseCommercialPayload, type CommercialDocument } from "./domain";

const COMMERCIAL_DOCUMENT_FILES_CUTOVER_DOMAIN = "commercial_document_files";
const COMMERCIAL_DOCUMENT_FILES_CUTOVER_SOURCE = "nextcloud:documents/commercial";
const COMMERCIAL_DOCUMENT_FILES_CUTOVER_LOCK_ID = 7_332_170_416_238_510;

type CutoverMarkerRow = {
  source_hash: string;
  record_count: number;
};

type DocumentManifestItem = {
  caseId: string;
  document: CommercialDocument;
};

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export type LegacyCommercialDocumentReader = (document: CommercialDocument) => Promise<Buffer>;

async function findCutoverMarker(queryable: Queryable): Promise<CutoverMarkerRow | null> {
  const result = await queryable.query<CutoverMarkerRow>(
    `
      SELECT source_hash, record_count
      FROM papot_domain_cutovers
      WHERE domain = $1
    `,
    [COMMERCIAL_DOCUMENT_FILES_CUTOVER_DOMAIN],
  );
  return result.rows[0] ?? null;
}

function documentManifest(
  payload: ReturnType<typeof parseCommercialPayload>,
): DocumentManifestItem[] {
  return payload.cases
    .flatMap((item) =>
      item.documents.map((document) => ({
        caseId: item.id,
        document,
      })),
    )
    .sort((left, right) => {
      const caseOrder = left.caseId.localeCompare(right.caseId);
      if (caseOrder !== 0) return caseOrder;
      return left.document.id.localeCompare(right.document.id);
    });
}

export function commercialDocumentManifestHash(
  manifest: ReadonlyArray<DocumentManifestItem>,
): string {
  const canonical = manifest.map(({ caseId, document }) => ({
    caseId,
    id: document.id,
    storagePath: document.storagePath,
    sizeBytes: document.sizeBytes,
    sha256: document.sha256,
  }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

async function readCurrentManifest(client: PoolClient): Promise<DocumentManifestItem[]> {
  const result = await client.query<{ payload: unknown }>(
    "SELECT payload FROM papot_commercial_state WHERE scope = 'global'",
  );
  const row = result.rows[0];
  if (!row) throw new Error("COMMERCIAL_STORAGE_NOT_INITIALIZED");
  return documentManifest(parseCommercialPayload(row.payload));
}

async function verifyServerCopy(
  store: ServerFileStore,
  document: CommercialDocument,
): Promise<boolean> {
  try {
    const bytes = await store.readBytes(document.storagePath, document.sha256);
    if (bytes.length !== document.sizeBytes) {
      throw new Error("COMMERCIAL_DOCUMENT_CUTOVER_INTEGRITY_MISMATCH");
    }
    return true;
  } catch (error) {
    if (error instanceof Error && error.message === "SERVER_FILE_NOT_FOUND") return false;
    if (error instanceof Error && error.message === "SERVER_FILE_INTEGRITY_MISMATCH") {
      throw new Error("COMMERCIAL_DOCUMENT_CUTOVER_INTEGRITY_MISMATCH");
    }
    throw error;
  }
}

async function copyLegacyDocument(
  store: ServerFileStore,
  document: CommercialDocument,
  readLegacy: LegacyCommercialDocumentReader,
): Promise<void> {
  if (await verifyServerCopy(store, document)) return;

  const bytes = await readLegacy(document);
  if (bytes.length !== document.sizeBytes || sha256Bytes(bytes) !== document.sha256) {
    throw new Error("COMMERCIAL_DOCUMENT_CUTOVER_INTEGRITY_MISMATCH");
  }

  try {
    await store.writeBytes(document.storagePath, bytes);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "SERVER_FILE_EXISTS") throw error;
  }

  if (!(await verifyServerCopy(store, document))) {
    throw new Error("COMMERCIAL_DOCUMENT_CUTOVER_VALIDATION_FAILED");
  }
}

export async function ensureCommercialDocumentFilesCutover(params: {
  pool?: Pool;
  store: ServerFileStore;
  readLegacy: LegacyCommercialDocumentReader;
}): Promise<void> {
  const pool = params.pool ?? getServerDbPool();
  if (await findCutoverMarker(pool)) return;

  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await client.query("SELECT pg_advisory_lock($1)", [COMMERCIAL_DOCUMENT_FILES_CUTOVER_LOCK_ID]);
    lockAcquired = true;
    if (await findCutoverMarker(client)) return;

    const manifest = await readCurrentManifest(client);
    const sourceHash = commercialDocumentManifestHash(manifest);

    for (const { document } of manifest) {
      await copyLegacyDocument(params.store, document, params.readLegacy);
    }

    const currentManifest = await readCurrentManifest(client);
    if (commercialDocumentManifestHash(currentManifest) !== sourceHash) {
      throw new Error("COMMERCIAL_DOCUMENT_CUTOVER_SNAPSHOT_CHANGED");
    }

    await client.query(
      `
        INSERT INTO papot_domain_cutovers (
          domain,
          source,
          source_hash,
          record_count
        )
        VALUES ($1, $2, $3, $4)
      `,
      [
        COMMERCIAL_DOCUMENT_FILES_CUTOVER_DOMAIN,
        COMMERCIAL_DOCUMENT_FILES_CUTOVER_SOURCE,
        sourceHash,
        manifest.length,
      ],
    );
  } finally {
    if (lockAcquired) {
      await client
        .query("SELECT pg_advisory_unlock($1)", [COMMERCIAL_DOCUMENT_FILES_CUTOVER_LOCK_ID])
        .catch(() => undefined);
    }
    client.release();
  }
}
