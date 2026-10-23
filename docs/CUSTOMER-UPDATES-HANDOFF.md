# Customer Updates handoff

## Purpose

Customer Updates is the general tenant workflow for Meta Messenger Utility Messages outside the standard 24-hour reply window. It is not a marketing or automatic follow-up tool. Tenants use it for verified business events such as schedules, assigned representatives, reference numbers, request status, documents, payments, delivery/collection, and completion.

## Tenant workflow

1. In **Settings → Customer Updates**, add a general starter or a custom template.
2. Edit the staff-facing purpose, AI usage instruction, approved wording, named variables, and Meta review examples.
3. Submit the draft to Meta. Submitted/approved wording is immutable in AIStaff; editing it creates a new draft version.
4. Meta status updates arrive by the `message_template_status_update` webhook. Staff can also use **Refresh Meta status**.
5. In **Customer Updates → Send update**, search for the Messenger customer, choose an approved template, enter verified values, and generate an exact preview.
6. Confirm the recipient, Page, template version, and exact rendered message before sending. The signed preview expires after 15 minutes and is single-use.

Drafts are session-restored until sent or manually reset. Every send attempt retains the exact values, rendered text, user email, Meta result, and template version. Existing internal follow-up reminders remain available under the **Tasks** tab and do not send messages.

## AI behavior

Each approved template's `ai_usage_instruction` is included in Closer's tenant context. It tells the AI which verified event permits that workflow. Closer does not automatically send a Utility Message, invent a business event, or paste a proactive template into an ordinary reply. Staff remain responsible for selecting the recipient and confirming exact values.

## Meta and runtime requirements

- Meta app permission: `pages_utility_messaging`
- Page webhook fields: `messages,messaging_postbacks,message_template_status_update`
- Current Utility API default: Graph `v24.0` (`META_UTILITY_GRAPH_VERSION` may override it)
- A Page token issued before the new permission was granted may need to be reconnected.
- Template creation and real customer sends are external actions and must be initiated deliberately from the UI.

## Production source of truth

- Hostname: `https://aistaff.click`
- Host/repository: `aistaff:/srv/apps/aistaff`
- Service/port: `aistaff-api.service`, port `3000`
- Wrapper: `/home/mike/srv/ryzen-start-aistaff-api.sh`
- Environment file: `/srv/apps/aistaff/.env`

Deploy only through the narrow-patch, database-backup, Prisma migrate/generate, test, service-restart, and public-host verification procedure in `docs/DEPLOYMENT.md`.
