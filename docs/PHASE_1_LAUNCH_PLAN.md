# AIStaff.click — Phase 1 Launch Plan

**Model:** Managed onboarding (you onboard each client manually)  
**Meta app owner:** AIStaff (one app, one webhook, many client Pages)  
**Pricing in bot:** Gated behind contact details  
**Ad niche:** B2B Facebook Page sellers — copier/CCTV/aircon/suppliers/construction/logistics  

**Timeline:** 1–2 weeks to first paid client  
**Capacity:** 5–10 clients without major rebuild  

---

## 1. Facebook Ads Strategy

### Campaign objective
**Leads** or **Messages** → send traffic to `aistaff.click` audit form or AIStaff Page Messenger.

### Target audience (Philippines)
| Setting | Value |
|---|---|
| Location | Philippines (expand later) |
| Age | 28–55 |
| Interests | Small business, B2B, Facebook Page admins, copier rental, CCTV, aircon, construction supplies, logistics |
| Behaviors | Page admins, business owners |
| Placements | Facebook Feed, Messenger, Instagram Feed (optional) |

### Ad angles (pick 2–3 to test)

**Angle A — Lost sales**
> Stop losing sales from late Facebook replies.  
> AI replies instantly, qualifies inquiries, and prepares quotation drafts for your approval.

**Angle B — Quotation workflow**
> Still replying to Facebook inquiries manually?  
> Turn Messenger into a quotation-ready lead system with admin approval before sending.

**Angle C — Industry-specific (copier/CCTV)**
> Copier / CCTV / supplier inquiries on Facebook?  
> AI staff qualifies every message and captures complete lead details before your team quotes.

### Ad copy templates

**Primary text (short):**
```
Many B2B businesses lose hot inquiries because Facebook replies come too late.

AIStaff sets up AI for your Facebook Page inbox to:
✅ Reply instantly
✅ Ask qualifying questions
✅ Capture lead details
✅ Prepare quotation drafts for your approval

Book a free inbox audit — see where leads may be lost.
```

**Primary text (Taglish variant):**
```
Maraming B2B business nawawalan ng inquiry sa Facebook dahil late ang reply.

AIStaff magse-setup ng AI sa Facebook Page inbox ninyo para:
✅ Sumagot agad
✅ Magtanong ng qualifying details
✅ I-save ang leads
✅ Maghanda ng quotation draft bago i-approve ninyo

Book a free inbox audit today.
```

**Headlines (test 3):**
1. `Stop Losing Facebook Sales Leads`
2. `AI Sales Assistant for Facebook Pages`
3. `Free Inbox Audit for B2B Pages`

**CTA button:** `Learn More` or `Send Message`  
**Destination:** `https://aistaff.click/#audit` (or Messenger ad → AIStaff Page)

### Budget starter
- **Test budget:** ₱300–500/day for 7 days
- **Kill rule:** Pause ad if cost per audit lead > ₱500 after 3 days
- **Scale rule:** Double budget on ad with lowest cost per qualified audit form

---

## 2. Landing Flow

```
Facebook Ad
    ↓
aistaff.click (landing page)
    ↓
#audit form (Book Free Inbox Audit)
    ↓
Lead saved in AIStaff admin dashboard
    ↓
You call/message within 24 hours
    ↓
Managed onboarding (checklist below)
    ↓
Client goes live on Messenger
    ↓
Invoice: Setup fee + monthly
```

### Landing page sections (already built)
1. Hero — problem + CTA  
2. How it works  
3. Sample conversation  
4. Pricing (Starter/Growth/Pro)  
5. **Audit form** ← primary conversion  
6. FAQ  

### Audit form fields (captures sales lead)
- Company name  
- Contact person  
- Mobile  
- Email  
- Facebook Page URL  
- Business type  
- Avg inquiries/week  
- Sends quotations? (Yes/No)  
- Notes  

**After submit:** Lead appears in admin → Leads with status `new`, source `website_audit`.

### Messenger alternative funnel
Some ads can go directly to **AIStaff Facebook Page** Messenger:
- Bot qualifies with gated pricing  
- Captures contact before full package prices  
- You follow up from dashboard leads  

---

## 3. Managed Onboarding Checklist (per client)

Use **Admin → Onboarding** checklist in dashboard, or follow this list:

### Day 0 — Sale closed
- [ ] Collect 50% setup fee (optional policy)
- [ ] Get client: company name, industry, admin email, Facebook Page URL
- [ ] Run `npm run create:client` (creates company + admin user)

