# Pitch — AI Voice Employee Build Prompt

You are the senior software architect and implementation engineer for AIStaff.

Inspect the existing AIStaff repository, architecture, database, documentation, environment configuration, and current agent implementation before changing anything. Preserve existing working functionality and existing user changes.

Do not create an isolated demo. Design Pitch as a production-capable, multi-tenant AIStaff agent that shares the existing AIStaff authentication, customer accounts, permissions, billing, knowledge base, lead funnel, audit system, and admin interface.

## PROJECT CONTEXT

AIStaff contains several specialized AI employees.

1. Brandee is responsible for producing UGC videos, scripts, advertising images, and other marketing content.

2. Pitch is the AI voice employee.

The canonical name of the voice agent is **Pitch**. Inspect all references in the repository and confirm consistent naming. If any code, routes, database records, API endpoints, documentation, or customer configurations use a different name, report the inconsistency first and propose a backward-compatible alias or migration rather than a breaking rename.

## CURRENT TELEPHONY STATUS

An AIO100-1V VoLTE router and IP-PBX gateway is now running.

The VoLTE module reports READY.
The GOMO SIM is recognized.
The cellular network is online.
The SIM has an unlimited local mobile and landline call offer paid by the customer.

We do not want to use Twilio as the normal Philippine telephony provider because metered telephony would make Pitch unnecessarily expensive.

The intended Philippine call path is:

Customer telephone
→ Philippine mobile network
→ customer-provided GOMO or compatible SIM
→ AIO100 VoLTE gateway
→ SIP/RTP
→ Asterisk or FreeSWITCH
→ Pitch voice pipeline
→ AIStaff tools, knowledge, CRM, booking system, and databases

Do not assume that the router is already fully integrated simply because the SIM is online.

Create a telephony verification checklist covering:

* SIP registration
* inbound calls
* outbound calls
* bidirectional RTP audio
* supported codecs
* G.711 A-law and μ-law
* DTMF
* caller ID
* hang-up detection
* busy and no-answer events
* call transfer
* jitter and packet loss
* echo cancellation
* NAT traversal
* 15-minute stability test
* maximum concurrent cellular calls
* behavior after internet failure
* behavior after mobile signal failure
* automatic gateway reconnection
* health monitoring

Assume that one installed VoLTE module may provide only one simultaneous cellular call until the hardware documentation and actual tests prove otherwise.

Never expose the SIP gateway directly to the public internet. Design a secure connection between each customer gateway and the AIStaff voice infrastructure using WireGuard or an equivalent secure tunnel. Include firewall rules, IP allowlisting, SIP authentication, credential rotation, rate limiting, fraud detection, and alerts for abnormal outbound calling.

## PITCH PRODUCT VISION

Pitch is not merely a talking chatbot.

Pitch is a Filipino-first AI voice employee capable of serving different industries based on the customer's approved knowledge and connected tools.

Possible roles include:

* hotel receptionist
* restaurant reservation assistant
* clinic receptionist
* doctor appointment assistant
* dental clinic staff
* salon receptionist
* real estate inquiry agent
* car sales representative
* product sales representative
* government information assistant
* customer service representative
* collections reminder assistant
* personal or executive assistant
* outbound lead follow-up agent

Pitch must be configurable per customer without requiring a custom application for every deployment.

Pitch must support inbound customer calls and authorized inbound instructions from the business owner or designated administrators.

## CUSTOMER CALL CAPABILITIES

Pitch must be able to:

* answer inbound calls
* identify itself honestly as an AI assistant
* determine the caller's intent
* understand natural English, Filipino, and Taglish
* answer questions using approved business information
* explain products and services
* provide confirmed prices
* check availability
* create reservations or appointments
* reschedule appointments
* cancel appointments according to customer policy
* capture leads
* qualify leads
* categorize leads as hot, warm, cold, existing customer, support request, or not qualified
* record customer preferences
* record objections and buying signals
* ask permission for a future follow-up call
* store the permission status and its purpose
* schedule an approved follow-up
* transfer the caller to a human
* create a callback task when a human is unavailable
* send a post-call summary to authorized staff
* create a CRM timeline entry
* create a next recommended action

