# DRAFT — Multi-company membership (workspace switcher)

**Status: NOT APPLIED. For review only.** Nothing in this document has been run.
Drafted 2026-08-12.

## What this enables

One login, one email, a dropdown of workspaces — the Hostinger pattern. Mike
signs in once as `mikep@aistaff.click` and switches between AIS-2026-0001 and
AIS-2026-0002. Inside a workspace, tabs show Closer / Pitch / Brandee driven by
that workspace's live subscriptions.

## What blocks it today

`User.company_id` is a required scalar and there is no join table, so one user
belongs to exactly one company. Many-users-to-one-company already works (that
is how the Growth tier sells 10 staff logins). The reverse does not.

---

## 1. Schema

```prisma
model Membership {
  id         String   @id @default(uuid())
  user_id    String
  company_id String
  // Role is per WORKSPACE, not per person. Mike is `owner` of his own
  // companies but could be `staff` inside a client's workspace. This is why
  // the role cannot stay on User.
  role       String   @default("owner")
  status     String   @default("active")
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt
  user       User     @relation(fields: [user_id], references: [id], onDelete: Cascade)
  company    Company  @relation(fields: [company_id], references: [id], onDelete: Cascade)

  @@unique([user_id, company_id])
  @@index([company_id])
  @@index([user_id, status])
  @@map("memberships")
}
```

Backlinks to add:

```prisma
model User {
  memberships   Membership[]
}

model Company {
  memberships   Membership[]
}
```

### `User.company_id` is KEPT, not dropped

Same reasoning as keeping `@@unique([company_id, psid])` through the
`external_id` migration. It becomes "default / last-used workspace" and is the
fallback when no active company is selected. Dropping it would break the 77
call sites at once; keeping it means they never notice the change.

---

## 2. Migration SQL

Backfill runs BEFORE the unique index, exactly as the `external_id` and
`account_number` migrations did.

```sql
-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- Backfill: every existing user gets one membership from the company they
-- already belong to, preserving their current role. 4 users today.
INSERT INTO "memberships" (id, user_id, company_id, role, status, created_at, updated_at)
SELECT gen_random_uuid(), u.id, u.company_id, u.role, 'active', u.created_at, now()
  FROM "users" u
 WHERE NOT EXISTS (
   SELECT 1 FROM "memberships" m
    WHERE m.user_id = u.id AND m.company_id = u.company_id
 );

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_company_id_key" ON "memberships"("user_id", "company_id");
CREATE INDEX "memberships_company_id_idx" ON "memberships"("company_id");
CREATE INDEX "memberships_user_id_status_idx" ON "memberships"("user_id", "status");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Expected result: 4 memberships, one per user, no duplicates.

---

## 3. The resolver — `src/auth.js`

77 places READ `req.companyId`. Only TWO lines SET it (`auth.js:46` and
`auth.js:73`). Change those two and every existing screen keeps working,
correctly scoped, unaware anything changed.

### New helper

```js
const ACTIVE_COMPANY_COOKIE = "ai_inbox_company";

/**
 * Which workspace is this request for?
 *
 * SECURITY: the requested company arrives from the client (cookie or header)
 * and is therefore UNTRUSTED. It is only honoured after confirming an active
 * membership row exists for this user. Same discipline `requireAuth` already
 * applies to `platform_role` — never trust the JWT or a client-supplied value
 * for anything that grants access.
 *
 * A stale or revoked selection does NOT error. It silently falls back to the
 * user's default workspace, because a 403 on every request after a membership
 * is removed would lock someone out of a dashboard they still legitimately
 * have. Falling back is safe: the requested company is never granted.
 */
async function resolveActiveCompany(req, user) {
  const requested =
    req.headers["x-company-id"] ||
    req.cookies?.[ACTIVE_COMPANY_COOKIE] ||
    null;

  if (requested && requested !== user.company_id) {
    const membership = await prisma.membership.findFirst({
      where: { user_id: user.id, company_id: String(requested), status: "active" },
      select: { company_id: true }
    });
    if (membership) return membership.company_id;
    // No membership -> ignore the request, fall through to the default.
  }

  return user.company_id;
}
```

### The two changed lines

`requireAuth`, currently line 46:

```js
    req.user = user;
-   req.companyId = user.company_id;
+   req.companyId = await resolveActiveCompany(req, user);
    next();
```

`attachUserIfPresent`, currently line 73:

```js
    if (user) {
      req.user = user;
-     req.companyId = user.company_id;
+     req.companyId = await resolveActiveCompany(req, user);
    }
```

Nothing else in either function changes.

---

## 4. Supporting endpoints (`src/server.js`)

```js
// The dropdown's contents.
app.get("/api/my-companies", requireAuth, asyncHandler(async (req, res) => {
  const memberships = await prisma.membership.findMany({
    where: { user_id: req.user.id, status: "active" },
    select: {
      role: true,
      company: { select: { id: true, name: true, account_number: true } }
    },
    orderBy: { created_at: "asc" }
  });
  res.json({
    activeCompanyId: req.companyId,
    companies: memberships.map((m) => ({ ...m.company, role: m.role }))
  });
}));

// Switching workspace. Verifies membership before setting the cookie, so an
// invalid id is rejected here rather than silently ignored later.
app.post("/api/active-company", requireAuth, asyncHandler(async (req, res) => {
  const { companyId } = z.object({ companyId: z.string().min(1) }).parse(req.body);
  const membership = await prisma.membership.findFirst({
    where: { user_id: req.user.id, company_id: companyId, status: "active" },
    select: { company_id: true }
  });
  if (!membership) return res.status(403).json({ error: "Not a member of that workspace" });

  res.cookie(ACTIVE_COMPANY_COOKIE, companyId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  });
  res.json({ ok: true, activeCompanyId: companyId });
}));
```

Note the cookie mirrors the session cookie's flags, including the
environment-aware `secure`.

---

## 5. Meta safety

- No route is moved, renamed or redirected. `/admin/login`,
  `/admin/dashboard`, `/admin/settings`,
  `/admin/settings/facebook-page-connection` keep their paths and handlers.
- `/api/auth/login` and `requireAuth`'s contract are unchanged.
- **`reviewer@aistaff.click` must end up with exactly ONE membership.** With
  one workspace the dropdown does not render, so the reviewer's recorded flow
  stays visually identical to the screen recordings Meta approved. Verify
  after backfill.
- Run the §12 curl check before shipping — and check page CONTENT, not just
  the status code. The `app.get("*")` catch-all returns 200 with the marketing
  homepage for any path, so a 200 alone proves nothing.

---

## 6. Sequencing and risk

1. `pg_dump` first.
2. Apply migration, verify 4 memberships and the reviewer's count is 1.
3. Add the resolver; the two call sites change together.
4. Ship the two endpoints.
5. UI dropdown last — it is the only user-visible piece and is reversible.

Steps 1-4 change no behaviour on their own: with one membership each,
`resolveActiveCompany` returns `user.company_id` for everybody, which is what
the code does today.

### Open question, decide before step 5

When a logged-in customer buys a second product, does it join their CURRENT
workspace or create a NEW one? Buying Pitch for the business that already has
Closer should join. Buying Closer for a different business should not. This
determines whether checkout creates a `Membership` or a whole new `Company` —
so it needs answering before the switcher ships.

### Not covered here

`User.role` stays in place and still reflects the default workspace. Once the
switcher ships, permission checks that read `user.role` should read the active
membership's role instead. Worth auditing separately — out of scope for this
draft.
