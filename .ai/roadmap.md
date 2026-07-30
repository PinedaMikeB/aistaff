# Roadmap

## Current Priorities
The current priority is to build the foundation of AIStaff as a local-first, multi-tenant AI workforce platform. The first focus is to create the core app structure, authentication, customer workspace system, role-based access control, PostgreSQL database foundation, and project memory workflow so future AI agents can be built safely and consistently.

The first working version should focus on:
1. Creating the AIStaff platform foundation
2. Setting up local-first frontend, backend, and PostgreSQL structure
3. Building user login and role-based access
4. Creating customer workspaces for multiple clients
5. Ensuring tenant isolation so each customer only sees their own data
6. Creating the first AI Sales Assistant workflow
7. Preparing the system for future AI agents such as voice sales assistant, media buying staff, funnel assistant, social media manager, reporting assistant, and operations assistant
8. Making sure Codex reads and updates the `.ai` project memory files during development

The priority is not to build every AI agent at once. The priority is to build a strong, secure, scalable foundation first.

## Standard Way to Build
Read .codex-instructions.md and the .ai folder before coding. Inspect the codebase before making implementation decisions.

## Active Tasks
Active tasks currently include:

1. Building the Project Memory Builder app
A tool that creates the `.ai` project memory files and `.codex-instructions.md` so ChatGPT and Codex can work with consistent project context.

2. Creating the AIStaff project memory
Filling out the AIStaff `.ai` files with project identity, UI direction, technical stack, business rules, roadmap, and learnings.

3. Defining AIStaff positioning
Clarifying that AIStaff is an independent AI workforce platform, not a Marga-affiliated service and not just a chatbot or sales assistant.

4. Defining the core technical foundation
Planning the local-first architecture using React with Vite, Node.js with Express, PostgreSQL, Cloudflare Tunnel, role-based access control, and multi-tenant customer workspaces.

5. Preparing the GitHub workflow
Setting up the private GitHub repository `PinedaMikeB/aistaff` to store the codebase, `.ai` project memory, Codex instructions, and development history.

6. Planning the first AIStaff platform version
The first platform version should focus on authentication, customer workspaces, tenant isolation, roles and permissions, dashboard foundation, and the first AI Sales Assistant workflow.

7. Preparing for future AI agents
The system should be designed so future agents can be added later, including voice sales assistant, media buying staff, funnel creation assistant, AI social media manager, reporting assistant, and operations assistant.

## Planned Features
Planned features include:

1. Multi-tenant customer workspace system
Each customer should have their own workspace with isolated users, leads, conversations, agents, campaigns, funnels, reports, settings, and billing data.

2. Authentication and role-based access control
The system should support secure login, password hashing, sessions or tokens, user roles, permissions, and audit logs.

3. Main dashboard
A central dashboard showing leads, conversations, AI agent activity, campaign status, funnel activity, follow-ups, reports, and recommended next actions.

4. AI Sales Assistant
An AI agent that replies to inquiries, qualifies leads, captures customer details, answers common questions, assists with quote flow, and recommends follow-up actions.

5. AI Voice Sales Assistant
A voice-based AI agent that can answer calls, qualify inquiries, collect details, summarize conversations, and escalate important calls to a human.

6. Lead management and pipeline
A system for organizing leads by status such as new, hot, warm, cold, qualified, quoted, follow-up, closed, lost, or needs human review.

7. Conversation inbox
A unified inbox for Messenger, website chat, voice summaries, and future communication channels.

8. Follow-up assistant
A workflow that tracks pending follow-ups, overdue leads, reminders, next actions, and leads at risk of being lost.

9. AI Agent Manager
A module for managing AI agents, prompts, knowledge base rules, workflows, permissions, escalation rules, and performance.

10. Knowledge base system
A place where each customer can store business information, FAQs, services, pricing rules, policies, scripts, and approved answers for AI agents.

11. Media Buying Staff module
A module to help plan campaigns, review ad performance, organize creatives, track budgets, analyze results, and suggest next actions.

12. Funnel Creation Assistant
A module to help create landing pages, lead forms, offers, CTA sections, funnel steps, and conversion-focused copy.

13. AI Social Media Manager
A module for content ideas, captions, posting calendar, creative suggestions, social media workflows, and performance notes.

