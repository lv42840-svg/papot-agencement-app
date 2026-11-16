#!/usr/bin/env node
"use strict";

/**
 * One-off, opt-in purge of the TWO screenshot-identified cancelled test sites.
 *
 * Run INSIDE the deployed agencement-web container:
 *   node - --preview < scripts/ops/purge-two-test-chantiers.cjs
 *   node - --apply --backup-ok --confirm=<fingerprint> < scripts/ops/purge-two-test-chantiers.cjs
 *
 * SQL uses one transaction. Physical files are MOVED to a private quarantine,
 * never unlinked. A JSON snapshot of all modified database state is written
 * before any mutation. A lost process may require manual reconciliation.
 */
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Client } = require("pg");

const TARGETS = [
  { name: "Loan Maître", client: "JULES SAS" },
  { name: "Lucien VAGINAY", client: "test" },
];
const TABLES = [
  ["papot_chantiers_state", "chantiers"],
  ["papot_commercial_state", "commercial"],
  ["papot_quotes_state", "quotes"],
  ["papot_billing_state", "billing"],
  ["papot_planning_state", "planning"],
  ["papot_entries_state", "entries"],
  ["papot_purchase_orders_state", "purchases"],
];
const ID_FIELDS = ["id", "sourceCommercialCaseId", "commercialCaseId", "clientId", "quoteId", "chantierId"];