Pitch must not claim that a reservation, appointment, cancellation, price, discount, delivery schedule, or inventory item is confirmed until the appropriate backend tool returns a successful confirmation.

## OWNER AND ADMIN CALL CAPABILITIES

An owner or designated administrator may call Pitch and give an instruction such as:

* "Book me a hotel for Wednesday."
* "Call this customer and tell him that his appointment must be moved."
* "Ask the customer whether Friday morning or Saturday afternoon is better."
* "Follow up our hot leads from yesterday."
* "Call the customer who requested a quotation."
* "Tell the client that the doctor will not be available."
* "Find a new schedule and update the appointment."
* "Give me today's bookings."
* "Tell me which leads are most likely to buy."
* "Call the people who gave us permission to follow up."

Caller ID alone is not sufficient authentication because it may be spoofed.

Build an admin authentication flow using:

* approved caller ID as the first signal
* spoken or DTMF PIN
* one-time code or app confirmation for sensitive actions
* tenant membership and role verification
* per-tool permissions
* complete audit logging
* confirmation before irreversible or financially significant actions

Create role-based permissions for owner, administrator, manager, receptionist, sales representative, viewer, and system administrator.

Pitch must repeat the interpreted instruction and obtain confirmation before performing a high-impact outbound action.

Pitch must never autonomously:

* make a payment
* disclose passwords or secrets
* accept a legal agreement
* sign a contract
* provide an unauthorized discount
* reveal another customer's information
* access another AIStaff tenant
* cancel a high-value reservation without confirmation
* provide medical diagnosis
* prescribe medication
* make an official government eligibility decision

## ARCHITECTURE REQUIREMENTS

Design Pitch as modular services with provider adapters.

Create these major components:

### 1. Telephony Gateway Layer

Responsibilities:

* SIP registration
* SIP trunk management
* inbound and outbound call routing
* tenant and phone-line resolution
* RTP media
* codec conversion
* call transfer
* DTMF
* recording controls
* call events
* gateway health monitoring
* concurrent-call enforcement

Prefer Asterisk or FreeSWITCH behind an internal service boundary. Explain the choice based on the existing repository and operational requirements.

### 2. Real-Time Audio Orchestrator

Responsibilities:

* voice activity detection
* interruption and barge-in
* silence detection
* endpointing
* turn-taking
* echo handling
* jitter buffering
* streaming transcription
* partial transcripts
* response streaming
* speech generation
* audio cancellation when the caller interrupts
* latency metrics
* graceful provider fallback

Do not wait for an unnecessarily long complete paragraph before Pitch begins speaking. Generate short, natural spoken responses.

Target these performance levels:

* first acknowledgement quickly after the caller stops
* typical simple reply with low perceived delay
* no long silence while tools execute
* short truthful progress statements such as "Let me check the available schedule."
* immediate interruption when the caller begins speaking

### 3. Speech Provider Layer

Use a provider interface rather than hardcoding one service.

Required adapters:

* Google Speech-to-Text for Filipino and Taglish testing
* Gemini TTS for Filipino and Taglish
* Kokoro local TTS for English-only calls
* mock provider for automated testing

Language routing rules:

* Detect English, Filipino, and Taglish.
* If the call is Taglish or Filipino, use the configured Gemini Filipino voice for the entire call.
* If the call is confidently English-only and the tenant allows local voice, use Kokoro.
* Do not change voice identity repeatedly within the same call.
* Allow each customer to choose a male or female voice.
* Store the chosen voice in the tenant's agent configuration.
* Allow per-tenant pronunciation dictionaries for business names, Filipino names, streets, products, doctors, and technical terms.

Before selecting production defaults, build an audio benchmark using real telephone-quality 8 kHz samples containing:

