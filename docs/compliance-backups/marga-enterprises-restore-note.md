# Marga Enterprises — restore note (Pitch demo transcript)

**Why this exists:** During PayMongo KYC review (Sep 2026), we removed the
"Marga Enterprises" mention from the public site because AIStaff Business
Solutions Corporation now has its own separate SEC registration and needed
a consistent legal identity across every page. This is the one place that
needs to be reverted afterward, for Facebook/Meta app review purposes.

**File:** `public/agents/pitch/index.html`
**Section:** the sample call transcript under "A real call, word for word"

## Original line (before the Sep 2026 edit)

```html
<p class="pitch-msg agent"><b>Pitch</b> Magandang araw, Marga Enterprises po. Ano po ang maitutulong ko?</p>
```

## Current line (temporary, for PayMongo review)

```html
<p class="pitch-msg agent"><b>Pitch</b> Magandang araw, Sunview Travel po. Ano po ang maitutulong ko?</p>
```

## To restore

Either:
- Run `git log --oneline -- public/agents/pitch/index.html` and check out the
  commit before this change, or `git diff` against this file to see the
  exact line changed, then revert it by hand; or
- Paste the "Original line" block above back into the same spot in
  `public/agents/pitch/index.html`, replacing the "Sunview Travel" line.

No other file was touched for this restore — the Terms page's "Business
identity" section was also changed in the same session (from "owned and
operated by Marga Enterprises" to AIStaff Business Solutions Corporation),
but that one should **not** be reverted — it was a factual correction, not
a temporary swap. Only the Pitch page transcript name is meant to go back.
