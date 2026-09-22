# AIStaff Engine Platform - Phase 1 Baseline

Baseline captured on 2026-09-22 from the Ryzen `aistaff` server and the
Fedora `bosgame` AI compute host. This document records the protected starting
point before the reusable Engine Platform is introduced.

## Recovery Package

The restricted recovery package is stored on Ryzen at:

`/srv/automations/backups/aistaff-engine-platform/20260922-193343`

It contains:

- AIStaff PostgreSQL custom-format dump and restore manifest
- n8n PostgreSQL custom-format dump and restore manifest
- Margabase PostgreSQL custom-format dump and restore manifest
- Eight n8n workflow exports
- Two encrypted n8n credential exports
- A complete AIStaff Git bundle containing all refs
- AIStaff and Margabase table inventories
- Recent Service Monitoring Engine execution inventory
- Marga operational file hashes and API route candidates
- Runtime health evidence and SHA-256 checksums

All three database archives were validated with `pg_restore --list`. The
recovery package is readable only by the server account that created it.

## Source Baseline

- Repository: `/srv/apps/aistaff`
- Starting branch: `feat/brandee-image-creative-approaches`
- Starting commit: `93570d0`
- Working tree before Phase 1: clean
- Foundation branch: `codex/engine-platform-foundation`

The operational Marga application is `/srv/apps/marga-app`. It is a deployed
application directory rather than a Git checkout on Ryzen. The separate
`/srv/apps/marga-biz` repository is the public website and has a large existing
dirty worktree; Phase 1 did not modify it.

## Ryzen Control Plane

- AMD Ryzen 7 5700G, 8 cores / 16 threads
- 62 GiB RAM, approximately 59 GiB available at baseline
- Approximately 772 GiB disk space available
- AIStaff Express application healthy on local port 3000
- n8n 2.38.7 healthy on local port 5678
- n8n PostgreSQL healthy
- Margabase PostgreSQL 16 and PostgREST healthy
- Cloudflare route for `automation.aistaff.click` returned HTTP 200

The machine has sufficient capacity for the initial AIStaff control plane,
PostgreSQL, Redis, n8n main process, and a small worker pool.

## Existing AIStaff Foundations

The current Prisma schema already provides reusable multi-tenant foundations:

- `Company` as the tenant/workspace record
- Tenant-scoped `User` records
- Platform roles separate from tenant roles
- `Subscription` records connected to companies
- `CompanySetting`
- `AdminAuditLog`
- Existing customer, conversation, lead, booking, quotation, and webhook data

The Engine Platform should extend these records. It must not introduce a second
tenant or user system.

Missing platform records to add in later phases include engine definitions,
engine versions, tenant engine assignments, connections, connector operations,
field mappings, executions, execution attempts, scheduled jobs, event outbox
records, and engine usage records.

## Existing Service Engine Baseline

The active n8n workflow is:

- ID: `SMEENGINEOVERVIEW`
- Name: `SME 00 - Service Monitoring Engine`
- State: active

Seven other exported workflows were preserved. The latest captured successful
Service Engine execution was execution 20 on 2026-09-21. It completed in about
3.6 seconds. Older execution records were preserved in the n8n database dump
and inventory.

The current workflow is a useful visual prototype but directly contains email,
AI endpoint, persistence, scheduling, and integration concerns. Later phases
will preserve the visible numbered-node learning experience while moving
tenant identity, authorization, execution state, credentials, and connector
selection into AIStaff.

## Marga Onboarding Baseline

The operational Marga application already exposes useful service boundaries:

- `GET/POST /portal-api/tickets`
- `GET /portal-api/tickets/:id`
- `POST /portal-api/tickets/:id/messages`
- Customer, company, branch, and device lookup routes
- Toner request routes
- Service history and summary routes
- Staff open-schedule and acknowledgement routes
- Administrative ticket assignment, status, and location routes
- `/api/marga-care`
- `/api/master-schedule-write`

Relevant Margabase records already exist:

- `marga.companies`
- `marga.branches`
- `marga.machines`
- `marga.portal_service_tickets`
- `marga.portal_ticket_events`
- `marga.portal_ticket_messages`
- `marga.portal_toner_requests`
- `marga.service_schedules`
- `marga.field_visit_events`
- `marga.staff_schedule_acknowledgements`
- `app_meta.master_schedule_snapshot`

The current Master Schedule write function allows controlled PATCH and DELETE
operations but not creation. A later Marga Connector must use or add an
authenticated backend operation for creating a service schedule. AIStaff must
not write directly to Marga database tables.

## Bosgame AI Compute Baseline

- AMD Ryzen AI Max+ 395, 16 cores / 32 threads
- 117 GiB RAM
- Radeon 8060S integrated GPU
- Qwen LAN proxy service is enabled and listening on port 18080
- The proxy only accepts localhost and Ryzen `192.168.254.125`
- The proxy forwards to local port 46607
- No Qwen/llama model server was listening on port 46607 at baseline
- Ryzen therefore received a connection reset when requesting `/v1/models`
- The proxy user service has `Linger=no`, so logout/reboot persistence is not
  yet sufficient for production use
- Multiple Piper training processes were active and should be reviewed before
  production inference workloads are assigned

This is a recorded starting condition, not a Phase 1 repair. Model service
hardening belongs to the Model Router phase.

## Phase 1 Safety Decisions

- No production database records were changed.
- No n8n workflow was modified, activated, or deactivated.
- No Marga source file or API was modified.
- No test email was sent and no live Marga service request was created.
- The last known successful Service Engine execution was recorded instead of
  generating a new customer-facing transaction.
- The dirty `marga-biz` website worktree was left untouched.

## Exit Status

Phase 1 is complete when the recovery package checksums verify, AIStaff remains
healthy, n8n remains healthy, the active workflow is unchanged, and the AIStaff
repository is on `codex/engine-platform-foundation` with a clean worktree after
this document is committed or intentionally left ready for Phase 2.
