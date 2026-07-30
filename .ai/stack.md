# Technical Stack

## Frontend
React with Vite should be used for the frontend framework, because it is fast, modern, lightweight, easy to maintain, and works well for SaaS dashboards, landing pages, AI agent interfaces, and future integrations.

## Backend
Node.js with Express should be used as the backend framework because it is simple, flexible, fast to build with, and works well with React, PostgreSQL, AI APIs, Messenger integrations, voice agents, webhooks, dashboards, and future automation workflows.

## Database
PostgreSQL should be used as the main database. It is reliable, scalable, and suitable for storing users, leads, conversations, AI agents, campaigns, funnels, social media workflows, voice call records, reports, subscriptions, tasks, and business operations data.

## Authentication
Authentication should use a local-first email and password login system managed by the AIStaff backend. User accounts, roles, permissions, sessions, and audit logs should be stored in the local PostgreSQL database. Passwords must be securely hashed, and access should be controlled by roles such as owner, admin, staff, client, and viewer. Cloudflare may protect public access through HTTPS and tunnel security, but the actual app authentication should remain inside the local AIStaff system.

## Authorization and Permissions
AIStaff should support a multi-tenant role-based access system for multiple customers who will avail the service. Each customer should have their own workspace or business account, and their users should only access their own leads, conversations, AI agents, campaigns, funnels, reports, voice records, tasks, settings, and business data.

Platform-level roles should include Owner, Super Admin, and Admin. These roles can manage the overall AIStaff platform, customers, subscriptions, system settings, global reports, and internal operations.

Customer-level roles should include Client Owner, Client Admin, Client Staff, Sales Staff, Media Buyer, Funnel Builder, Social Media Manager, AI Agent Manager, and Viewer. These roles are limited to the customer workspace they belong to.

Owner and Super Admin have full platform control. Admin manages daily platform operations. Client Owner controls their own business account. Client Admin manages users and settings inside their own workspace. Specialized roles handle assigned workflows such as sales, media buying, funnels, social media, and AI agent management. Viewer has read-only access.

The system must follow tenant isolation and least-privilege access. No customer should see another customer’s data unless explicitly allowed by platform-level admin access.

## Hosting
AIStaff will be hosted and operated locally on our own server or Mac mini. The frontend, backend, AI agent workflows, and PostgreSQL database should run on local infrastructure that we control. Cloudflare Tunnel will be used only to securely expose the local app to the internet through the official domain, without opening router ports or relying on external hosting. The goal is to keep the system self-hosted, cost-efficient, private, and fully controlled locally.

## Cloudflare Setup
Yes, Cloudflare will be used as the secure public access layer for the locally hosted AIStaff system. The app, backend, database, AI agent workflows, and internal tools should run locally on our Mac mini or local server, while Cloudflare Tunnel will expose the app through the official domain without opening router ports. Cloudflare should handle DNS, HTTPS, tunnel access, and basic protection, but it should not replace the local-first hosting strategy.

## Local Server Setup
Not specified yet.

## Backup System
Not specified yet.

## Payment Gateway
Use placeholder environment variable names only. Never store actual secrets, API keys, passwords, or tokens in this file.

## Third-Party Tools
Not specified yet.

## AI Tools and Models
Not specified yet.

## GitHub Repository
PinedaMikeB/aistaff

## Deployment Process
Not specified yet.

## Environment Variables
Use placeholder names only. Never write actual secrets, API keys, passwords, customer private data, or credentials here.

## Security Notes
Never commit secrets. Use environment variables and repository-level secret storage where needed.

## Knowledge Base Location
.ai/

## Codex Execution Rules
Before coding, Codex should read:
Before coding, Codex must read `.codex-instructions.md` and the entire `.ai` folder first, including `.ai/README.md`, `.ai/positioning.md`, `.ai/ui.md`, `.ai/stack.md`, `.ai/rules.md`, `.ai/roadmap.md`, and `.ai/learnings.md`.

Codex must use these files to understand AIStaff’s identity, design direction, technical stack, business rules, current priorities, and past lessons before making any code changes.

Codex must also inspect the actual codebase before coding. The existing codebase is the source of truth for current implementation, while the `.ai` folder is the source of truth for product direction, standards, and decisions.

For AIStaff, Codex must treat the project as a local-first, multi-tenant AI workforce platform that can support multiple customer workspaces and eventually thousands of users. Before changing authentication, database structure, permissions, customer data, AI agent workflows, reports, campaigns, funnels, voice workflows, or background jobs, Codex must consider tenant isolation, role-based access control, PostgreSQL scalability, security, backups, queues, performance, and audit logs.

If the codebase conflicts with the `.ai` documentation, Codex must report the conflict first and ask before changing major behavior.

After coding, Codex should update:
After coding, Codex must update the project memory files so ChatGPT and future Codex sessions know what changed.

Codex must update `.ai/roadmap.md` with:
- Completed work
- Affected files
- Remaining tasks
- Bugs found or fixed
- Next recommended steps
- Testing status
- Any pending decisions

Codex must update `.ai/learnings.md` if:
- Something worked well
- Something failed
- A mistake should be avoided next time
- A reusable pattern was discovered
- A possible global skill should be reviewed later

Codex must update `.ai/stack.md` only if:
- Architecture changed
- Database structure changed
- Authentication changed
- Hosting changed
- Cloudflare setup changed
- New tools, libraries, queues, workers, backups, or AI services were added

Codex must update `.ai/rules.md` only if:
- Business behavior changed
- User roles or permissions changed
- Tenant isolation changed
- Approval rules changed
- Customer access changed
- Reports, pricing, payment, or data display rules changed

Codex must update `.ai/ui.md` only if:
- Design rules changed
- Approved UI patterns changed
- Rejected UI patterns changed
- Brand colors, layout, spacing, dashboard behavior, mobile behavior, or animation rules changed

Codex must never write secrets, API keys, tokens, credentials, database dumps, customer private data, or production passwords into `.ai` files or GitHub.

Codex must not update global skills directly. Reusable discoveries should only be added under Candidate Global Skills in `.ai/learnings.md` for owner review.


## Public Positioning Source

For public-facing copy, service pages, homepage sections, CTAs, product cards, demos, pricing presentation, and customer-facing onboarding, Codex must treat `.ai/positioning.md` as the primary source of truth.

Technical implementation must support the approved positioning without weakening security, tenant isolation, human approval, or local-first architecture.