function fail(code, detail) {
  const error = new Error(code + (detail ? ": " + detail : ""));
  error.code = code;
  throw error;
}
function compact(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim().toLocaleLowerCase("fr-FR");
}
function safeSegment(value, fallback, maxLength) {
  const cleaned = String(value ?? "").trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ").replace(/[. ]+$/g, "");
  const clipped = (cleaned || fallback).slice(0, maxLength).replace(/[. ]+$/g, "");
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(clipped)
    ? "_" + clipped : clipped || fallback;
}
function businessFolder(client, name) {
  return safeSegment(
    safeSegment(client, "Client à préciser", 90) + "_" + safeSegment(name, "Affaire", 90),
    "Affaire", 180,
  );
}
function safeRelative(value) {
  const v = String(value).replace(/\\/g, "/");
  const parts = v.split("/");
  if (!v || path.isAbsolute(v) || /^[A-Za-z]:/.test(v) ||
      parts.some(s => !s || s === "." || s === ".." || /[<>:"|?*\x00-\x1F]/.test(s))) {
    fail("UNSAFE_STORAGE_PATH", v);
  }
  return v;
}
function allPaths(object, output = []) {
  if (!object || typeof object !== "object") return output;
  if (Array.isArray(object)) {
    for (const child of object) allPaths(child, output);
  } else {
    for (const [key, child] of Object.entries(object)) {
      if (key === "storagePath" && typeof child === "string") output.push(child);
      else if (child && typeof child === "object") allPaths(child, output);
    }
  }
  return output;
}
function hasId(value, ids) {
  const encoded = JSON.stringify(value);
  return [...ids].some(id => encoded.includes(id));
}
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function digest(data) { return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 16); }
function json(data) { return JSON.stringify(data, null, 2); }

async function loadStates(client, lock) {
  const result = {};
  for (const [table, key] of TABLES) {
    const r = await client.query(
      'SELECT version, payload FROM ' + table + " WHERE scope = 'global'" + (lock ? " FOR UPDATE" : ""),
    );
    if (r.rows.length !== 1) fail("STATE_MISSING", table);
    result[key] = { ...r.rows[0], table };
  }
  return result;
}

function planFor(states, clientRows) {
  const payload = Object.fromEntries(Object.entries(states).map(([key, value]) => [key, value.payload]));
  for (const [key, field] of [
    ["chantiers", "chantiers"], ["commercial", "cases"], ["quotes", "quotes"],
    ["billing", "drafts"], ["planning", "macroAllocations"], ["entries", "entries"],
    ["purchases", "orders"],
  ]) {
    if (!Array.isArray(payload[key]?.[field])) fail("UNEXPECTED_STATE_SHAPE", key + "." + field);
  }

  const found = TARGETS.map(target => {
    const matches = payload.chantiers.chantiers.filter(item =>
      compact(item.name) === compact(target.name) &&
      compact(item.clientName) === compact(target.client));
    if (matches.length !== 1) fail("CHANTIER_MATCH_NOT_UNIQUE",
      target.name + " / " + target.client + " (trouvé " + matches.length + ")");
    if (matches[0].status !== "CANCELLED") fail("CHANTIER_NOT_CANCELLED", target.name);
    return matches[0];
  });
  if (new Set(found.map(x => x.id)).size !== 2) fail("CHANTIERS_NOT_DISTINCT");

  const siteIds = new Set(found.map(x => x.id));
  const affairIds = new Set(found.map(x => x.sourceCommercialCaseId));
  if (affairIds.size !== 2) fail("SHARED_COMMERCIAL_CASE");
  const affairs = payload.commercial.cases.filter(x => affairIds.has(x.id));
  if (affairs.length !== 2) fail("AFFAIRE_NOT_FOUND_OR_SHARED");

  const otherSites = payload.chantiers.chantiers.filter(x => !siteIds.has(x.id));
  if (otherSites.some(x => affairIds.has(x.sourceCommercialCaseId))) fail("AFFAIRE_USED_BY_OTHER_CHANTIER");

  const quotes = payload.quotes.quotes.filter(q => affairIds.has(q.commercialCaseId));
  const quoteIds = new Set(quotes.map(q => q.id));
  const drafts = payload.billing.drafts.filter(d =>
    siteIds.has(d.chantierId) || affairIds.has(d.commercialCaseId) || quoteIds.has(d.quoteId));
  if (drafts.some(d => !["DRAFT", "APPROVED"].includes(d.status))) fail("INVOICE_EXTERNALLY_ISSUED");
  for (const draft of drafts) {
    if (["invoiceNumber", "issuedAt", "externalId", "pennylaneId", "paidAt", "sentAt"]
      .some(key => draft[key] != null)) fail("INVOICE_EXTERNAL_REFERENCE", draft.id);
  }
  const selectedDraftIds = new Set(drafts.map(d => d.id));
  if (payload.billing.drafts.some(d => !selectedDraftIds.has(d.id) &&
      (siteIds.has(d.chantierId) || affairIds.has(d.commercialCaseId) || quoteIds.has(d.quoteId))))
    fail("BILLING_LINK_INCONSISTENT");
  if (payload.quotes.quotes.some(q => !quoteIds.has(q.id) && affairIds.has(q.commercialCaseId)))
    fail("QUOTE_LINK_INCONSISTENT");

  const sourceEntryIds = new Set(unique(affairs.map(x => x.sourceEntryId)));
  const linkedEntries = payload.entries.entries.filter(e =>
    sourceEntryIds.has(e.id) || affairIds.has(e.commercialCaseId));
  const entryIds = new Set(linkedEntries.map(e => e.id));
  if (payload.entries.entries.some(e => !entryIds.has(e.id) &&
      (entryIds.has(e.parentEntryId) || (e.derivedEntryIds ?? []).some(id => entryIds.has(id)))))
    fail("TASK_LINKED_FROM_ANOTHER_TASK");

  const personnelHours = (payload.planning.actualHours ?? [])
    .filter(x => siteIds.has(x.chantierId));
  if (personnelHours.length) fail("REAL_EMPLOYEE_HOURS_EXIST",
    String(personnelHours.length) + " lignes d'heures enregistrées");
  if (hasId(payload.purchases.orders, new Set([...siteIds, ...affairIds, ...quoteIds])))
    fail("PURCHASE_ORDER_REFERENCES_CHANTIER");

  const clientIds = new Set(unique([
    ...affairs.map(a => a.clientId),
    ...quotes.map(q => q.model?.clientId),
    ...drafts.map(d => d.clientId),
  ]));
  const remainingAffairs = payload.commercial.cases.filter(x => !affairIds.has(x.id));
  const remainingQuotes = payload.quotes.quotes.filter(x => !quoteIds.has(x.id));
  const remainingDrafts = payload.billing.drafts.filter(x => !selectedDraftIds.has(x.id));
  const remainingEntries = payload.entries.entries.filter(x => !entryIds.has(x.id));
  const clientDependencies = [
    ...remainingAffairs, ...remainingQuotes, ...remainingDrafts,
    ...remainingEntries, ...payload.purchases.orders,
  ];
  const clientsToDelete = [...clientIds].filter(id =>
    clientRows.some(row => row.id === id) &&
    !hasId(clientDependencies, new Set([id])));
  const clientsKept = [...clientIds].filter(id => !clientsToDelete.includes(id));

  const rest = {
    chantiers: { ...payload.chantiers, chantiers: otherSites },
    commercial: { ...payload.commercial, cases: remainingAffairs },
    quotes: { ...payload.quotes, quotes: remainingQuotes },
    billing: { ...payload.billing, drafts: remainingDrafts },
    planning: { ...payload.planning,
      macroAllocations: payload.planning.macroAllocations.filter(x => !siteIds.has(x.chantierId)),
      provisionalAllocations: (payload.planning.provisionalAllocations ?? [])
        .filter(x => !affairIds.has(x.caseId)),
      chantierOrder: (payload.planning.chantierOrder ?? []).filter(id => !siteIds.has(id)),
      provisionalOrder: (payload.planning.provisionalOrder ?? []).filter(id => !affairIds.has(id)),
      actualHours: (payload.planning.actualHours ?? []).filter(x => !siteIds.has(x.chantierId)),
      dailyAssignments: (payload.planning.dailyAssignments ?? [])
        .filter(x => !siteIds.has(x.chantierId)),
    },
    entries: { ...payload.entries,
      entries: remainingEntries,
      notifications: (payload.entries.notifications ?? [])
        .filter(n => !entryIds.has(n.entryId)),
    },
  };
  const deletingIds = new Set([
    ...siteIds, ...affairIds, ...quoteIds, ...selectedDraftIds, ...entryIds,
    ...clientsToDelete,
  ]);

  // Prevent silent dangling relations in any of the preserved business objects.
  for (const [key, value] of Object.entries(rest)) {
    if (hasId(value, deletingIds)) fail("OTHER_RECORD_REFERENCES_DELETION", key);
  }
  if (hasId(payload.purchases, deletingIds)) fail("PURCHASE_REFERENCE_REMAINING");
  const otherClientRows = clientRows.filter(row => !clientsToDelete.includes(row.id));
  if (hasId(otherClientRows.map(x => x.record), deletingIds))
    fail("OTHER_CLIENT_REFERENCES_DELETION");

  const siteDirs = found.map(site => {
    const folder = safeSegment(site.number || site.id.slice(0, 8), "document", 180) +
      " - " + businessFolder(site.clientName, site.name);
    return "Chantier/" + site.launchYear + "/" +
      (site.status === "ARCHIVED" ? "Archive/" : "") + folder;
  });
  const commercialDirs = affairs.map(a =>
    "Commercial/" + new Date(a.createdAt).getUTCFullYear() + "/" +
    businessFolder(a.clientName, a.name));
  const dirs = unique([...siteDirs, ...commercialDirs,
    ...quotes.map(q => "quotes/" + q.id)]).map(safeRelative);
  const linkedPaths = unique(allPaths([...affairs, ...quotes, ...linkedEntries]));
  const unsafeFiles = linkedPaths.filter(p => {
    try { safeRelative(p); return false; } catch { return true; }
  });
  if (unsafeFiles.length) fail("UNSAFE_REFERENCED_FILES", unsafeFiles.join(", "));

  const remainingPaths = allPaths([
    rest.commercial, rest.quotes, rest.entries, payload.purchases,
  ]);
  for (const directory of dirs) {
    if (remainingPaths.some(p => p.startsWith(directory + "/"))) {
      fail("SHARED_PHYSICAL_DIRECTORY", directory);
    }
  }
  // Never move a file referenced by a record outside the purge.
  const filePaths = linkedPaths.filter(p => !dirs.some(d => p.startsWith(d + "/")));
  if (filePaths.some(p => remainingPaths.includes(p))) fail("SHARED_PHYSICAL_FILE");

  const scope = {
    sites: found.map(s => ({
      id: s.id, number: s.number, name: s.name, clientName: s.clientName,
      status: s.status, affaireId: s.sourceCommercialCaseId,
    })),
    affaireIds: [...affairIds],
    devis: quotes.map(q => ({ id: q.id, status: q.status, version: q.version })),
    factures: drafts.map(d => ({ id: d.id, status: d.status, type: d.type })),
    linkedTaskIds: [...entryIds],
    clientsToDelete: clientRows.filter(c => clientsToDelete.includes(c.id))
      .map(c => ({ id: c.id, name: c.record.companyName ||
        [c.record.firstName, c.record.lastName].filter(Boolean).join(" ") })),
    clientsKept,
    planning: {
      allocations: payload.planning.macroAllocations.filter(x => siteIds.has(x.chantierId)).length,
      provisional: (payload.planning.provisionalAllocations ?? [])
        .filter(x => affairIds.has(x.caseId)).length,
      assignments: (payload.planning.dailyAssignments ?? [])
        .filter(x => siteIds.has(x.chantierId)).length,
    },
    physicalDirectories: dirs,
    looseFiles: filePaths,
  };
  const signature = digest({
    scope,
    versions: Object.fromEntries(Object.entries(states).map(([k,v]) => [k,v.version])),
    clientRowVersions: clientRows.filter(x => clientIds.has(x.id)).map(x=>[x.id,x.version]),
  });
  return { scope, signature, next: rest, clientsToDelete, dirs, filePaths };
}

async function existingSafeFiles(root, candidates, kind) {
  const list = [];
  for (const name of candidates) {
    const rel = safeRelative(name);
    const absolute = path.resolve(root, rel);
    if (!absolute.startsWith(root + path.sep)) fail("UNSAFE_FS_LOCATION");
    let info;
    try { info = await fs.lstat(absolute); }
    catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (info.isSymbolicLink()) fail("SYMLINK_FILE_BLOCKED", rel);
    if (kind === "dir" && !info.isDirectory()) fail("EXPECTED_DIRECTORY", rel);
    if (kind === "file" && !info.isFile()) fail("EXPECTED_FILE", rel);
    list.push(rel);
  }
  return list;
}

async function main() {
  const args = process.argv.slice(2);
  const applying = args.includes("--apply");
  if (args.some(a => !["--preview", "--apply", "--backup-ok"].includes(a) && !a.startsWith("--confirm=")))
    fail("INVALID_COMMAND", args.join(" "));
  if (!process.env.PAPOT_DATABASE_URL) fail("PAPOT_DATABASE_URL_MISSING");
  const db = new Client({ connectionString: process.env.PAPOT_DATABASE_URL,
    application_name: "papot-one-off-two-test-site-cleanup" });
  await db.connect();
  let inTransaction = false;
  const moved = [];
  try {
    await db.query("BEGIN");
    inTransaction = true;
    await db.query("SET LOCAL lock_timeout = '10s'");
    await db.query("SET LOCAL statement_timeout = '120s'");
    const states = await loadStates(db, applying);
    const clientResult = await db.query(
      "SELECT id::text AS id, version, record FROM papot_clients ORDER BY id" +
      (applying ? " FOR UPDATE" : ""),
    );
    const plan = planFor(states, clientResult.rows);
    // Refuse a purge that would orphan external accounting or payroll references.
    const externalTables = [
      "papot_pennylane_staging",
      "papot_payroll_preparation_state",
      "papot_monthly_labor_costs_state",
    ];
    const targetIds = [
      ...plan.scope.sites.map(s => s.id),
      ...plan.scope.affaireIds,
      ...plan.scope.devis.map(q => q.id),
      ...plan.scope.factures.map(d => d.id),
    ];
    for (const table of externalTables) {
      const sql = "SELECT COUNT(*)::int AS count FROM " + table +
        " AS checked WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) AS needle" +
        " WHERE to_jsonb(checked)::text LIKE '%' || needle || '%')";
      const checked = await db.query(sql, [targetIds]);
      if (Number(checked.rows[0].count) !== 0) {
        fail("EXTERNAL_ACCOUNTING_OR_PAYROLL_REFERENCE", table);
      }
    }
    process.stdout.write("\nPAPOT | NETTOYAGE DE DEUX CHANTIERS ANNULES\n" +
      "Mode : " + (applying ? "APPLICATION" : "PREVISUALISATION SANS MODIFICATION") + "\n" +
      json(plan.scope) + "\nEmpreinte de controle : " + plan.signature + "\n");

    if (!applying) {
      await db.query("ROLLBACK"); inTransaction = false;
      process.stdout.write("\nAUCUNE DONNEE SUPPRIMEE. Faire et verifier une sauvegarde complete " +
        "avant toute application. Les clients partages sont conserves.\n");
      return;
    }
    if (!args.includes("--backup-ok") ||
        args.find(a => a.startsWith("--confirm=")) !== "--confirm=" + plan.signature) {
      fail("APPLY_REQUIRES_BACKUP_AND_PREVIEW_FINGERPRINT");
    }
    const root = process.env.PAPOT_SERVER_FILES_ROOT;
    if (!root || !path.isAbsolute(root)) fail("PAPOT_SERVER_FILES_ROOT_MISSING");
    const rootPath = path.resolve(root);
    const quarantine = "_papot_quarantine/purge-two-tests-" +
      new Date().toISOString().replace(/[:.]/g, "-") + "-" +
      crypto.randomBytes(3).toString("hex");
    const physical = [
      ...await existingSafeFiles(rootPath, plan.dirs, "dir"),
      ...await existingSafeFiles(rootPath, plan.filePaths, "file"),
    ];
    const snapshotDirectory = path.join(rootPath, quarantine);
    await fs.mkdir(snapshotDirectory, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(snapshotDirectory, "database-before.json"),
      json({ at: new Date().toISOString(), scope: plan.scope, signature: plan.signature,
        tables: states, clients: clientResult.rows.filter(c =>
          plan.clientsToDelete.includes(c.id)) }), { flag: "wx", mode: 0o600 });

    for (const rel of physical) {
      if (moved.some(item => rel.startsWith(item.source + "/"))) continue;
      const from = path.resolve(rootPath, rel);
      const to = path.resolve(snapshotDirectory, rel);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
      moved.push({ from, to, source: rel });
    }

    // All related app records are removed together or not at all.
    for (const [key, next] of Object.entries(plan.next)) {
      const table = states[key].table;
      await db.query(
        "UPDATE " + table +
        " SET payload = $1::jsonb, version = version + 1, updated_at = NOW() WHERE scope = 'global'",
        [JSON.stringify(next)],
      );
    }
    for (const id of plan.clientsToDelete) {
      const deletion = await db.query("DELETE FROM papot_clients WHERE id = $1::uuid", [id]);
      if (deletion.rowCount !== 1) fail("CLIENT_WAS_NOT_DELETED", id);
    }
    await db.query("COMMIT");
    inTransaction = false;
    process.stdout.write("\nSUPPRESSION APPLICATIVE TERMINEE. Fichiers mis en quarantaine : " +
      snapshotDirectory + "\nVérifier PAPOT après actualisation.\n");
  } catch (error) {
    if (inTransaction) await db.query("ROLLBACK").catch(() => undefined);
    for (const { from, to } of moved.reverse()) {
      await fs.rename(to, from).catch(e =>
        console.error("RESTORE_FILE_FAILED", from, e.message));
    }
    throw error;
  } finally {
    await db.end();
  }
}

if (process.env.PAPOT_PURGE_TEST_MODE === "1") {
  module.exports = { planFor, compact, safeRelative };
} else main().catch(error => {
  console.error("\nNETTOYAGE INTERROMPU SANS SUPPRESSION CONFIRMEE : " + error.message);
  process.exitCode = 1;
});