* Taglish
* pure Filipino
* Philippine English
* names
* addresses
* dates
* prices
* appointment times
* product codes
* noisy backgrounds
* weak cellular audio
* interruptions

Measure transcription accuracy, pronunciation, latency, interruption handling, and cost.

### 4. AI Brain and Orchestrator

Use the OpenAI Responses API through a model adapter.

Default model:

* gpt-5.6-luna
* reasoning effort: none
* concise spoken responses
* strict function calling
* low-latency configuration

Escalation model:

* gpt-5.6-terra
* reasoning effort: low
* use only for genuinely complex planning, ambiguity, conflicting policies, or difficult multi-tool requests

Do not use gpt-5.6-sol for ordinary telephone turns.

Do not send the entire customer knowledge base to the model on every turn.

The model must receive:

* tenant identity
* Pitch role configuration
* caller role and verified permissions
* short conversation state
* relevant retrieved knowledge passages
* available tools
* business policies
* required confirmations
* current date, time, and timezone
* language and voice style
* minimum personal data necessary for the task

Build automatic fallback and escalation rules. If the system is uncertain, Pitch must say that it needs to verify or transfer the caller. It must never invent an answer.

### 5. Knowledge Base

Use the existing PostgreSQL infrastructure. Prefer pgvector unless the repository already contains a suitable approved retrieval system.

Support these source types:

* PDF
* DOCX
* TXT
* CSV
* XLSX
* website pages
* product catalogs
* price lists
* contracts
* policies
* menus
* room types
* doctor schedules
* FAQs
* service areas
* customer-provided instructions

Each knowledge item must contain:

* tenant ID
* source document ID
* title
* document type
* version
* effective date
* expiration date when applicable
* approval status
* confidentiality level
* extracted content
* retrieval chunks
* source location
* last updated time
* uploaded by
* approved by

Only approved and currently effective information may be used in live calls.

Create document versioning, reprocessing, rollback, deactivation, and retrieval audit logs.

Never mix documents from different tenants.

### 6. Integration Hub

Do not hardcode Pitch directly to Google Calendar, Calendly, or one specific platform.

Create an internal normalized interface with provider adapters.

Required normalized capabilities:

* list resources
* list staff
* check availability
* get price
* create tentative hold
* confirm booking
* reschedule booking
* cancel booking
* retrieve booking
* create customer
* update customer
* create lead
* add note
* create task
* schedule callback
* send notification

Build adapters progressively for:

Phase 1:

* AIStaff internal booking and availability database
* Google Calendar
* webhook adapter
* CSV or admin-managed availability fallback

Phase 2:

* Microsoft Outlook or Microsoft 365 Calendar
* Calendly
* Cal.com
* customer CRM
* restaurant, clinic, hotel, or property-management systems that expose an API

Do not claim that every external system can be connected automatically. Some services may not expose all required write operations. For unsupported systems, provide:

* configurable webhook
* Zapier, Make, or n8n-compatible endpoint
* email notification fallback
* admin-confirmation queue
* AIStaff internal booking ledger

Use OAuth where available. Encrypt refresh tokens and external credentials. Never place secrets in source code, logs, transcripts, or model prompts.

### 7. Pitch Skills and Tool Registry

Implement tools as permission-controlled operations.

Examples:

* search_knowledge
* get_business_hours
* get_product
* get_price
* check_inventory
* check_availability
* hold_appointment
* confirm_appointment
* reschedule_appointment
* cancel_appointment
* create_lead
* update_lead_stage
* create_followup
* get_customer_history
* transfer_call
* notify_staff
* create_callback_task
* initiate_outbound_call
* end_call
* mark_do_not_call
* request_human_approval

Each tool must define:

* input schema
* output schema
* tenant scope
* permitted roles
* confirmation requirement
* idempotency key
* timeout
* retry policy
* audit event
* safe failure response

### 8. Lead Funnel and CRM Timeline

Every call should be capable of creating:

