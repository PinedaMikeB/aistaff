require("dotenv").config({ override: true });
const __mr = require("../src/model-registry"); if (process.env.SIM_MODEL) { const [prov, mod] = process.env.SIM_MODEL.split(":"); __mr.getModelFor = async () => ({ provider: prov, model: mod }); }
const { prisma } = require("../src/db");
const { generateSalesReply } = require("../src/ai");
const companyId = process.env.COMPANY_ID || "f4c170f3-16b2-4172-82bd-b850467c41ed"; // default: Marga Enterprises
const turns = JSON.parse(process.argv[2]);
(async () => {
  const conv = await prisma.conversation.create({ data: { company_id: companyId, channel: "simulation", customer_name: "Blueprint Simulation", status: "open" } });
  for (const text of turns) {
    await prisma.message.create({ data: { company_id: companyId, conversation_id: conv.id, sender_type: "customer", message_text: text } });
    const started = new Date();
    let ai;
    try { ai = await generateSalesReply({ companyId, conversationId: conv.id, message: text }); }
    catch (e) { console.log("\nCUSTOMER:", text, "\nERROR:", e.message); break; }
    const calls = await prisma.businessOperationRequest.findMany({ where: { conversation_id: conv.id, updated_at: { gte: started } }, include: { tenant_operation: { include: { definition: true } } }, orderBy: { updated_at: "asc" } });
    console.log("\nCUSTOMER:", text);
    for (const c of calls) console.log("  tool:", c.tenant_operation.definition.operation_key, c.status, JSON.stringify(c.requested_arguments).slice(0, 220));
    console.log("CLOSER:", ai.reply, ai.model ? `[${ai.model}]` : "", ai.needsHuman ? `(HANDOFF: ${String(ai.handoffReason).slice(0,80)})` : "");
    await prisma.message.create({ data: { company_id: companyId, conversation_id: conv.id, sender_type: "ai", message_text: ai.reply || "", ai_generated: true } });
  }
  await prisma.integrationExecution.updateMany({ where: { conversation_id: conv.id, status: "pending_customer_confirmation" }, data: { status: "superseded", completed_at: new Date() } });
  await prisma.businessOperationRequest.updateMany({ where: { conversation_id: conv.id, status: { in: ["collecting", "pending_customer_confirmation"] } }, data: { status: "cancelled" } });
  await prisma.conversation.delete({ where: { id: conv.id } }).catch(() => {});
  console.log("\n(simulation cleaned up; nothing committed)");
  await prisma.$disconnect();
})().catch((e) => { console.error("ERR", e.stack); process.exit(1); });