14. Reporting system
Reports for leads, conversations, AI agent performance, voice calls, follow-ups, campaigns, funnels, social media, operations, subscriptions, and executive summaries.

15. Approval workflow
A system where sensitive actions such as pricing changes, public messages, ad launches, budget changes, funnel publishing, exports, and role changes require human approval.

16. Audit logs
Logs for login activity, role changes, data exports, AI actions, approvals, customer account changes, and important system events.

17. Local-first deployment system
The platform should run locally on a Mac mini or local server, with Cloudflare Tunnel used for secure public access.

18. Backup and restore system
A reliable backup process for PostgreSQL, files, configuration, and important business data.

19. Background jobs and queues
Heavy tasks such as AI processing, transcription, report generation, bulk follow-ups, campaign analysis, and file processing should run in background workers.

20. Billing and subscription management
A system for customer plans, active services, billing status, invoices, payment records, and service access control.

The first features to build should be the foundation: authentication, customer workspaces, roles and permissions, tenant isolation, database structure, dashboard shell, and the first AI Sales Assistant workflow.

## Improvements
Not specified yet.

## Bugs
No confirmed platform bugs yet because AIStaff is still in the foundation and planning stage. Known risks to watch include possible issues with tenant isolation, authentication, role-based permissions, PostgreSQL structure, local hosting, Cloudflare Tunnel setup, GitHub workflow, AI agent behavior, and background job processing once development begins.

The Project Memory Builder may still need improvement, especially autosave protection, scalability documentation, optional `.ai/scaling.md`, and safer GitHub workflow handling.

## Resolved Bugs
Nothing yet.

## Pending Decisions
Pending decisions include:

1. Final package structure and pricing
Decide the final monthly plans, setup fees, add-ons, enterprise pricing, trial policy, payment terms, and what is included in each package.

2. First AI agent to launch
The first agent is likely the AI Sales Assistant, but final scope should still be confirmed, including what it can answer, what it can qualify, and what must be escalated to a human.

3. Voice agent provider
Decide which voice stack to use for the AI Voice Sales Assistant, including TTS, STT, call handling, recording, transcription, cost limits, and Tagalog/English support.

4. AI model strategy
Decide which AI models should be used for chat, voice, reasoning, coding, summarization, reports, media buying analysis, and content generation.

5. Local server production setup
Decide the final Mac mini/local server setup, folder structure, backup drive, database location, uptime strategy, restart process, and monitoring.

6. Multi-tenant database design
Decide the final workspace/tenant structure, required tables, tenant_id rules, indexes, audit logs, and how customer data will be isolated.

7. Authentication method
Confirm whether authentication will use local email/password only, or later include Google login, magic link, or other login options.

8. GitHub workflow
Decide whether AIStaff changes should go directly to main or through branches and pull requests. Also decide how Codex should commit, push, and update `.ai` memory files.

9. Project Memory Builder improvements
Decide whether to add autosave, refresh protection, optional `.ai/scaling.md`, GitHub OAuth, global skills selector, and project editing mode.

10. Global skills system
Decide how reusable lessons from AIStaff will be promoted to global skills, who approves them, and where the global skills repository will live.

11. Dashboard first version
Decide what the first dashboard should show: leads, agents, reports, follow-ups, conversations, campaign status, voice calls, or only the most important foundation metrics.

12. Customer onboarding flow
Decide how new customers will be onboarded, what questions they answer, how their knowledge base is created, and how their first AI agent is configured.

13. Human approval workflow
Decide which AI actions require approval, how approvals appear in the dashboard, and who can approve pricing, public messages, ads, funnels, exports, and sensitive automations.

14. Data retention and privacy rules
Decide how long conversations, voice summaries, reports, logs, files, and customer data should be retained, archived, or deleted.

15. First public offer
Decide the first marketable offer: AI Sales Assistant only, AI Workforce Starter, AIStaff setup service, or a bundled sales/marketing/operations package.

## Future Ideas
Not specified yet.

## Blockers
Not specified yet.

## Next Release Plan
The next release should include the foundation needed to start building AIStaff safely and consistently.

Next release scope:

1. Project foundation
Create the initial AIStaff app structure using React with Vite for the frontend, Node.js with Express for the backend, and PostgreSQL for the database.

