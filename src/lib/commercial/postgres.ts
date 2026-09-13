import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { db } from "@/lib/db/pool";
import {
  COMMERCIAL_STATUS_LABELS,
  commercialStatusSchema,
  type CommercialCase,
  type CommercialClient,
  type CommercialDocument,
  type CommercialPayload,
  type CommercialStatus,
} from "./domain";

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalText = (max: number) => z.string().trim().max(max).optional().default("");

export const commercialPostgresMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().trim().min(1).max(240),
    existingClientId: z.string().uuid().optional(),
    clientName: optionalText(240),
    siteLabel: optionalText(240),
    reviewDate: dateOnlySchema,
    sourceEntryId: z.string().uuid().optional(),
    description: optionalText(4000),
    nextAction: optionalText(2000),
  }),
  z.object({
    action: z.literal("updateDetails"),
    caseId: z.string().uuid(),
    name: z.string().trim().min(1).max(240),
    existingClientId: z.string().uuid().optional(),
    clientName: optionalText(240),
    siteLabel: optionalText(240),
    contactName: optionalText(160),
    contactPhone: optionalText(80),
    contactEmail: optionalText(240),
    description: optionalText(4000),
    nextAction: optionalText(2000),
  }),
  z.object({
    action: z.literal("setStatus"),
    caseId: z.string().uuid(),
    status: commercialStatusSchema.exclude(["LOST", "ABANDONED"]),
    reviewDate: dateOnlySchema.optional(),
    expectedConfirmationDate: dateOnlySchema.optional(),
    plannedInstallDate: dateOnlySchema.optional(),
  }),
  z.object({
    action: z.literal("recordFollowUp"),
    caseId: z.string().uuid(),
    summary: z.string().trim().min(1).max(3000),
    nextStatus: commercialStatusSchema,
    nextDate: dateOnlySchema.optional(),
    plannedInstallDate: dateOnlySchema.optional(),
    closingReason: optionalText(2000),
  }),
  z.object({
    action: z.literal("linkSourceEntry"),
    caseId: z.string().uuid(),
    sourceEntryId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("close"),
    caseId: z.string().uuid(),
    status: z.enum(["LOST", "ABANDONED"]),
    reason: optionalText(2000),
  }),
  z.object({ action: z.literal("reopen"), caseId: z.string().uuid(), reviewDate: dateOnlySchema }),
]);

export type CommercialPostgresMutation = z.infer<typeof commercialPostgresMutationSchema>;
export type CommercialActor = { userId: string; displayName: string };
export type ActiveCommercialUser = { id: string; displayName: string };

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

