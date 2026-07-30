# AIStaff Demo Bot — Handoff Masterplan

## Core rule: AI writes; code gathers facts

**Never hardcode customer-facing assessment copy in application code.**  
Examples the owner likes are **style principles**, not strings to paste. The OpenAI orchestrator reads conversation + tool facts and writes fresh Messenger replies each turn.

### What went wrong (do not repeat)

- `formatConversationalReview` / `buildStructuredAssessmentReply` produced fixed sentence patterns and the orchestrator **replaced** the model’s reply with that text.
- `assess_ai_fit` returned `formattedReport` with instruction “send this verbatim.”
- Result: every customer got the same scaffolding (“based on my review of your Facebook Page…”) with only names swapped — **canned**, not consultative.

### Why the owner liked certain messages (principles, not templates)

| Principle | Bad (canned) | Good (conversational) |
|-----------|--------------|------------------------|
| Specificity | Generic “your business” | Names their Page, website, and what the org actually does |
| Operations | Feature list | How they operate and what Messenger inquiries they likely get |
| Bridge | Jump to pricing | Honest fit + how AIStaff reduces missed/slow replies **in their context** |
| Benefits | Bullets under ALL-CAPS headers | Numbered points with **blank lines between**, title + explanation in **their** words |
| Tone | Report / audit | One consultant talking to them; continuous thought; ends with one gentle question |

### Architecture (OpenAI path)

1. **Tools** collect and store facts: `check_facebook_page`, `check_website`, `set_organization_profile`, `assess_ai_fit`.
2. **`assess_ai_fit`** returns `pageFacts` + `assessment` data — **no** `formattedReport` to copy.
3. **System prompt** includes `buildMessengerAssessmentFormattingGuide()` from `src/aistaff-assessment-principles.js`.
4. **Orchestrator** does **not** override the model reply with `buildStructuredAssessmentReply`.
5. **`finalizeAistaffReply`** may split long replies into two Messenger bubbles (review paragraph, then benefits) — split on natural intro phrases only.
6. **Per-org memory**: `organizationProfile` on session/PSID — ministry/seeker language only when stored for **that** customer.

### Files to know

| File | Role |
|------|------|
| `src/aistaff-assessment-principles.js` | Single source for assessment style rules (prompt + tool instruction) |
| `src/aistaff-demo.js` | Orchestrator, system prompt, session — **no canned assessment override** |
| `src/aistaff-tools.js` | `assess_ai_fit` returns facts, not copy |
| `src/organization-profile.js` | Per-PSID profile for personalization |
| `.cursor/skills/aistaff-conversational-assessment/SKILL.md` | Agent skill — read before changing assessment behavior |

### Rule-based fallback (OpenAI off / error)

`generateAistaffRuleBasedReply` may still use `formatStructuredAssessment` as a **last resort** when `AI_PROVIDER` is not OpenAI. Do not extend that path for new features; prefer fixing OpenAI + principles.

### Checklist before shipping assessment changes

- [ ] No new fixed customer-facing strings in `page-intelligence.js` used on the OpenAI path
- [ ] `assess_ai_fit` instruction says “you write the reply,” not “send formattedReport”
- [ ] Orchestrator does not call `buildStructuredAssessmentReply` to replace model output
- [ ] Principles doc and agent skill updated if behavior changes
- [ ] Test on fresh PSID: “check my facebook page and tell me how you can help” — wording should vary and reflect actual Page data

### Deploy

- Service: `launchctl kickstart -k gui/$(id -u)/com.aistaff.api`
- Requires `OPENAI_API_KEY` + `AI_PROVIDER=openai` for orchestrator path