2. Local-first setup
Prepare the app to run locally on the Mac mini or local server, with Cloudflare Tunnel planned as the secure public access layer.

3. Project memory system
Create and finalize the `.ai` project memory folder and `.codex-instructions.md` so Codex can read the project direction before coding and update the memory after coding.

4. Authentication foundation
Build the initial login system using email/password authentication, secure password hashing, sessions or tokens, and basic account management.

5. Multi-tenant workspace foundation
Create the customer workspace or tenant structure so multiple customers can use AIStaff without mixing their data.

6. Role-based access control
Add initial roles such as Owner, Super Admin, Admin, Client Owner, Client Admin, Client Staff, Sales Staff, AI Agent Manager, Media Buyer, Funnel Builder, Social Media Manager, and Viewer.

7. Tenant isolation rules
Ensure users only see data from their own workspace unless they have approved platform-level admin access.

8. Dashboard shell
Create the first dashboard layout with placeholders for leads, AI agents, conversations, follow-ups, reports, campaigns, funnels, voice calls, and operations.

9. First AI Sales Assistant module placeholder
Prepare the first AI Sales Assistant workflow area, even if the AI logic is not fully connected yet.

10. Database base schema
Create the first database tables for users, roles, tenants/workspaces, memberships, leads, AI agents, audit logs, and basic settings.

11. Audit log foundation
Start logging important actions such as login, role changes, workspace changes, and admin activity.

12. Security rules
Make sure secrets, API keys, tokens, database credentials, and customer private data are not committed to GitHub or written into `.ai` files.

13. Memory Builder improvements
Improve the Project Memory Builder with autosave, refresh protection, optional `.ai/scaling.md`, and better GitHub workflow support.

This release should not try to build every AI agent yet. The goal is to create the secure platform foundation first, then expand into sales, voice, media buying, funnel creation, social media, reporting, and operations agents in later releases.

## Testing Checklist
Not specified yet.

## Acceptance Criteria
The current task is done when AIStaff has a working foundation that Codex, ChatGPT, and future development sessions can safely continue from.

The task is considered complete when:

1. The `.ai` project memory files are created and filled:
- `.ai/README.md`
- `.ai/ui.md`
- `.ai/stack.md`
- `.ai/rules.md`
- `.ai/roadmap.md`
- `.ai/learnings.md`

2. `.codex-instructions.md` is created at the project root and clearly tells Codex what to read before coding and what to update after coding.

3. The AIStaff project direction is clearly documented:
- AIStaff is an independent AI workforce platform.
- AIStaff is not a Marga-affiliated service.
- AIStaff is not just a chatbot.
- AIStaff supports specialized AI agents for sales, voice calls, marketing, funnels, social media, reports, customer communication, and operations.

4. The technical foundation is defined:
- React with Vite frontend
- Node.js with Express backend
- PostgreSQL database
- Local-first hosting
- Cloudflare Tunnel as the secure access layer
- Multi-tenant customer workspaces
- Role-based access control
- Tenant isolation
- Security rules
- Backup and scalability considerations

5. The first development priority is clear:
Build the secure platform foundation first before building all AI agents.

6. Codex can open the project, read the `.ai` folder, understand the current priority, create an implementation plan, and start building without needing a long manual prompt.

7. The project can be saved locally and/or committed to GitHub under the correct repository.

8. No secrets, API keys, tokens, passwords, customer private data, or production credentials are written into `.ai` files, GitHub, frontend code, or public documentation.

9. The next step is clear:
Codex should begin building the AIStaff platform foundation, starting with app structure, authentication, customer workspace system, tenant isolation, roles and permissions, database schema, dashboard shell, and the first AI Sales Assistant workflow.

## Completed Work

### Public Website Copy and Positioning Update — July 27, 2026

Completed the approved public-facing messaging update without redesigning the existing cinematic homepage.

Affected files:

- `public/index.html`
- `.ai/positioning.md`
- `.ai/roadmap.md`
- `.ai/learnings.md`

Sections updated:

- Homepage hero category, headline, supporting copy, and CTAs
- Platform introduction and connected workforce message
- Four-agent cards, statuses, descriptors, and product descriptions
- First live AIChat Sales Agent transition
- Inquiry-to-quotation workflow language
- Human approval message
- B2B sales conversation demonstration
- Structured opportunity outcomes and recommended next action
- Official `AIStaff` brand spelling in public homepage copy

