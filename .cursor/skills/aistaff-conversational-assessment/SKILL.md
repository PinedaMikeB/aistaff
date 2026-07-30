---
name: aistaff-conversational-assessment
description: >-
  Write AIStaff Messenger Page/website assessments conversationally from tool
  facts — never canned copy. Use when changing assess_ai_fit, assessment
  formatting, organization profile personalization, or orchestrator reply
  overrides for the demo bot.
---

# AIStaff conversational assessment (no canned replies)

## When to use

- User asks to assess, analyze, visit, or check a Facebook Page or website
- Changing `assess_ai_fit`, assessment prompts, or `organizationProfile` behavior
- Fixing “robotic,” truncated, or duplicate assessment messages

## Non-negotiable rules

1. **The model writes the reply.** Code returns facts; it does not paste templates on the OpenAI path.
2. **Never copy owner examples word-for-word.** They illustrate tone and structure only.
3. **Never override** `generateAistaffOpenAIReply` output with `buildStructuredAssessmentReply` or `formattedReport`.
4. **Personalize per PSID** via `organizationProfile` — no global ministry/seeker presets.
5. Read `docs/handoff-masterplan.md` before large assessment refactors.

## Why conversational beats canned

Owners liked messages that:

- Name the real Page and website and explain **what the organization is about**
- Reflect **how they operate** and what **Messenger inquiries** they likely get
- Give an honest **fit** tied to their situation, not a generic pitch
- Explain **how life gets easier** with numbered points, **blank line between each**, title + explanation in **their** context
- Feel like **one continuous conversation** — not ALL-CAPS headers or bullet dumps
- End with **one gentle question** — not pricing unless allowed

## What to implement in code

| Do | Don't |
|----|--------|
| Return `pageFacts` + `assessment` from `assess_ai_fit` | Return `formattedReport` to copy verbatim |
| Use `buildMessengerAssessmentFormattingGuide()` in system prompt | Hardcode example paragraphs in `page-intelligence.js` for live path |
| Call `set_organization_profile` after Page review | Hardcode WOTG/ministry language globally |
| Allow `splitAssessmentMessengerParts` for UX (2 bubbles) | `enforceShortReply` on assessment replies |
| Keep principles in `src/aistaff-assessment-principles.js` | Duplicate style rules in multiple files |

## Tool workflow

1. `check_facebook_page` / `check_website` — public facts only
2. `set_organization_profile` — operations, typical inquiries, pain points, benefit **angles** (not final copy)
3. `assess_ai_fit` — fit score, signals, missed opportunities, benefit angles
4. Model writes Part A (review paragraph) and optionally Part B (spaced numbered benefits)

## Prompt source of truth

`src/aistaff-assessment-principles.js` — update here first, then wire into:

- `buildAistaffSystemPrompt` in `aistaff-demo.js`
- `assessAiFitTool` in `aistaff-tools.js`
- `summarizeAistaffToolResult` for `assess_ai_fit` / `run_public_preview`

## Verification

Fresh Messenger session → “Can you check my facebook page and tell me how you can help?”

- Wording is **not** identical to any example in docs
- Mentions **their** Page name and relevant operations/inquiries
- Benefits use spaced numbered points if included
- No `WHAT WE FOUND` / stiff headers unless customer asked for a formal report
