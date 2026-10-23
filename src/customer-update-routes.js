const express = require("express");
const { z } = require("zod");

const { prisma } = require("./db");
const { decryptSecret } = require("./crypto");
const { inspectMetaToken } = require("./meta-access-tokens");
const {
  UTILITY_TEMPLATE_SUGGESTIONS,
  SUGGESTION_BY_KEY,
  slugifyTemplateKey,
  utilityTemplateName,
  validateTemplateDraft,
  normalizeUtilityVariables,
  renderUtilityTemplate,
  createMetaUtilityTemplate,
  getMetaUtilityTemplate,
  sendMetaUtilityMessage,
  signUtilityPreview,
  verifyUtilityPreview
} = require("./customer-updates");

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const templateDraftSchema = z.object({
  suggestion_key: z.string().optional(),
  display_name: z.string().optional(),
  description: z.string().optional().nullable(),
  ai_usage_instruction: z.string().optional(),
  body_text: z.string().optional(),
  language: z.enum(["en_US", "fil_PH"]).default("en_US"),
  variable_examples: z.record(z.string()).default({})
});

async function activePage(companyId) {
  return prisma.facebookPage.findFirst({
    where: { company_id: companyId, status: "active" },
    orderBy: { updated_at: "desc" }
  });
}

function runtimeTemplate(row) {
  return {
    bodyText: row.body_text,
    variableKeys: row.variable_keys,
    variableExamples: row.variable_examples || {},
    metaTemplateName: row.meta_template_name,
    language: row.language
  };
}