Testing status:

- Static anchor and copy checks completed.
- `public/pricing-checkout.js` and `public/checkout-status.js` syntax checks remain passing.
- Live browser rendering was not available in the sandbox because local port binding was denied.

Repository note:

- The active `/Volumes/Wotg Drive Mike/GitHub/AIStaff` directory has no Git metadata, so the latest GitHub commit could not be confirmed or pulled from this local copy.

Remaining messaging tasks:

- Review the updated homepage at desktop and mobile widths in the deployed browser.
- Replace any remaining generic copy discovered in future public pages.
- Keep future-agent availability labels and human approval language consistent as new pages are added.

Conflicts found:

- No positioning or business-rule conflict was found.
- The only workflow conflict is the missing Git metadata in the active project directory.

### Four-Agent Workforce Showcase — July 27, 2026

Completed the premium animated upgrade for the existing four-agent section while preserving the approved messaging, dark cinematic theme, product statuses, and pricing behavior.

Files changed:

- `public/index.html`
- `public/style.css`
- `public/workforce-motion.js`
- `.ai/ui.md`
- `.ai/roadmap.md`
- `.ai/learnings.md`

Implementation:

- Added an asymmetric desktop composition with AIChat as the visual anchor.
- Added role-specific internal scenes for qualification, voice capture, meeting memory, and marketing insight.
- Added IntersectionObserver-based visibility state for staged reveals and motion pause outside the viewport.
- Added restrained hover lift, cyan border activation, icon response, status pulse, and controlled scene scans.
- Added tablet and mobile simplification with no offset-based card layout on small screens.
- Added reduced-motion fallbacks that keep all content visible without travel-heavy animation.

Testing status:

- JavaScript syntax checks passed for the new motion controller and existing public scripts.
- Static asset and markup checks completed.
- Live desktop/mobile browser rendering remains pending because local port binding is restricted in the current environment.

Remaining refinements:

- Review card rhythm on the deployed site using desktop, tablet, and mobile devices.
- Confirm motion performance on a slower mobile device.
- Consider adding optimized card-specific poster media only if real product clips become available.


## Confirmed Marketing Direction

The public category is confirmed:

AIStaff is the AI workforce for B2B sales conversations.

The approved primary homepage promise is:

Build a business that responds, remembers, and follows through.

The approved distinctive product principle is:

AIStaff understands the sale, not just the question.

The first public and sellable product is AIChat Sales Agent.

AIVSA, AIMA, and AI Marketing remain visible in the platform story but must be clearly labeled as in development.

The public website should communicate a large platform vision with one narrow, high-quality first product.

## Purple Cow Marketing Priority

AIStaff should become remarkable through the quality of the B2B sales conversation.

The next marketing release should demonstrate:

- Intelligent inquiry handling
- Relevant follow-up questions
- Structured requirement capture
- Missing-information detection
- Qualification status
- Quotation readiness
- Human approval
- Preserved context
- Recommended next actions
- Consistent follow-up

The goal is not to add more generic feature claims. The goal is to prove that AIStaff behaves like a trained sales coordinator rather than a chatbot.

## Active Marketing Tasks

1. Update the homepage hero with the approved positioning.
2. Clarify AIStaff as an AI workforce for B2B sales conversations.
3. Keep the four agent cards.
4. Label AIChat as Live Now.
5. Label AIVSA, AIMA, and AI Marketing as In Development.
6. Connect the four agents into one customer journey.
7. Add a clear transition into the AIChat Sales Agent product section.
8. Upgrade the sales conversation demonstration.
9. Preserve the existing premium cinematic design.
10. Update `.ai` project memory after implementation.

## Marketing Acceptance Criteria

The marketing update is complete when:

1. The hero uses “Build a business that responds, remembers, and follows through.”
2. AIStaff is clearly described as the AI workforce for B2B sales conversations.
3. AIChat is clearly the first live product.
4. Future agents are clearly labeled in development.
5. All four agents feel connected.
6. The page shows product quality rather than only claims.
7. The sales demo includes intelligent qualification and next actions.
8. Human approval remains clear.
9. The existing premium visual identity is preserved.
10. The website does not feel like a generic chatbot landing page.