* contact
* organization
* call record
* transcript when allowed
* summary
* caller intent
* products or services discussed
* objections
* preferences
* lead temperature
* lead score
* consent status
* follow-up date
* assigned team member
* next recommended action
* outcome
* booking or quotation reference

Do not classify every caller as a sales lead. Support service calls, existing customers, wrong numbers, suppliers, job applicants, spam, and internal calls.

### 9. Outbound Calling

Pitch may make outbound calls only when:

* the tenant is authorized
* the initiating user has permission
* the recipient and purpose are recorded
* the customer has an appropriate lawful basis or recorded permission where required
* the number is not on the tenant's do-not-call list
* allowed calling hours are satisfied
* concurrency and rate limits are satisfied
* the outbound call is auditable

At the beginning of an outbound call Pitch must:

* identify the represented business
* identify itself as an AI assistant
* explain the purpose briefly
* confirm it is speaking to the correct person without unnecessarily exposing private information
* provide an easy opt-out

If the recipient refuses, Pitch must apologize, end the call, and record the opt-out.

### 10. Privacy, Safety, and Compliance

Build privacy by design.

Required controls:

* clear AI disclosure
* configurable call-recording disclosure
* follow-up permission capture
* consent revocation
* do-not-call list
* data-retention settings
* transcript redaction
* sensitive-data redaction
* encryption in transit and at rest
* role-based access
* tenant isolation
* audit logs
* data export
* data correction
* data deletion workflow
* breach logging
* configurable regional storage
* human escalation

The system must support Philippine Data Privacy Act obligations.

For clinics:

* Pitch may provide approved administrative information.
* Pitch may manage appointments.
* Pitch must not diagnose, prescribe, or interpret dangerous symptoms.
* Emergency or urgent statements must trigger an approved escalation script.

For government use:

* Pitch may provide information from approved official material.
* Pitch must distinguish general information from an official decision.
* Pitch must not invent requirements or determine eligibility unless an authorized deterministic system provides the result.

### 11. Admin Interface

Create or extend the Pitch admin workspace with:

* agent identity and voice
* selected languages
* role and industry template
* greeting
* business hours
* holidays
* escalation contacts
* connected phone gateways
* gateway status
* current active call
* concurrent-call limit
* calendar connections
* booking connections
* CRM connections
* knowledge documents
* document approval status
* owner and admin callers
* role permissions
* outbound permissions
* calling hours
* consent settings
* recording settings
* data retention
* call history
* transcripts
* summaries
* lead funnel
* follow-up queue
* failed tool calls
* latency
* transcription confidence
* cost per call
* AI usage
* test-call button

Create industry templates for hotel, restaurant, clinic, car sales, general sales, and general receptionist. Templates must remain editable.

### 12. Billing and Usage

Separate these concepts:

* telephony subscription paid by customer
* AI conversation minutes
* simultaneous call channels
* transcription usage
* TTS usage
* LLM token usage
* storage
* recordings
* integration costs
* outbound calls
* setup and onboarding

Do not label Pitch as completely unlimited merely because the SIM has an unlimited local call plan.

Prepare the system to support these initial plans:

**Pitch Receptionist:**

* ₱7,999 per month
* 500 AI talk minutes
* one call channel
* basic knowledge base
* basic lead capture
* one booking or calendar connection

**Pitch Business:**

* ₱14,999 per month
* 1,500 AI talk minutes
* lead qualification
* outbound follow-up
* advanced booking workflows
* one major external integration

**Pitch Pro:**

* ₱29,999 per month
* 4,000 AI talk minutes
* advanced workflows
* multiple departments
* priority support
* expanded reporting

Overage:

* configurable initial recommendation of ₱8 per AI minute

Customer-paid requirements:

* VoLTE gateway
* SIM
* mobile plan
* internet
* additional gateway or channel for simultaneous calls

Keep all plan limits configurable in the database. Do not hardcode prices in business logic.

### 13. OBSERVABILITY