function serializeTemplate(row) {
  return {
    id: row.id,
    key: row.key,
    version: row.version,
    displayName: row.display_name,
    description: row.description,
    aiUsageInstruction: row.ai_usage_instruction,
    metaTemplateName: row.meta_template_name,
    language: row.language,
    bodyText: row.body_text,
    variableKeys: row.variable_keys,
    variableExamples: row.variable_examples || {},
    status: row.status,
    active: row.active,
    metaTemplateId: row.meta_template_id,
    metaError: row.meta_error,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function readiness(page) {
  if (!page) return { pageConnected: false, tokenValid: null, utilityPermission: null };
  const token = decryptSecret(page.page_access_token_encrypted);
  if (!token || !process.env.META_APP_ID || !process.env.META_APP_SECRET) {
    return { pageConnected: true, tokenValid: null, utilityPermission: null };
  }
  const info = await inspectMetaToken({
    token,
    appId: process.env.META_APP_ID,
    appSecret: process.env.META_APP_SECRET,
    fetchImpl: fetch
  });
  return {
    pageConnected: true,
    tokenValid: info ? info.isValid : null,
    utilityPermission: info
      ? info.scopes.some((scope) => ["pages_utility_messaging", "page_utility_messaging"].includes(scope))
      : null
  };
}

async function expirePageOnOAuthError(page, error) {
  if (Number(error?.metaCode) !== 190) return;
  await prisma.facebookPage.update({ where: { id: page.id }, data: { status: "token_expired" } }).catch(() => null);
}

function draftFromRequest(body) {
  const suggestion = body.suggestion_key ? SUGGESTION_BY_KEY.get(body.suggestion_key) : null;
  if (body.suggestion_key && !suggestion) throw new Error("Template suggestion not found.");
  const displayName = suggestion?.displayName || body.display_name;
  const description = suggestion?.description || String(body.description || "").trim() || null;
  const aiUsageInstruction = suggestion?.aiUsageInstruction || body.ai_usage_instruction;
  const bodyText = suggestion?.bodyText || body.body_text;
  const variableExamples = suggestion?.examples || body.variable_examples;
  const validated = validateTemplateDraft({ displayName, bodyText, aiUsageInstruction, variableExamples });
  return { ...validated, description, language: body.language || "en_US", suggestion };
}

async function activateApprovedVersion(template) {
  if (template.status !== "APPROVED") return template;
  await prisma.$transaction([
    prisma.customerUpdateTemplate.updateMany({
      where: {
        company_id: template.company_id,
        facebook_page_id: template.facebook_page_id,
        key: template.key,
        id: { not: template.id }
      },
      data: { active: false }
    }),
    prisma.customerUpdateTemplate.update({ where: { id: template.id }, data: { active: true } })
  ]);
  return prisma.customerUpdateTemplate.findUnique({ where: { id: template.id } });
}

function buildCustomerUpdateRouter({ requireAuth }) {
  const router = express.Router();
  router.use(requireAuth);

  router.get("/customer-update-templates", asyncRoute(async (req, res) => {
    const page = await activePage(req.companyId);
    const [templates, state] = await Promise.all([
      prisma.customerUpdateTemplate.findMany({
        where: { company_id: req.companyId, ...(page ? { facebook_page_id: page.id } : {}) },
        orderBy: [{ active: "desc" }, { key: "asc" }, { version: "desc" }]
      }),
      readiness(page)
    ]);
    res.json({
      page: page ? { id: page.id, pageId: page.page_id, name: page.page_name, status: page.status } : null,
      readiness: state,
      suggestions: UTILITY_TEMPLATE_SUGGESTIONS.map((item) => ({
        key: item.key,
        displayName: item.displayName,
        description: item.description,
        aiUsageInstruction: item.aiUsageInstruction,
        bodyText: item.bodyText,
        variableExamples: item.examples
      })),
      templates: templates.map(serializeTemplate)
    });
  }));

  router.post("/customer-update-templates", asyncRoute(async (req, res) => {
    const body = templateDraftSchema.parse(req.body);
    let draft;
    try {
      draft = draftFromRequest(body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    const page = await activePage(req.companyId);
    if (!page) return res.status(400).json({ error: "Connect an active Facebook Page before adding Utility templates." });
    const key = draft.suggestion?.key || slugifyTemplateKey(draft.displayName);
    const existing = await prisma.customerUpdateTemplate.findFirst({
      where: { company_id: req.companyId, facebook_page_id: page.id, key }
    });
    if (existing) return res.status(409).json({ error: "A template with this name already exists. Edit its draft or create a new name." });
    const saved = await prisma.customerUpdateTemplate.create({
      data: {
        company_id: req.companyId,
        facebook_page_id: page.id,
        key,
        version: 1,
        display_name: draft.displayName,
        description: draft.description,
        ai_usage_instruction: draft.aiUsageInstruction,
        meta_template_name: utilityTemplateName(key, 1),
        language: draft.language,
        body_text: draft.bodyText,
        variable_keys: draft.variableKeys,
        variable_examples: draft.variableExamples,
        status: "DRAFT",
        created_by_email: req.user.email
      }
    });
    res.status(201).json(serializeTemplate(saved));
  }));

  router.put("/customer-update-templates/:id", asyncRoute(async (req, res) => {
    const current = await prisma.customerUpdateTemplate.findFirst({
      where: { id: req.params.id, company_id: req.companyId, active: true }
    });
    if (!current) return res.status(404).json({ error: "Template not found." });
    const body = templateDraftSchema.parse(req.body);
    let draft;
    try {
      draft = draftFromRequest(body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    if (["DRAFT", "ERROR"].includes(current.status)) {
      const saved = await prisma.customerUpdateTemplate.update({
        where: { id: current.id },
        data: {
          display_name: draft.displayName,
          description: draft.description,
          ai_usage_instruction: draft.aiUsageInstruction,
          language: draft.language,
          body_text: draft.bodyText,
          variable_keys: draft.variableKeys,
          variable_examples: draft.variableExamples,
          status: "DRAFT",
          meta_error: null,
          created_by_email: req.user.email
        }
      });
      return res.json({ createdVersion: false, template: serializeTemplate(saved) });
    }

    const latest = await prisma.customerUpdateTemplate.aggregate({
      where: { company_id: req.companyId, facebook_page_id: current.facebook_page_id, key: current.key },
      _max: { version: true }
    });
    const version = Number(latest._max.version || current.version) + 1;
    const saved = await prisma.customerUpdateTemplate.create({
      data: {
        company_id: req.companyId,
        facebook_page_id: current.facebook_page_id,
        key: current.key,
        version,
        display_name: draft.displayName,
        description: draft.description,
        ai_usage_instruction: draft.aiUsageInstruction,
        meta_template_name: utilityTemplateName(current.key, version),
        language: draft.language,
        body_text: draft.bodyText,
        variable_keys: draft.variableKeys,
        variable_examples: draft.variableExamples,
        status: "DRAFT",
        active: true,
        created_by_email: req.user.email
      }
    });
    res.status(201).json({ createdVersion: true, template: serializeTemplate(saved) });
  }));

  router.delete("/customer-update-templates/:id", asyncRoute(async (req, res) => {
    const current = await prisma.customerUpdateTemplate.findFirst({
      where: { id: req.params.id, company_id: req.companyId, active: true }
    });
    if (!current) return res.status(404).json({ error: "Template not found." });
    if (["DRAFT", "ERROR"].includes(current.status)) {
      await prisma.customerUpdateTemplate.delete({ where: { id: current.id } });
      return res.json({ deleted: true, archived: false });
    }
    await prisma.customerUpdateTemplate.update({
      where: { id: current.id },
      data: { active: false, archived_at: new Date() }
    });
    res.json({ deleted: false, archived: true });
  }));

  router.post("/customer-update-templates/:id/submit", asyncRoute(async (req, res) => {
    const template = await prisma.customerUpdateTemplate.findFirst({
      where: { id: req.params.id, company_id: req.companyId, active: true }
    });
    if (!template) return res.status(404).json({ error: "Template not found." });
    if (!["DRAFT", "ERROR"].includes(template.status)) {
      return res.status(409).json({ error: "Only a draft or failed submission can be submitted to Meta." });
    }
    const page = await prisma.facebookPage.findFirst({
      where: { id: template.facebook_page_id, company_id: req.companyId, status: "active" }
    });
    if (!page) return res.status(400).json({ error: "Reconnect the Facebook Page before submitting this template." });
    const token = decryptSecret(page.page_access_token_encrypted);
    if (!token) return res.status(400).json({ error: "Reconnect the Facebook Page before submitting this template." });
    await prisma.customerUpdateTemplate.update({ where: { id: template.id }, data: { status: "SUBMITTING", meta_error: null } });
    try {
      const result = await createMetaUtilityTemplate({ pageId: page.page_id, token, template: runtimeTemplate(template), fetchImpl: fetch });
      let saved = await prisma.customerUpdateTemplate.update({
        where: { id: template.id },
        data: {
          status: String(result.status || "PENDING").toUpperCase(),
          meta_template_id: result.id ? String(result.id) : null,
          meta_error: null
        }
      });
      saved = await activateApprovedVersion(saved);
      res.json(serializeTemplate(saved));
    } catch (error) {
      await expirePageOnOAuthError(page, error);
      await prisma.customerUpdateTemplate.update({
        where: { id: template.id },
        data: { status: "ERROR", meta_error: String(error.message).slice(0, 1000) }
      });
      res.status(502).json({ error: error.message });
    }
  }));

  router.post("/customer-update-templates/sync", asyncRoute(async (req, res) => {
    const page = await activePage(req.companyId);
    if (!page) return res.status(400).json({ error: "Reconnect the Facebook Page before checking template status." });
    const token = decryptSecret(page.page_access_token_encrypted);
    if (!token) return res.status(400).json({ error: "Reconnect the Facebook Page before checking template status." });
    const templates = await prisma.customerUpdateTemplate.findMany({
      where: { company_id: req.companyId, facebook_page_id: page.id, active: true, status: { not: "DRAFT" } }
    });
    const synced = [];
    for (const template of templates) {
      const found = await getMetaUtilityTemplate({ pageId: page.page_id, token, name: template.meta_template_name, fetchImpl: fetch });
      if (!found) continue;
      let saved = await prisma.customerUpdateTemplate.update({
        where: { id: template.id },
        data: {
          status: String(found.status || template.status).toUpperCase(),
          meta_template_id: found.id ? String(found.id) : template.meta_template_id,
          meta_error: null
        }
      });
      saved = await activateApprovedVersion(saved);
      synced.push(serializeTemplate(saved));
    }
    res.json({ synced });
  }));

  router.get("/customer-updates", asyncRoute(async (req, res) => {
    const page = await activePage(req.companyId);
    const [templates, deliveries, conversations, state] = await Promise.all([
      page ? prisma.customerUpdateTemplate.findMany({
        where: { company_id: req.companyId, facebook_page_id: page.id, active: true, status: "APPROVED" },
        orderBy: { display_name: "asc" }
      }) : [],
      prisma.customerUpdateDelivery.findMany({
        where: { company_id: req.companyId },
        orderBy: { created_at: "desc" },
        take: 50,
        include: {
          template: { select: { display_name: true, meta_template_name: true, version: true } },
          facebook_page: { select: { page_name: true } },
          conversation: { select: { customer_name: true } }
        }
      }),
      page ? prisma.conversation.findMany({
        where: { company_id: req.companyId, facebook_page_id: page.id, psid: { not: null } },
        orderBy: { last_message_at: "desc" },
        take: 200,
        select: {
          id: true,
          customer_name: true,
          last_message_at: true,
          messages: {
            where: { sender_type: "customer" },
            orderBy: { created_at: "desc" },
            take: 1,
            select: { created_at: true, message_text: true }
          }
        }
      }) : [],
      readiness(page)
    ]);
    res.json({
      page: page ? { id: page.id, pageId: page.page_id, name: page.page_name, status: page.status } : null,
      readiness: state,
      templates: templates.map(serializeTemplate),
      conversations: conversations.map((conversation) => {
        const latest = conversation.messages[0] || null;
        const closesAt = latest?.created_at ? new Date(latest.created_at.getTime() + (24 * 60 * 60 * 1000)) : null;
        return {
          id: conversation.id,
          customerName: conversation.customer_name || "Messenger customer",
          lastMessageAt: conversation.last_message_at,
          lastCustomerMessageAt: latest?.created_at || null,
          lastCustomerMessage: latest?.message_text || "",
          standardWindowOpen: Boolean(closesAt && closesAt.getTime() > Date.now()),
          standardWindowClosesAt: closesAt
        };
      }),
      deliveries: deliveries.map((delivery) => ({
        id: delivery.id,
        status: delivery.status,
        recipientName: delivery.recipient_name || delivery.conversation?.customer_name || "Messenger customer",
        templateName: `${delivery.template.display_name} v${delivery.template.version}`,
        metaTemplateName: delivery.template.meta_template_name,
        pageName: delivery.facebook_page.page_name,
        renderedText: delivery.rendered_text,
        metaMessageId: delivery.meta_message_id,
        metaError: delivery.meta_error,
        createdBy: delivery.created_by_email,
        createdAt: delivery.created_at,
        sentAt: delivery.sent_at
      }))
    });
  }));

  router.post("/customer-updates/preview", asyncRoute(async (req, res) => {
    const body = z.object({
      conversation_id: z.string().min(1),
      template_id: z.string().min(1),
      variables: z.record(z.string()).default({})
    }).parse(req.body);
    const page = await activePage(req.companyId);
    if (!page) return res.status(400).json({ error: "Connect an active Facebook Page before sending Customer Updates." });
    const [conversation, template] = await Promise.all([
      prisma.conversation.findFirst({
        where: { id: body.conversation_id, company_id: req.companyId, facebook_page_id: page.id, psid: { not: null } },
        select: { id: true, psid: true, customer_name: true }
      }),
      prisma.customerUpdateTemplate.findFirst({
        where: { id: body.template_id, company_id: req.companyId, facebook_page_id: page.id, active: true, status: "APPROVED" }
      })
    ]);
    if (!conversation) return res.status(404).json({ error: "Select a customer from the connected Page." });
    if (!template) return res.status(400).json({ error: "Select an active Meta-approved Utility template." });
    const runtime = runtimeTemplate(template);
    let variables;
    let renderedText;
    try {
      variables = normalizeUtilityVariables(runtime, body.variables);
      renderedText = renderUtilityTemplate(runtime, variables);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    res.json({
      previewToken: signUtilityPreview({
        companyId: req.companyId,
        userId: req.user.id,
        pageId: page.id,
        conversationId: conversation.id,
        templateId: template.id,
        variables,
        renderedText
      }),
      recipientName: conversation.customer_name || "Messenger customer",
      pageName: page.page_name,
      templateName: `${template.display_name} v${template.version}`,
      renderedText,
      expiresInMinutes: 15
    });
  }));

  router.post("/customer-updates/send", asyncRoute(async (req, res) => {
    const body = z.object({ preview_token: z.string().min(20), confirmed: z.literal(true) }).parse(req.body);
    let preview;
    try {
      preview = verifyUtilityPreview(body.preview_token);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    if (preview.companyId !== req.companyId || preview.userId !== req.user.id) {
      return res.status(403).json({ error: "Preview this Customer Update again from the current workspace." });
    }
    const existing = await prisma.customerUpdateDelivery.findUnique({ where: { idempotency_key: preview.nonce } });
    if (existing) {
      if (existing.status === "sent") return res.json({ ok: true, alreadySent: true, delivery: existing });
      return res.status(409).json({ error: "This confirmed preview was already used. Create a new preview." });
    }
    const [page, conversation, template] = await Promise.all([
      prisma.facebookPage.findFirst({ where: { id: preview.pageId, company_id: req.companyId, status: "active" } }),
      prisma.conversation.findFirst({
        where: { id: preview.conversationId, company_id: req.companyId, facebook_page_id: preview.pageId, psid: { not: null } }
      }),
      prisma.customerUpdateTemplate.findFirst({
        where: { id: preview.templateId, company_id: req.companyId, facebook_page_id: preview.pageId, active: true, status: "APPROVED" }
      })
    ]);
    if (!page || !conversation || !template) {
      return res.status(409).json({ error: "The Page, customer, or approved template changed. Preview the update again." });
    }
    const runtime = runtimeTemplate(template);
    const renderedText = renderUtilityTemplate(runtime, preview.variables);
    if (renderedText !== preview.renderedText) return res.status(409).json({ error: "The template changed. Preview the update again." });
    let delivery;
    try {
      delivery = await prisma.customerUpdateDelivery.create({
        data: {
          company_id: req.companyId,
          facebook_page_id: page.id,
          conversation_id: conversation.id,
          template_id: template.id,
          status: "sending",
          recipient_name: conversation.customer_name,
          recipient_psid: conversation.psid,
          variables: preview.variables,
          rendered_text: renderedText,
          idempotency_key: preview.nonce,
          created_by_email: req.user.email
        }
      });
    } catch (error) {
      if (error.code === "P2002") return res.status(409).json({ error: "This confirmed preview was already used." });
      throw error;
    }
    try {
      const token = decryptSecret(page.page_access_token_encrypted);
      if (!token) throw new Error("The connected Facebook Page needs to be reconnected.");
      const result = await sendMetaUtilityMessage({
        pageId: page.page_id,
        psid: conversation.psid,
        token,
        template: runtime,
        variables: preview.variables,
        fetchImpl: fetch
      });
      const sentAt = new Date();
      const [saved] = await prisma.$transaction([
        prisma.customerUpdateDelivery.update({
          where: { id: delivery.id },
          data: { status: "sent", meta_message_id: result.message_id ? String(result.message_id) : null, meta_error: null, sent_at: sentAt }
        }),
        prisma.message.create({
          data: {
            company_id: req.companyId,
            conversation_id: conversation.id,
            sender_type: "admin",
            sender_id: req.user.id,
            message_text: renderedText,
            ai_generated: false
          }
        }),
        prisma.conversation.update({ where: { id: conversation.id }, data: { last_message_at: sentAt } })
      ]);
      res.json({ ok: true, alreadySent: false, delivery: saved });
    } catch (error) {
      await expirePageOnOAuthError(page, error);
      await prisma.customerUpdateDelivery.update({
        where: { id: delivery.id },
        data: { status: "failed", meta_error: String(error.message).slice(0, 1000) }
      }).catch(() => null);
      res.status(502).json({ error: error.message });
    }
  }));

  return router;
}

module.exports = { buildCustomerUpdateRouter };
