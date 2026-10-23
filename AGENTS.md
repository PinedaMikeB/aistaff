# AIStaff production authority

- Public hostname: `https://aistaff.click`
- Authoritative SSH host: `aistaff` (hostname `aistaff`)
- Authoritative repository: `/srv/apps/aistaff`
- Runtime service: user unit `aistaff-api.service`
- Service wrapper: `/home/mike/srv/ryzen-start-aistaff-api.sh`
- Service working directory: `/srv/apps/aistaff`
- Node port: `3000`
- Runtime: `NODE_ENV=production`
- Environment file: `/srv/apps/aistaff/.env`
- Cloudflare ingress: `/home/mike/.cloudflared/marga-api.yml` routes
  `aistaff.click`, `www.aistaff.click`, and `aistaff-api.marga.biz` to
  `http://127.0.0.1:3000`.
- Database: PostgreSQL `aistaff_click` at `127.0.0.1:5432`, loaded from the
  protected environment file.

Do not build, migrate, deploy, or overwrite production from a Mac-local checkout unless the owner explicitly changes the source of truth. Inspect the server worktree first and port only the requested narrow changes. Preserve unrelated dirty files.

For deployment, apply a reviewed narrow patch on the authoritative host, back up PostgreSQL before migrations, run Prisma validation/migration/client generation as needed, run tests, restart with `systemctl --user restart aistaff-api.service`, then verify the real public hostname and service logs. Use the repository binaries (`./node_modules/.bin/prisma`), not a network-resolved `npx` package.

## Tenant custom-app connections

Deployed on Ryzen 7 on 2026-10-13 through migration
`20261013133000_tenant_integration_connections`, then upgraded on 2026-10-14
through `20261013235500_smart_integration_discovery`. The tenant UI is under
Settings > Connections & Actions. API credentials use the dedicated protected
`INTEGRATION_ENCRYPTION_SECRET`; do not replace it or print it. The admin script
URLs carry the `20261014-smart-discovery` cache version because public
static assets are cached for four hours.

The production workflow is Discover → Authenticate → Test → Review Actions →
Activate. Discovery accepts a website or API-documentation URL, checks bounded
same-origin public OpenAPI locations/references, supports JSON and YAML, blocks
private/loopback/link-local targets, and never invents endpoints. All imported
actions start disabled. Destructive and outbound-communication actions enforce
staff approval and explicit high-impact acknowledgment server-side. A safe test
uses only a read operation with no required inputs; host reachability alone is
reported as unverified, not successful authentication.

Connections, actions, execution history, engine assignments, OAuth state, and
all queries are tenant-scoped. Configuration routes require a tenant admin or
an audited platform-assist session. Supported live connector type is
REST/OpenAPI. GraphQL, SOAP, webhook-only connectors, and private-network
connectors remain deferred and must not be advertised as working.

Rollback artifacts are under
`/srv/apps/aistaff/.codex-backups/20261013T2346-universal-connections-preupgrade`;
the rollback branch is
`codex/rollback-universal-connections-20261013-2346`.

See `docs/DEPLOYMENT.md` and `docs/CUSTOMER-UPDATES-HANDOFF.md`.

## AI behavior must be instruction-driven

Do not hard-code conversational or business decisions that the AI is expected
to make. In particular, do not add tenant-name checks, keyword/regex routing,
identifier-specific branches, or silent pre-processing that forces an action
such as a lookup, booking, ticket, quotation, or escalation.

AI behavior must come from the saved instruction hierarchy, enabled Business
Engine capabilities, approved action mappings and clear tool descriptions. If
the AI makes a poor decision, first inspect the effective prompt and available
tools, then correct the authoritative instruction/configuration record or tool
description and test the resulting behavior. Do not patch the symptom with a
tenant-specific code branch.

Code may enforce non-negotiable platform invariants such as authentication,
tenant isolation, permission boundaries, approval requirements, input
validation, privacy, rate limits and idempotency. Those controls must not
replace the AI's instruction-driven choice of what legitimate business action
to take.

