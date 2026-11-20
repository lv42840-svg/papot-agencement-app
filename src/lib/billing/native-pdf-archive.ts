import "server-only";

import { createHash } from "node:crypto";
import { getLocalDatabase, isLocalStorageMode } from "@/lib/local-db/runtime";
import { getServerDbPool, withServerDbTransaction } from "@/lib/server-db";
import type { NativeIssuedInvoice } from "./native-issuance";

type NativeArchiveRow = {
  invoice_id: string;
  invoice_number: string;
  issued_at: string | Date;
  pdf: Buffer | Uint8Array;
  sha256: string;
};

export type NativePdfArchive = {
  number: string;
  bytes: Uint8Array;
  sha256: string;
};

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertPdf(bytes: Uint8Array): void {
  if (bytes.length < 100 || Buffer.from(bytes.subarray(0, 8)).toString("ascii") !== "%PDF-1.4") {
    throw new Error("BILLING_NATIVE_ARCHIVE_INVALID_PDF");
  }
}

function inspectArchive(row: NativeArchiveRow, invoice: NativeIssuedInvoice): NativePdfArchive {
  if (row.invoice_id !== invoice.id || row.invoice_number !== invoice.number) {
    throw new Error("BILLING_NATIVE_ARCHIVE_CONFLICT");
  }
  const storedTime = new Date(row.issued_at).toISOString();
  if (storedTime !== new Date(invoice.issuedAt).toISOString()) {
    throw new Error("BILLING_NATIVE_ARCHIVE_CONFLICT");
  }
  const bytes = Buffer.from(row.pdf);
  assertPdf(bytes);
  const sha256 = digest(bytes);
  if (sha256 !== row.sha256.trim()) {
    throw new Error("BILLING_NATIVE_ARCHIVE_HASH_MISMATCH");
  }
  return { number: row.invoice_number, bytes: new Uint8Array(bytes), sha256 };
}

/**
 * Called INSIDE BillingRepository.mutate: both the invoice number and original
 * PDF are persisted by the SAME SQLite/PG transaction. No overwrite is allowed.
 */
export async function storeOriginalNativeInvoicePdf(
  invoice: NativeIssuedInvoice,
  pdf: Uint8Array,
): Promise<NativePdfArchive> {
  assertPdf(pdf);
  const sha256 = digest(pdf);
  if (isLocalStorageMode()) {
    // getLocalDatabase is the same SQLite connection already under BEGIN IMMEDIATE
    // through mutateLocalSnapshot. A write failure rolls back the invoice number.
    const database = getLocalDatabase();
    const rows = database
      .prepare(
        "SELECT invoice_id, invoice_number, issued_at, pdf, sha256 FROM local_native_invoice_pdf_archive WHERE invoice_id = ? OR invoice_number = ?",
      )
      .all(invoice.id, invoice.number) as NativeArchiveRow[];
    if (rows.length > 1) throw new Error("BILLING_NATIVE_ARCHIVE_CONFLICT");
    if (rows.length === 0) {
      database
        .prepare(
          "INSERT INTO local_native_invoice_pdf_archive (invoice_id, invoice_number, issued_at, pdf, sha256, archived_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(invoice.id, invoice.number, invoice.issuedAt, Buffer.from(pdf), sha256, new Date().toISOString());
      return { number: invoice.number, bytes: pdf, sha256 };
    }
    const stored = inspectArchive(rows[0], invoice);
    if (stored.sha256 !== sha256) throw new Error("BILLING_NATIVE_ARCHIVE_IMMUTABLE");
    return stored;
  }
  const pool = getServerDbPool();
  return withServerDbTransaction(async (client) => {
    // ON CONFLICT DO NOTHING is used only for idempotent retries. The retrieved
    // original is verified byte-for-byte. It can NEVER be updated or replaced.
    await client.query(
      "INSERT INTO papot_native_invoice_pdf_archive (invoice_id, invoice_number, issued_at, pdf, sha256) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
      [invoice.id, invoice.number, invoice.issuedAt, Buffer.from(pdf), sha256],
    );
    const result = await client.query<NativeArchiveRow>(
      "SELECT invoice_id, invoice_number, issued_at, pdf, sha256 FROM papot_native_invoice_pdf_archive WHERE invoice_id = $1 OR invoice_number = $2",
      [invoice.id, invoice.number],
    );
    if (result.rows.length !== 1) throw new Error("BILLING_NATIVE_ARCHIVE_CONFLICT");
    const stored = inspectArchive(result.rows[0], invoice);
    if (stored.sha256 !== sha256) throw new Error("BILLING_NATIVE_ARCHIVE_IMMUTABLE");
    return stored;
  }, pool);
}

/** Historical records without an original archive must fail closed. Never regenerate as original. */
export async function loadOriginalNativeInvoicePdf(
  invoice: NativeIssuedInvoice,
): Promise<NativePdfArchive> {
  if (isLocalStorageMode()) {
    const row = getLocalDatabase()
      .prepare(
        "SELECT invoice_id, invoice_number, issued_at, pdf, sha256 FROM local_native_invoice_pdf_archive WHERE invoice_id = ?",
      )
      .get(invoice.id) as NativeArchiveRow | undefined;
    if (!row) throw new Error("BILLING_NATIVE_ARCHIVE_MISSING");
    return inspectArchive(row, invoice);
  }
  const result = await getServerDbPool().query<NativeArchiveRow>(
    "SELECT invoice_id, invoice_number, issued_at, pdf, sha256 FROM papot_native_invoice_pdf_archive WHERE invoice_id = $1",
    [invoice.id],
  );
  if (result.rows.length !== 1) throw new Error("BILLING_NATIVE_ARCHIVE_MISSING");
  return inspectArchive(result.rows[0], invoice);
}