async function history(
  client: PoolClient,
  affairId: string,
  actor: CommercialActor,
  type: string,
  summary: string,
  now: Date,
) {
  await client.query(
    `INSERT INTO affair_history(id, affair_id, event_type, actor_user_id, actor_name, summary, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), affairId, type, actor.userId, actor.displayName, summary, now],
  );
}

async function ensureClient(
  client: PoolClient,
  existingClientId: string | undefined,
  clientName: string | undefined,
  actor: CommercialActor,
): Promise<string | null> {
  if (existingClientId) {
    const found = await client.query("SELECT id FROM business_client WHERE id = $1", [existingClientId]);
    if (!found.rowCount) throw new Error("COMMERCIAL_CLIENT_NOT_FOUND");
    return existingClientId;
  }
  const name = text(clientName);
  if (!name) return null;
  const existing = await client.query<{ id: string }>(
    "SELECT id FROM business_client WHERE lower(display_name) = lower($1) ORDER BY updated_at DESC LIMIT 1",
    [name],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const id = randomUUID();
  await client.query(
    `INSERT INTO business_client(id, client_type, display_name, created_by_user_id, updated_by_user_id)
     VALUES ($1, 'COMPANY', $2, $3, $3)`,
    [id, name, actor.userId],
  );
  return id;
}

async function ensurePrimaryContact(
  client: PoolClient,
  affairId: string,
  currentContactId: string | null,
  clientId: string | null,
  name: string | undefined,
  phone: string | undefined,
  email: string | undefined,
): Promise<string | null> {
  if (!clientId) return null;
  const contactName = text(name);
  const contactPhone = text(phone);
  const contactEmail = text(email);
  if (!contactName && !contactPhone && !contactEmail) return null;
  if (currentContactId) {
    await client.query(
      `UPDATE client_contact SET display_name = $2, phone = $3, email = $4, updated_at = now()
       WHERE id = $1 AND client_id = $5`,
      [currentContactId, contactName ?? "Contact", contactPhone, contactEmail, clientId],
    );
    return currentContactId;
  }
  const id = randomUUID();
  await client.query(
    `INSERT INTO client_contact(id, client_id, display_name, email, phone, is_primary)
     VALUES ($1, $2, $3, $4, $5, true)`,
    [id, clientId, contactName ?? "Contact", contactEmail, contactPhone],
  );
  await client.query("UPDATE affair SET primary_contact_id = $2 WHERE id = $1", [affairId, id]);
  return id;
}

function statusDates(
  status: Exclude<CommercialStatus, "LOST" | "ABANDONED">,
  params: { reviewDate?: string; expectedConfirmationDate?: string; plannedInstallDate?: string },
) {
  if ((status === "PISTE" || status === "WAITING" || status === "CHIFFRAGE") && !params.reviewDate) {
    throw new Error("COMMERCIAL_REVIEW_DATE_REQUIRED");
  }
  if (status === "LIKELY" && !params.expectedConfirmationDate) {
    throw new Error("COMMERCIAL_CONFIRMATION_DATE_REQUIRED");
  }
  if (status === "CONFIRMED" && !params.plannedInstallDate) {
    throw new Error("COMMERCIAL_INSTALL_DATE_REQUIRED");
  }
  return {
    reviewDate: status === "PISTE" || status === "WAITING" || status === "CHIFFRAGE" ? params.reviewDate ?? null : null,
    expectedConfirmationDate: status === "LIKELY" ? params.expectedConfirmationDate ?? null : null,
    plannedInstallDate: status === "CONFIRMED" ? params.plannedInstallDate ?? null : undefined,
  };
}

async function setStatus(
  client: PoolClient,
  affairId: string,
  status: Exclude<CommercialStatus, "LOST" | "ABANDONED">,
  params: { reviewDate?: string; expectedConfirmationDate?: string; plannedInstallDate?: string },
  actor: CommercialActor,
  now: Date,
) {
  const current = await client.query<{ status: CommercialStatus }>("SELECT status FROM affair WHERE id = $1 FOR UPDATE", [affairId]);
  if (!current.rows[0]) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
  if (current.rows[0].status === "LOST" || current.rows[0].status === "ABANDONED") throw new Error("COMMERCIAL_CASE_CLOSED");
  const dates = statusDates(status, params);
  await client.query(
    `UPDATE affair SET status = $2, review_date = $3, expected_confirmation_date = $4,
       planned_install_date = COALESCE($5, planned_install_date),
       confirmed_at = CASE WHEN $2 = 'CONFIRMED' THEN $6 ELSE confirmed_at END,
       closed_at = NULL, closing_reason = NULL, updated_by_user_id = $7, updated_by_name = $8, updated_at = $6
     WHERE id = $1`,
    [affairId, status, dates.reviewDate, dates.expectedConfirmationDate, dates.plannedInstallDate ?? null, now, actor.userId, actor.displayName],
  );
  if (current.rows[0].status !== status) {
    await history(
      client,
      affairId,
      actor,
      "STATUS_CHANGED",
      `Statut : ${COMMERCIAL_STATUS_LABELS[current.rows[0].status]} → ${COMMERCIAL_STATUS_LABELS[status]}.`,
      now,
    );
  }
}

export async function applyCommercialMutationInDatabase(
  input: CommercialPostgresMutation,
  actor: CommercialActor,
): Promise<{ focusCaseId: string }> {
  const client = await db.connect();
  const now = new Date();
  let focusCaseId = "";
  try {
    await client.query("BEGIN");

    if (input.action === "create") {
      if (input.sourceEntryId) {
        const duplicate = await client.query("SELECT id FROM affair WHERE source_entry_id = $1", [input.sourceEntryId]);
        if (duplicate.rowCount) throw new Error("COMMERCIAL_SOURCE_TASK_ALREADY_LINKED");
      }
      const clientId = await ensureClient(client, input.existingClientId, input.clientName, actor);
      focusCaseId = randomUUID();
      await client.query(
        `INSERT INTO affair(
          id, client_id, source_entry_id, name, site_label, description, next_action, status,
          review_date, created_by_user_id, updated_by_user_id, created_by_name, updated_by_name, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'PISTE',$8,$9,$9,$10,$10,$11,$11)`,
        [focusCaseId, clientId, input.sourceEntryId ?? null, input.name, text(input.siteLabel), text(input.description), text(input.nextAction), input.reviewDate, actor.userId, actor.displayName, now],
      );
      await history(
        client,
        focusCaseId,
        actor,
        "CREATED",
        input.sourceEntryId
          ? `Affaire créée depuis une entrée PAPOT. Prochaine revue le ${input.reviewDate}.`
          : `Affaire créée. Prochaine revue le ${input.reviewDate}.`,
        now,
      );
    } else if (input.action === "updateDetails") {
      focusCaseId = input.caseId;
      const current = await client.query<{ primary_contact_id: string | null; client_id: string | null; status: CommercialStatus }>(
        "SELECT primary_contact_id, client_id, status FROM affair WHERE id = $1 FOR UPDATE",
        [input.caseId],
      );
      if (!current.rows[0]) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
      if (current.rows[0].status === "LOST" || current.rows[0].status === "ABANDONED") throw new Error("COMMERCIAL_CASE_CLOSED");
      const clientId = await ensureClient(client, input.existingClientId, input.clientName, actor);
      await client.query(
        `UPDATE affair SET client_id = $2, name = $3, site_label = $4, description = $5, next_action = $6,
         updated_by_user_id = $7, updated_by_name = $8, updated_at = $9 WHERE id = $1`,
        [input.caseId, clientId, input.name, text(input.siteLabel), text(input.description), text(input.nextAction), actor.userId, actor.displayName, now],
      );
      const contactId = await ensurePrimaryContact(
        client,
        input.caseId,
        current.rows[0].client_id === clientId ? current.rows[0].primary_contact_id : null,
        clientId,
        input.contactName,
        input.contactPhone,
        input.contactEmail,
      );
      if (!contactId && current.rows[0].primary_contact_id) {
        await client.query("UPDATE affair SET primary_contact_id = NULL WHERE id = $1", [input.caseId]);
      }
      await history(client, input.caseId, actor, "DETAILS_UPDATED", "Informations de l’affaire mises à jour.", now);
    } else if (input.action === "setStatus") {
      focusCaseId = input.caseId;
      await setStatus(client, input.caseId, input.status, input, actor, now);
    } else if (input.action === "recordFollowUp") {
      focusCaseId = input.caseId;
      await history(client, input.caseId, actor, "FOLLOW_UP", `Relance : ${input.summary}`, now);
      if (input.nextStatus === "LOST" || input.nextStatus === "ABANDONED") {
        const current = await client.query<{ status: CommercialStatus }>("SELECT status FROM affair WHERE id = $1 FOR UPDATE", [input.caseId]);
        if (!current.rows[0]) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
        await client.query(
          `UPDATE affair SET status = $2, review_date = NULL, expected_confirmation_date = NULL,
           closed_at = $3, closing_reason = $4, updated_by_user_id = $5, updated_by_name = $6, updated_at = $3
           WHERE id = $1`,
          [input.caseId, input.nextStatus, now, text(input.closingReason), actor.userId, actor.displayName],
        );
        await history(client, input.caseId, actor, "CLOSED", `${COMMERCIAL_STATUS_LABELS[current.rows[0].status]} → ${COMMERCIAL_STATUS_LABELS[input.nextStatus]}.`, now);
      } else if (input.nextStatus === "LIKELY") {
        await setStatus(client, input.caseId, "LIKELY", { expectedConfirmationDate: input.nextDate }, actor, now);
      } else if (input.nextStatus === "CONFIRMED") {
        await setStatus(client, input.caseId, "CONFIRMED", { plannedInstallDate: input.plannedInstallDate }, actor, now);
      } else if (input.nextStatus === "FOLLOW_UP") {
        await setStatus(client, input.caseId, "FOLLOW_UP", {}, actor, now);
      } else {
        await setStatus(client, input.caseId, input.nextStatus, { reviewDate: input.nextDate }, actor, now);
      }
    } else if (input.action === "linkSourceEntry") {
      focusCaseId = input.caseId;
      const linked = await client.query("SELECT id FROM affair WHERE source_entry_id = $1 AND id <> $2", [input.sourceEntryId, input.caseId]);
      if (linked.rowCount) throw new Error("COMMERCIAL_SOURCE_TASK_ALREADY_LINKED");
      const updated = await client.query(
        `UPDATE affair SET source_entry_id = $2, updated_by_user_id = $3, updated_by_name = $4, updated_at = $5
         WHERE id = $1 RETURNING id`,
        [input.caseId, input.sourceEntryId, actor.userId, actor.displayName, now],
      );
      if (!updated.rowCount) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
      await history(client, input.caseId, actor, "SOURCE_ENTRY_LINKED", "Entrée PAPOT rattachée à l’affaire.", now);
    } else if (input.action === "close") {
      focusCaseId = input.caseId;
      const current = await client.query<{ status: CommercialStatus }>("SELECT status FROM affair WHERE id = $1 FOR UPDATE", [input.caseId]);
      if (!current.rows[0]) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
      await client.query(
        `UPDATE affair SET status = $2, review_date = NULL, expected_confirmation_date = NULL,
         closed_at = $3, closing_reason = $4, updated_by_user_id = $5, updated_by_name = $6, updated_at = $3
         WHERE id = $1`,
        [input.caseId, input.status, now, text(input.reason), actor.userId, actor.displayName],
      );
      await history(client, input.caseId, actor, "CLOSED", `${COMMERCIAL_STATUS_LABELS[current.rows[0].status]} → ${COMMERCIAL_STATUS_LABELS[input.status]}.`, now);
    } else if (input.action === "reopen") {
      focusCaseId = input.caseId;
      const updated = await client.query<{ status: CommercialStatus }>(
        `UPDATE affair SET status = 'PISTE', review_date = $2, closed_at = NULL, closing_reason = NULL,
         confirmed_at = NULL, updated_by_user_id = $3, updated_by_name = $4, updated_at = $5
         WHERE id = $1 AND status IN ('LOST','ABANDONED') RETURNING status`,
        [input.caseId, input.reviewDate, actor.userId, actor.displayName, now],
      );
      if (!updated.rowCount) throw new Error("COMMERCIAL_CASE_NOT_CLOSED");
      await history(client, input.caseId, actor, "REOPENED", `Affaire rouverte en Piste. Prochaine revue le ${input.reviewDate}.`, now);
    }

    await client.query("COMMIT");
    return { focusCaseId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listActiveCommercialUsers(): Promise<ActiveCommercialUser[]> {
  const result = await db.query<{ id: string; display_name: string }>(
    "SELECT id, display_name FROM app_user WHERE is_active = true ORDER BY display_name",
  );
  return result.rows.map((row) => ({ id: row.id, displayName: row.display_name }));
}

export async function loadCommercialPayloadFromDatabase(): Promise<CommercialPayload> {
  const [clientsResult, affairsResult, historyResult, documentsResult] = await Promise.all([
    db.query(`SELECT id, client_type, display_name, email, phone FROM business_client ORDER BY lower(display_name), id`),
    db.query(`
      SELECT a.*, c.display_name AS client_name,
             cc.display_name AS contact_name, cc.phone AS contact_phone, cc.email AS contact_email
      FROM affair a
      LEFT JOIN business_client c ON c.id = a.client_id
      LEFT JOIN client_contact cc ON cc.id = a.primary_contact_id
      ORDER BY a.updated_at DESC, a.id`),
    db.query(`SELECT * FROM affair_history ORDER BY occurred_at, id`),
    db.query(`SELECT * FROM affair_document ORDER BY uploaded_at, id`),
  ]);

  const histories = new Map<string, CommercialCase["history"]>();
  for (const row of historyResult.rows) {
    const list = histories.get(row.affair_id) ?? [];
    list.push({
      id: row.id,
      type: row.event_type,
      at: iso(row.occurred_at) as string,
      actorName: row.actor_name,
      summary: row.summary,
    } as CommercialCase["history"][number]);
    histories.set(row.affair_id, list);
  }

  const documents = new Map<string, CommercialDocument[]>();
  for (const row of documentsResult.rows) {
    const list = documents.get(row.affair_id) ?? [];
    list.push({
      id: row.id,
      fileName: row.file_name,
      contentType: row.content_type,
      sizeBytes: Number(row.size_bytes),
      sha256: row.sha256,
      storagePath: row.storage_path,
      category: row.category,
      versionLabel: row.version_label,
      variantLabel: row.variant_label,
      isCurrent: row.is_current,
      isSignedQuote: row.legacy_signed_quote,
      legacySignedQuote: row.legacy_signed_quote,
      uploadedAt: iso(row.uploaded_at) as string,
      uploadedByName: row.uploaded_by_name,
    });
    documents.set(row.affair_id, list);
  }

  const clients: CommercialClient[] = clientsResult.rows.map((row) => ({
    id: row.id,
    type: row.client_type,
    displayName: row.display_name,
    email: row.email,
    phone: row.phone,
  }));

  const cases: CommercialCase[] = affairsResult.rows.map((row) => ({
    id: row.id,
    sourceEntryId: row.source_entry_id,
    clientId: row.client_id,
    primaryContactId: row.primary_contact_id,
    name: row.name,
    clientName: row.client_name,
    siteLabel: row.site_label,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    description: row.description,
    nextAction: row.next_action,
    status: row.status,
    reviewDate: row.review_date ? String(row.review_date).slice(0, 10) : null,
    expectedConfirmationDate: row.expected_confirmation_date ? String(row.expected_confirmation_date).slice(0, 10) : null,
    plannedInstallDate: row.planned_install_date ? String(row.planned_install_date).slice(0, 10) : null,
    confirmedAt: iso(row.confirmed_at),
    closedAt: iso(row.closed_at),
    closingReason: row.closing_reason,
    documents: documents.get(row.id) ?? [],
    createdAt: iso(row.created_at) as string,
    createdByName: row.created_by_name,
    updatedAt: iso(row.updated_at) as string,
    updatedByName: row.updated_by_name,
    history: histories.get(row.id) ?? [],
    quoteOwnerName: null,
    quoteDueDate: null,
    quoteSentAt: null,
    quoteNotes: "",
    provisionHours: { be: 0, workshop: 0, install: 0 },
  }));

  return { schemaVersion: 2, clients, cases };
}

export async function loadCommercialCaseFromDatabase(caseId: string): Promise<CommercialCase | null> {
  const payload = await loadCommercialPayloadFromDatabase();
  return payload.cases.find((item) => item.id === caseId) ?? null;
}

export async function registerAffairDocuments(
  caseId: string,
  documents: CommercialDocument[],
  actor: CommercialActor,
): Promise<void> {
  if (documents.length === 0) return;
  const client = await db.connect();
  const now = new Date();
  try {
    await client.query("BEGIN");
    const affair = await client.query("SELECT id FROM affair WHERE id = $1 FOR UPDATE", [caseId]);
    if (!affair.rowCount) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
    for (const document of documents) {
      if (document.isCurrent) {
        await client.query("UPDATE affair_document SET is_current = false WHERE affair_id = $1 AND category = $2", [caseId, document.category]);
      }
      await client.query(
        `INSERT INTO affair_document(
          id, affair_id, file_name, content_type, size_bytes, sha256, storage_path, category,
          version_label, variant_label, is_current, legacy_signed_quote, uploaded_by_user_id, uploaded_by_name, uploaded_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [document.id, caseId, document.fileName, document.contentType, document.sizeBytes, document.sha256, document.storagePath,
         document.category, document.versionLabel, document.variantLabel, document.isCurrent,
         document.legacySignedQuote || document.isSignedQuote || false, actor.userId, actor.displayName, new Date(document.uploadedAt)],
      );
    }
    await history(client, caseId, actor, "DOCUMENTS_ADDED", `${documents.length} document${documents.length > 1 ? "s" : ""} ajouté${documents.length > 1 ? "s" : ""}.`, now);
    await client.query("UPDATE affair SET updated_by_user_id = $2, updated_by_name = $3, updated_at = $4 WHERE id = $1", [caseId, actor.userId, actor.displayName, now]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function findAffairDocument(caseId: string, documentId: string): Promise<CommercialDocument | null> {
  const result = await db.query(`SELECT * FROM affair_document WHERE affair_id = $1 AND id = $2`, [caseId, documentId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    storagePath: row.storage_path,
    category: row.category,
    versionLabel: row.version_label,
    variantLabel: row.variant_label,
    isCurrent: row.is_current,
    isSignedQuote: row.legacy_signed_quote,
    legacySignedQuote: row.legacy_signed_quote,
    uploadedAt: iso(row.uploaded_at) as string,
    uploadedByName: row.uploaded_by_name,
  };
}