Create metrics and alerts for:

* gateway online status
* SIP registration
* failed inbound calls
* failed outbound calls
* active calls
* concurrent calls
* transcription latency
* LLM first-token latency
* TTS first-audio latency
* overall response latency
* tool latency
* interruptions
* abandoned calls
* dropped calls
* provider errors
* hallucination or unsupported-answer reports
* call cost
* tenant usage
* suspicious outbound activity

Use structured logs with correlation IDs, tenant IDs, call IDs, conversation IDs, and tool-call IDs.

Do not log passwords, API keys, PINs, complete payment details, or unnecessary sensitive personal data.

### 14. RELIABILITY

Design fallback behavior for:

* OpenAI unavailable
* Google Speech-to-Text unavailable
* Gemini TTS unavailable
* Kokoro unavailable
* external calendar unavailable
* CRM unavailable
* gateway offline
* poor cellular signal
* lost internet
* database unavailable

For an external booking-system failure, Pitch must not pretend that the booking succeeded. It should create a callback or staff-review task and tell the caller the truthful status.

### 15. TESTING

Create automated tests for:

* cross-tenant isolation
* prompt injection through uploaded documents
* prompt injection spoken by caller
* unauthorized owner commands
* spoofed caller ID
* invalid PIN
* tool permission denial
* repeated booking request
* idempotent booking
* conflicting availability
* price version changes
* expired documents
* interrupted speech
* Taglish transcription
* English-only Kokoro routing
* Filipino Gemini routing
* failed provider
* opt-out
* human transfer
* emergency clinic phrase
* outbound calling hours
* simultaneous-call limit

Also prepare scripted end-to-end call scenarios for:

* hotel reservation
* restaurant reservation
* clinic appointment
* doctor rescheduling
* car sales lead
* product price inquiry
* hot-lead follow-up
* owner-requested outbound call
* cancellation requiring confirmation
* caller requesting a human

## IMPLEMENTATION PROCESS

First, inspect the existing repository and report:

* current stack
* existing database schema
* existing authentication
* existing AI agent structure
* existing knowledge base
* existing lead funnel
* existing calendar or booking integrations
* existing telephony code
* existing environment variables
* reusable components
* security concerns
* migration risks

Then create an implementation plan divided into safe phases.

Recommended phases:

**Phase 0:**

* repository inspection
* architecture decision record
* threat model
* telephony verification checklist
* data model
* provider interfaces

**Phase 1:**

* SIP test path
* one inbound call
* one outbound call
* streaming transcription
* Luna brain
* Gemini Taglish voice
* Kokoro English voice
* basic knowledge retrieval
* call logging
* manual human transfer

**Phase 2:**

* Google Calendar
* internal booking ledger
* lead funnel
* follow-up permission
* owner authentication
* controlled outbound calls

**Phase 3:**

* additional provider adapters
* billing
* industry templates
* analytics
* high availability
* multiple call channels

After reporting the inspection findings, implement the safest useful Phase 0 and Phase 1 foundation that fits the existing repository.

Do not rewrite the entire application.

Do not replace existing working architecture without evidence.

Use migrations for database changes.

Add `.env.example` entries without real credentials.

Add documentation for local development and production deployment.

Add feature flags so Pitch can be disabled without affecting the other AIStaff agents.

Maintain backward compatibility.

Run linting, type checks, tests, database validation, and the existing build before finishing.

## FINAL DELIVERABLE

At the end, provide:

1. What you discovered.
2. Architecture chosen and why.
3. Files changed.
4. Database migrations added.
5. Environment variables required.
6. What is now working.
7. Tests performed and results.
8. What still requires access to the physical AIO100 router.
9. Exact router tests Mike must perform.
10. Security and privacy issues still requiring review.
11. Phase 2 recommendation.
12. Any assumptions that must be confirmed.

The main objective is to build Pitch as a dependable Filipino-first AI voice employee, not merely an AI voice demonstration.