### Day 1 — Configure tenant
- [ ] Log in as client admin (or configure for them)
- [ ] Fill **Company profile** (name, industry, website, contact)
- [ ] Add **Knowledge base** entries (services, pricing rules, FAQs, what NOT to say)
- [ ] Add **Qualification questions** (service, location, urgency, company, name, mobile, email)
- [ ] Set **Settings**: AI on, auto-reply on, quotation approval required, notify email

### Day 1 — Connect Facebook Page
- [ ] Get Page ID from client (or from Page → About → Page transparency)
- [ ] Client generates Page access token (see `docs/CLIENT_PAGE_CONNECTION.md`)
- [ ] Paste in **Settings → Facebook Page** (page ID, name, token)
- [ ] Run `npm run sync:page-token` if using env token for that page
- [ ] Confirm Page subscribed to app webhook (`messages`, `messaging_postbacks`)

### Day 2 — Test
- [ ] Send test inquiry to client Page Messenger
- [ ] Confirm AI reply uses client KB only (not AIStaff pricing)
- [ ] Confirm lead saved in dashboard
- [ ] Test human handoff trigger
- [ ] Test quotation draft → approve → send flow

### Day 3 — Go live
- [ ] Client admin trained (15-min walkthrough)
- [ ] Collect remaining setup fee
- [ ] Schedule first follow-up review (7 days)
- [ ] Add to monthly billing tracker

---

## 4. What to Build First (Phase 1 — 5 features)

| Priority | Feature | Status |
|---|---|---|
| 1 | **Pricing gate in AIStaff demo bot** | Build now |
| 2 | **Audit form → saves lead to dashboard** | Build now |
| 3 | **`npm run create:client` script** | Build now |
| 4 | **Agency onboarding checklist in admin** | Build now |
| 5 | **Client Page connection guide** | `docs/CLIENT_PAGE_CONNECTION.md` |

**Not in Phase 1:** Self-serve signup, Facebook OAuth, Stripe, super-admin multi-tenant view.

---

## 5. Client Facebook Page — What You Need

| Input | Who provides | Where stored |
|---|---|---|
| Page ID | Client | `FacebookPage.page_id` |
| Page name | Client | `FacebookPage.page_name` |
| Page access token | Client (via Meta) | Encrypted in DB |
| Webhook URL | You (one for all) | Meta app settings |
| Verify token | You | `.env` `META_VERIFY_TOKEN` |

See `docs/CLIENT_PAGE_CONNECTION.md` for step-by-step client instructions.

---

## 6. Pricing Packages (sell on calls, gate in bot)

| Package | Setup | Monthly | Best for |
|---|---|---|---|
| **Starter** | ₱15,000 | ₱3,000 | 1 Page, basic qualification, quotation drafts |
| **Growth** | ₱25,000 | ₱6,000 | Lead scoring, follow-ups, KB optimization |
| **Pro** | ₱50,000 | ₱12,000 | Multi-user, advanced quotation workflow |

**Bot rule:** Only share full pricing after contact person + mobile + email captured.

---

## 7. Week-by-Week Launch Schedule

### Week 1
- [ ] Fix webhook URL to `https://aistaff-api.marga.biz/api/webhooks/messenger`
- [ ] Add `META_APP_SECRET` to `.env`
- [ ] Deploy pricing gate + audit form + create-client script
- [ ] Write 3 ad creatives (1 video/screen recording of dashboard optional)
- [ ] Launch ads at ₱300/day
- [ ] Respond to audit leads within 24h

### Week 2
- [ ] Close first 1–2 clients
- [ ] Onboard using checklist
- [ ] Collect testimonials / screenshot of dashboard
- [ ] Retarget website visitors (if pixel installed later)

---

## 8. KPIs to Track

| Metric | Target (Week 1) |
|---|---|
| Audit form submissions | 5+ |
| Cost per audit lead | < ₱500 |
| Sales calls booked | 2+ |
| Clients onboarded | 1 |
| Messenger response time | < 30 seconds |

---

## 9. Your Decisions (locked in)

- ✅ **Managed onboarding first** — not self-serve  
- ✅ **AIStaff owns Meta app** — one app for all clients  
- ✅ **Pricing gated** — contact before full packages  
- ✅ **Niche:** copier, CCTV, suppliers, aircon, construction, logistics  

---

## 10. Quick Commands

```bash
# Start server
npm run dev

# Create new client tenant
npm run create:client

# Sync page token after .env update
npm run sync:page-token

# Register Meta webhook (needs META_APP_SECRET)
npm run configure:webhook
```
