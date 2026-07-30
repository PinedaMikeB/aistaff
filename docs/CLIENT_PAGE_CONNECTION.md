# Client Facebook Page Connection Guide

Send this to clients during onboarding (managed setup).

---

## What the client needs to provide

1. **Facebook Page admin access** (they must be admin of the Page)
2. **Facebook Page URL** (e.g. `https://facebook.com/YourBusinessPage`)
3. **Page ID** (numeric — see below)
4. **Page access token** (see below — or you generate together on a call)

---

## Step 1 — Find Page ID

1. Open their Facebook Page  
2. Go to **About** → **Page transparency**  
3. Copy the **Page ID** (long number)

Or use: [Meta Page ID finder tools] or Graph API Explorer with their token.

---

## Step 2 — Generate Page Access Token (manual method)

1. Go to [developers.facebook.com](https://developers.facebook.com)  
2. Open the **AIStaff** app (your agency will guide this)  
3. **Tools → Graph API Explorer**  
4. Select app: **aistaff**  
5. Add permissions: `pages_messaging`, `pages_manage_metadata`  
6. Generate **User access token** (client logs in as Page admin)  
7. Select the client's **Page** → get **Page access token**  
8. Send the Page access token securely to AIStaff (not in public chat)

---

## Step 3 — AIStaff connects the Page

AIStaff will:
1. Save the Page ID and token (encrypted) in your admin dashboard  
2. Subscribe your Page to the AIStaff Messenger webhook  
3. Send a test message to confirm replies work  

---

## Step 4 — Client admin login

AIStaff provides:
- Admin URL: `https://aistaff.click` → Admin Login  
- Email + temporary password  
- Client should change password after first login  

---

## Permissions required

| Permission | Purpose |
|---|---|
| `pages_messaging` | Receive and send Messenger messages |
| `pages_manage_metadata` | Subscribe Page to webhooks |

---

## Security notes

- Tokens are stored encrypted  
- Client can revoke access anytime in Page Settings → Apps  
- AIStaff never posts to your Page feed — inbox only  
- Quotation sending requires your admin approval by default  

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Bot not replying | Confirm webhook URL is live; Page subscribed to app |
| "Token invalid" | Regenerate Page token; run sync from AIStaff |
| Wrong Page connected | Update Page ID + token in Settings |
| **Message button shows Follow** | Change the Page action button back to **Send Message** (see below) |

### Restore the Message button (Follow replaced Send Message)

Facebook shows one primary action button under the cover photo. If it says **Follow** instead of **Message**, change it in Page settings:

1. Log into Facebook and **switch to the Page** (profile menu → **See all profiles** → select your Page).
2. Open the Page home.
3. Under the cover photo, click **Options** (⋯).
4. Click **Edit Action Button** → **Change Button**.
5. Select **Send Message**, then **Save**.

Also confirm Messenger is allowed:

1. Open **Meta Business Suite** → **Settings** → your Page.
2. Under **Messaging** / **Advanced messaging**, enable allowing people to message your Page.

**Quick test without the Page button:** open `https://m.me/YOUR_PAGE_ID` (for AIStaff demo: `https://m.me/1164341106754995`). This opens Messenger directly.

**Note:** Page admins sometimes see **Follow** on their own Page while visitors still see **Message**. Test from a personal account or incognito if unsure.

---

## Contact AIStaff

For setup help during onboarding, contact your AIStaff account manager.