AI instructions must not live only as hidden source-code constants. Platform
defaults may be seeded by code, but the current effective instruction must be
stored as a versioned record, visible in the appropriate admin screen and
loaded from that record at runtime. Keep each instruction in one authoritative
layer; do not duplicate the same rule across AI Studio, tenant instructions,
Knowledge Base and Business Engines.

## Tenant Business Engines

Deployed on Ryzen 7 on 2026-10-13 through migration
`20261013204500_business_engines`. Tenant administrators control the feature
under Settings > Business Engines. The four catalog engines are Customer
Service, Booking, Sales, and Finance; all are inactive by default, including
for Marga Enterprises.

Engine activation, per-field behavior, operation policy, fallback behavior,
and action mappings are tenant-scoped. Connecting an application never
activates an engine. The guided setup recommends action and field mappings,
shows only uncertain matches for review, safely tests each chosen connection,
and activates only the jobs the administrator accepts. Engine operations are
exposed to Closer only when both the engine and operation are enabled and the
operation has an enabled mapping to a tenant connection action. Raw connection
actions that are engine-mapped are hidden from direct model use.

The editable instruction hierarchy is deliberate and visible:

1. platform-wide instructions in AI Studio;
2. tenant-wide Closer Instructions in Settings > General;
3. work-specific Engine Instructions in Settings > Business Engines;
4. tenant facts in Knowledge Base;
5. live tool results as runtime context, not another saved instruction source.

Engine Instructions start from the platform engine default but a tenant admin
may save a tenant-specific version. Every save creates a new
`PromptRevision`; rollback activates an earlier version, reset returns to the
platform default without deleting history, and only inactive versions may be
deleted. Runtime uses the active tenant engine instruction when present and
otherwise uses the current platform snapshot. Activating or reconfiguring an
engine must never clear its selected instruction. Keep a rule in the narrowest
authoritative layer and do not duplicate the same rule in Closer Instructions,
Engine Instructions, and Knowledge Base.

Approval policy strength is `automatic` < `customer_confirmation` <
`staff_approval` < `staff_only`; a tenant cannot weaken an operation below its
platform minimum. Connection credentials remain in Settings > Connections &
Actions and continue to use `INTEGRATION_ENCRYPTION_SECRET`. Business Engine
draft forms never store credentials.

The Customer Service catalog includes machine ID, serial number, machine
lookup, and machine-service detail concepts. Recommendation logic must not
invent serial lookup: if the connected API does not document it, the job stays
with staff until the customer's IT team exposes that function. Read actions
may be automatic; writes and customer communication retain confirmation or
staff-approval minimums; destructive actions stay unavailable unless explicitly
approved by platform policy. Feature tests are in
`test/business-engines.test.js` and `test/engine-recommendations.test.js`.

## Integration blueprints (2026-10-15)

Mapped Business Engine operations expose the mapped API action's own fields
("map, don't rename"), not the generic engine field list. Per-tenant blueprint
JSON lives in `engine_operation_mappings.workflow_config` and is edited in
Settings › Business Engines › job › Blueprint (audited). It may only contain
`value_labels`, `field_notes`, `steps`, `derived`, `hidden`, `anchors`, and
may only reference fields of the mapped action. Write operations accumulate a
per-conversation draft, run the API dry run when available, and commit only
the stored arguments with a server-generated Idempotency-Key after a later-turn
`_confirmation_id`. Design and phases: `docs/MASTERPLAN-integration-blueprints.md`.
Simulate without committing: `node scripts/simulate-closer-conversation.js '["msg1","msg2"]'`
(`SIM_MODEL=gemini:gemini-3.7-flash` to try another model, `COMPANY_ID=` for another tenant).

## Email Engine (2026-10-22)

Bulk email for tenants (Settings > Email Engine) and platform limits (Platform > Email Engine). Worker starts with background jobs. Never send to addresses on email_suppressions; never re-send a recipient automatically. See docs/EMAIL-ENGINE-HANDOFF.md.
Outreach (one-to-one prospecting) lives in src/email-outreach.js: never weaken its guards (separate domain, held personal addresses, footer with source + STOP, privacy check, reply reading).
