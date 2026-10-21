# MASTERPLAN — Reusable Integration Blueprints for Closer

Owner: Mike Pineda. Started 2026-10-15. Authoritative repo: `/srv/apps/aistaff` on Ryzen (`ssh aistaff`).
Proving tenant: Marga Enterprises (Facebook Page "Marga Biz", company `f4c170f3-16b2-4172-82bd-b850467c41ed`,
connection "Cha" → `https://app.marga.biz/api/v1`).

## 1. Why this exists (evidence, 2026-10-15)

Marga's Closer never created a single service ticket. Of the last 20 Business Engine calls only 4 succeeded
(`find_machine`). The rest failed with:

- `machineid must be a whole number` (8×) — AIStaff sent `"2941"` or the serial number; the API wants the integer id.
- `Action field "X" is not allowed` (4×) — AIStaff sent fields the API never declared.

Root causes in AIStaff:

1. Every engine tool advertised the same ~22 generic engine fields (`toolSchemaForOperation`), not the mapped API action's fields.
2. Every generic field was typed `string`; nothing converted `"2941"` → `2941`.
3. The OpenAPI details (types, enums, required, descriptions) were imported but not shown to the model.
4. The write sequence (dryRun → customer confirmation → commit with Idempotency-Key) was left to the model, and the
   confirmation call had to resend byte-identical arguments.
5. The workflow (identify machine → request type → machine status → confirm → reference) lived only in prose.

Found on the Marga side: `createServiceTicket` labelled `fieldWorkMachineStatusId` 1–4 as
IN STOCK / FOR DELIVERY / DELIVERED / USED, while every Marga app screen uses
1 Running / Print OK, 2 Running / Print Problem, 3 Down / No Print, 4 Running / Best Mode Only.

## 2. Core rule: map, don't rename

- **Operations are standard** (engine catalog: `find_machine`, `create_service_request`, `create_booking`, …).
  This keeps workflows, reports, approvals and the future onboarding skill reusable.
- **Fields follow the client's API exactly** — names, types, enums, required, descriptions come from the mapped
  OpenAPI action. Generic engine fields are only the intake form for tenants with no API.
- **Anchors** are the few meanings AIStaff itself needs: `reference`, `status`, `schedule_reference`, `record_id`.
  Each blueprint says which response field holds each anchor (auto-detected when the API uses common names).

## 3. The blueprint (per tenant, per mapped operation)

Stored on `engine_operation_mappings.workflow_config` (JSON, versioned through the audit log), editable in
Settings › Business Engines. Shape:

```json
{
  "value_labels": { "fieldworkmachinestatusid": { "1": "Running / Print OK", "3": "Down / No Print" } },
  "field_notes":  { "machineid": "Numeric machine id returned by Find Machine, not the serial number." },
  "steps":        ["machineid", "category", "fieldworkmachinestatusid", "description"],
  "derived":      [ { "field": "priority", "from": "fieldworkmachinestatusid",
                      "map": { "3": "critical", "2": "high", "4": "high", "1": "normal" }, "default": "normal" } ],
  "hidden":       ["dryrun", "idempotency_key"],
  "anchors":      { "reference": "reference", "status": "status", "schedule_reference": "scheduleReference" }
}
```

Everything above is tenant configuration, visible and editable — no tenant-specific code.

## 4. Runtime behaviour (code = platform invariants only)

1. **Tool schema** for a mapped operation = the mapped action's input schema, minus hidden/derived fields,
   with value labels and field notes added to descriptions. All parameters optional at the schema level so the
   model can submit what it has; required-ness is enforced by the server and reported back.
2. **Safety net**: coerce types (`"2941"`→`2941`, `"true"`→`true`, case-insensitive enum match), drop undeclared
   fields (reported back as `ignored_fields`), explain invalid values (e.g. a serial where an integer id is required).
3. **Draft accumulation**: for write operations the server keeps a per-conversation draft, so the model never has to
   resend everything; each call merges new values.
4. **Facts back to the model** (`tools return facts, the model writes words`):
   `needs_information` → `collected`, `missing`, `next` (field, description, allowed values with labels).
5. **Safe write sequence** (when the action supports it): dry run (automatic, side-effect free) →
   `awaiting_customer_confirmation` with the dry-run facts and a `confirmation_id` → on a later customer turn the
   model sends only `_confirmation_id` → commit with server-generated `Idempotency-Key` → `executed` with anchors.
6. Per-provider schema cleanup (Gemini: no type unions, string-only enums, no `additionalProperties`).

## 5. Onboarding paths (all end in the same blueprint)

- **Path A — has OpenAPI**: import → AI drafts mappings + blueprint and flags gaps (unlabelled enums, missing
  descriptions, no dry run) → admin answers → dry-run simulation → live.
- **Path B — no API**: blueprint drafted from the business description/KB wizard using the generic engine fields;
  AIStaff is the system of record and issues its own reference numbers (future phase).
- **Path C — API added later**: re-run Path A; workflow steps survive, fields switch to the API.

## 6. "AIStaff-ready API" standard (for clients who can change their API)

OpenAPI with descriptions on every field and enum value; `dryRun` on every write; `Idempotency-Key` on every write;
one response shape (`ok`, `facts`, `reference`, `status`); lookups by what customers know (serial, phone, order no.).

## 7. Phases and status

| Phase | Work | Status |
|---|---|---|
| 1 | Per-operation tools from the mapped API action, coercion, unknown-field drop, provider cleanup | done 2026-10-15 |
| 2 | Safe write sequence (dry run → confirm → commit, auto Idempotency-Key, anchors) | done 2026-10-15 |
| 3 | Blueprint config (labels, notes, steps, derived fields, anchors) + admin editor (JSON) | done 2026-10-15 |
| 4 | Marga API: correct status labels, enum descriptions, return scheduled date, inventory label | done 2026-10-15 |
| 5 | Marga blueprint + dry-run simulations done; ONE LIVE TICKET still to run with owner | partly done |
| 6 | Model comparison (Gemini, GPT, local Qwen) incl. OpenAI-compatible local provider; speed later | pending |
| 7 | Path B (AIStaff as record keeper with its own references) | pending |
| 8 | Onboarding skill (draft → flag → review → test → handoff) once Marga is proven | pending |

Rollback: `~/aistaff-backup-before-blueprint-20261015.tgz` on Ryzen; per-file `*.backup-blueprint-20261015`.

## 8. Next session (handoff)

1. Live test with the owner: message the Marga Biz Page, confirm, check the SR- reference in Marga, then cancel it if it was a test.
2. Friendlier blueprint editor (form instead of JSON) once the shape is proven on a second tenant.
3. Phase 6: add an OpenAI-compatible provider (local Qwen via `qwen.aistaff.click`) and run `scripts/simulate-closer-conversation.js` per model; measure speed.
4. Re-importing Marga's OpenAPI would refresh action descriptions, but check that it preserves mappings and blueprints before doing it.
