#!/usr/bin/env node
/**
 * One-time (re-runnable) cleanup to "one open case per need" (src/cases.js), 2026-10-20.
 *   node scripts/cases-cleanup.js --company <id>            dry run: prints the plan
 *   node scripts/cases-cleanup.js --company <id> --apply    applies it (customers ARE notified)
 * For each create job with a case rule (workflow_config.director.case or identify):
 * 1. sets need_key on recent requests;
 * 2. a need already saved (succeeded with a reference) -> its open cases close with that reference
 *    and live customers are told (resolve-loop.closeSameNeed);
 * 3. otherwise the newest open case stays (prefer one with a live conversation), older ones -> "replaced";
 * 4. open cases with no conversation (tests/deleted) or no collected details -> "closed".
 */
const { prisma } = require("../src/db");
const cases = require("../src/cases");
const { normalizeBlueprint, extractAnchors } = require("../src/engine-blueprint");

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const companyId = arg("--company");
const apply = process.argv.includes("--apply");
const DAYS = 7;

(async () => {
  if (!companyId) throw new Error("--company is required");
  const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000);
  const ops = await prisma.tenantEngineOperation.findMany({ where: { company_id: companyId }, include: { definition: true, mapping: { include: { integration_action: true } } } });
  for (const op of ops) {
    const action = op.mapping?.integration_action;
    if (!action || ["GET", "HEAD"].includes(action.http_method)) continue;
    const config = op.mapping.workflow_config || {};
    const blueprint = normalizeBlueprint(config, action);
    const rows = await prisma.businessOperationRequest.findMany({ where: { company_id: companyId, tenant_engine_operation_id: op.id, created_at: { gte: since }, status: { in: ["failed", "retrying", "succeeded"] } }, orderBy: { created_at: "asc" } });
    if (!rows.length) continue;
    const live = new Set((await prisma.conversation.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.conversation_id).filter(Boolean))] } }, select: { id: true } })).map((c) => c.id));
    console.log(`\n== ${op.definition.name}: ${rows.length} recent requests (${DAYS} days) ==`);
    const groups = new Map();
    for (const row of rows) {
      const key = cases.needKeyFor(op.id, config, row.requested_arguments || {});
      if (key && row.need_key !== key && apply) await prisma.businessOperationRequest.update({ where: { id: row.id }, data: { need_key: key } });
      row.need_key = key;
      if (!key) {
        if (cases.OPEN_STATUSES.includes(row.status)) {
          console.log(`  CLOSE ${cases.shortCode(row.id)} — no customer details collected (${row.created_at.toISOString()})`);
          if (apply) await close(row, "no customer details were collected (old attempt)");
        }
        continue;
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    for (const [key, list] of groups) {
      const open = list.filter((r) => cases.OPEN_STATUSES.includes(r.status));
      if (!open.length) continue;
      const saved = list.filter((r) => r.status === "succeeded").map((r) => ({ row: r, ref: r.result?.manual_reference || r.result?.linked_reference || extractAnchors(r.result?.data || {}, blueprint).reference })).filter((x) => x.ref).pop();
      const label = key.split("|").slice(1).join(" ");
      if (saved) {
        const liveOpen = open.filter((r) => live.has(r.conversation_id));
        console.log(`  NEED ${label}: already saved as ${saved.ref} (${cases.shortCode(saved.row.id)}) -> close ${open.length} open case(s) with it; tell ${liveOpen.length} live customer(s): ${liveOpen.map((r) => cases.shortCode(r.id)).join(", ") || "-"}`);
        if (apply) await require("../src/resolve-loop").closeSameNeed({ companyId, needKey: key, keepId: saved.row.id, reference: saved.ref, keepConversationId: saved.row.conversation_id, actorEmail: "cleanup", actorName: "Marga team" });
        continue;
      }
      const keep = [...open].reverse().find((r) => live.has(r.conversation_id)) || null;
      if (!keep) {
        console.log(`  NEED ${label}: ${open.length} open case(s), none with a conversation -> close all (tests/deleted)`);
        if (apply) for (const r of open) await close(r, "conversation no longer exists (test or deleted)");
        continue;
      }
      const older = open.filter((r) => r.id !== keep.id);
      console.log(`  NEED ${label}: keep ${cases.shortCode(keep.id)} open (live conversation); replace ${older.length} older: ${older.map((r) => cases.shortCode(r.id)).join(", ") || "-"}`);
      if (apply) for (const r of older) await cases.replaceCase(r, keep.id, "cleanup: one open case per need");
    }
  }
  console.log(apply ? "\nApplied." : "\nDry run only. Add --apply to do it.");
  setTimeout(() => process.exit(0), apply ? 15000 : 0);
})().catch((error) => { console.error(error); process.exit(1); });

async function close(row, note) {
  await prisma.businessOperationRequest.update({ where: { id: row.id }, data: { status: "closed", completed_at: new Date(), error_message: `Closed by cleanup: ${note}`.slice(0, 1000) } });
  await cases.addHistory(row.id, { type: "closed", by: "cleanup", note });
}
