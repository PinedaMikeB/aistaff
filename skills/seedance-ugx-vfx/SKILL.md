---
name: seedance-ugx-vfx
description: Create cinematic UGX-style video transformations from user-provided footage. Use when the user wants to turn real video into a photoreal VFX shot, add or morph a creature/effect, replace the environment, preserve a person’s identity or lip-sync, design a video-to-video prompt, or adapt a transformation workflow for Seedance, Higgsfield, Runway, Kling, Veo, or another video model.
---

# UGX video transformation

Use this skill for video-to-video work where the source footage remains recognizable and the requested effect is added with believable tracking, lighting, scale, and sound. Treat “UGX-style” as the user’s desired cinematic transformation aesthetic: grounded real footage, a sharp visual reveal, practical-feeling VFX, and a clean social-video payoff. Do not assume it is a named model or proprietary format.

## Core rule

Preserve the source first, then change one named thing.

Lock the person, face, identity, wardrobe, performance, framing, lens character, camera path, timing, and original dialogue unless the user explicitly asks to change one of them. State the requested change separately. Repeat the most fragile lock at the end of the action, usually “face and identity unchanged; everything else matches the source.”

Do not invent what is in footage. If the clip is available locally, inspect it before writing a prompt: duration, frame rate, aspect ratio, camera movement, subject, wardrobe, lighting direction, and important beats. If it is not available or described clearly enough, ask for the footage or a concise description before making a precise prompt.

## Workflow

1. Classify the transformation:
   - Add or morph one element in the existing plate.
   - Replace the environment around a preserved subject.
   - Create a reveal intro or timed camera move around a preserved take.
   - Preserve dialogue, lip-sync, or a recognizable performance.

2. Classify difficulty:
   - L1: locked or slow camera; world swap or simple overlay.
   - L2: moving camera or an element that changes shape, position, or behavior.
   - L3: handheld cinematic footage with parallax, occlusion, relighting, and a creature or complex effect.

3. Extract the source constraints. Use exact values when known: runtime, fps, aspect, camera move, subject position, dialogue time, and the effect’s start/end beat.

4. Choose the lighting fork:
   - Preserve subject lighting and grade only the new element. Use this for the safest identity match.
   - Relight the whole frame under one unified look. Use this for a deliberate commercial or cinematic grade, and warn that identity drift risk is higher.

5. Write one provider-neutral master prompt, then add a short provider settings note. Use the target model’s terminology only in that note. If Seedance 2.0 is requested, recommend standard mode and 4K when supported; do not claim unavailable settings are legal in another tool.

6. If a first frame or reference image would stabilize the result, propose it before spending video credits. A texture/reference image is for the creature or material only; do not let it replace the source environment or identity.

7. Run the preflight checks below. If a constraint conflicts with the requested duration or input limit, explain the conflict and offer the smallest correction.

## Prompt grammar

Return English first as plain copyable text. A short label may sit above the prompt. Do not put Markdown, bullets, commentary, or explanations inside the prompt itself. When useful, include:

@source: Original footage — [subject, wardrobe, setting, action]. Preserve [identity, face, performance, framing, lens, camera movement, timing]. Change only [named change].

@reference: [optional creature/material/face reference]. Appearance and texture reference only; ignore its background and lighting.

Photoreal. [aspect]. [source runtime] seconds. [resolution if supported]. [look/grade]. [NON-IP generic design if a character, creature, armor, or vehicle is added]. [SFX only / SFX and source dialogue only].

[One continuous shot. Start with the source camera and composition. Describe preserved performance, then the transformation’s physical behavior over time, its interaction with the plate, lighting integration, scale, occlusion, and grounding. Add timed camera instructions only when needed. End with the lock-down clause.]

SFX [and source dialogue] only: [specific ordered sounds synchronized to visible actions].

Favor exact materials, behaviors, scale, camera language, and texture words. Avoid “beautiful,” “stunning,” “epic,” and other filler adjectives.

## Transformation direction

For an added element, describe where it begins, how it changes, what it touches, and how it affects light, shadow, reflections, dust, smoke, rain, or nearby surfaces. Make the subject’s reaction explicit—unfazed, surprised, or performing the requested reaction.

For an environment swap, preserve the subject, vehicle, seatbelt, rig, and camera path. Make the replacement world move with correct parallax and speed. Add environmental bounce, atmospheric haze, depth-of-field, edge integration, and a believable surface for the subject or vehicle to occupy.

For a photoreal creature or material, specify real anatomy or material structure, imperfections, matte surface response, scale references, occlusion, motion blur, contact shadow, and species-appropriate behavior. Avoid smooth plastic, inflated anatomy, generic CG gloss, and weightless hovering.

## Timed moves and dialogue

Anchor a timed zoom or reveal twice: semantically and numerically. Example: “On the line ‘[exact words],’ begin a smooth push-in; at about 2.4 seconds, the camera reaches the creature.” Preserve the source dialogue only when requested and say “lips match the source exactly” in both the action and lock-down clause.

For a reveal intro, calculate the budget before writing: total runtime minus intro duration equals the remaining source-performance window. If the source no longer fits, offer, in order: extend the total runtime; start the source earlier and lose only quiet lead-in; accept truncation only when no essential dialogue is lost. Never promise exact lip-sync when the arithmetic does not fit.

## Integration checklist

- Match key-light direction, softness, contrast, and shadow direction.
- Add environmental bounce and subtle ambient occlusion where forms meet.
- Match lens character, focus falloff, grain, motion blur, and atmospheric perspective.
- Remove halos and hard cut-out edges; preserve occlusion relationships.
- Ground every added object with contact shadow, weight, and interaction.
- State scale using visible reference objects; colossal creatures otherwise tend to render life-size.
- Keep the subject’s face, identity, wardrobe, and expression unchanged unless explicitly changed.
- Keep one continuous shot when the source is one take; do not casually introduce cuts.

## Provider handoff

Deliver:

1. The finished master prompt.
2. A compact settings note for the selected provider: model, mode, aspect, duration, resolution, inputs, and audio choice.
3. Any risk note that materially affects fidelity: identity drift, handheld tracking, night relighting, dialogue timing, input limits, or a duration conflict.

Use the provider’s current documented input limits and settings when known. If they are not known, say “verify in the current model UI” rather than inventing a limit. For Seedance/Higgsfield-specific requests, consult `references/seedance-adapter.md`.

## Iteration rule

When the user asks for a refinement, change only the named variable and keep the successful prompt stable. Typical refinements are softer light, larger scale, a different camera direction, more visible texture, a later reveal, or the original runtime. Recalculate timing and duration whenever either changes.

## Resources

- Read `references/prompt-templates.md` when constructing a new prompt or offering variants.
- Read `references/seedance-adapter.md` only when the user names Seedance or Higgsfield.
