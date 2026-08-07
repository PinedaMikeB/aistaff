# Seedance / Higgsfield adapter

Use this only when the user explicitly selects Seedance or Higgsfield. Keep the master prompt provider-neutral first.

- Treat the uploaded source video as the base footage, not a style reference.
- Use `@source` for the plate and add `@reference` only for a real texture or appearance reference.
- For Seedance 2.0, prefer standard mode for quality-critical preservation and use 4K only when the current surface exposes it. Fast or studio surfaces may have lower resolution caps; verify the current UI.
- Match the generated duration to the source by default. If an intro is added, recompute the surviving source window.
- Keep audio to “SFX only” unless source dialogue must survive; then specify “SFX and source dialogue only.”
- If a provider limit is uncertain, do not state a hard number. Tell the user to verify current input-count, duration, audio, and resolution limits in the model UI.
- A first-frame image can be generated before video to stabilize the transformed look. It must preserve the source composition at the handoff frame.
