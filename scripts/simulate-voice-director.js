// Simulated phone call through src/voice-director.js (no Pitch, no audio). Usage:
//   node scripts/simulate-voice-director.js "[\"line 1\",\"line 2\"]" [callerNumber]
require("dotenv").config({ override: true });
const { prisma } = require("../src/db");
const vd = require("../src/voice-director");
const companyId = process.env.COMPANY_ID || "f4c170f3-16b2-4172-82bd-b850467c41ed";
const lines = JSON.parse(process.argv[2]);
const caller = process.argv[3] || "";
(async () => {
  const conv = await prisma.conversation.create({ data: { company_id: companyId, channel: "simulation", customer_name: "Voice simulation", status: "open", ai_history_from: new Date() } });
  console.log("ANNE: Hello, this is Anne, Marga Enterprises’ AI assistant. How can I help you today?");
  for (const text of lines) {
    const t0 = Date.now();
    const out = await vd.turn({ conversation: conv, companyId, message: text, caller }).catch((e) => ({ reply: "ERROR " + e.stack }));
    console.log(`CALLER: ${text}\nANNE:   ${out?.reply} (${Date.now() - t0} ms)`);
  }
  await prisma.integrationExecution.updateMany({ where: { conversation_id: conv.id, status: "pending_customer_confirmation" }, data: { status: "superseded", completed_at: new Date() } });
  await prisma.businessOperationRequest.updateMany({ where: { conversation_id: conv.id, status: { in: ["collecting", "pending_customer_confirmation"] } }, data: { status: "cancelled" } });
  await prisma.conversation.delete({ where: { id: conv.id } }).catch(() => {});
  console.log("(simulation cleaned up; nothing saved)");
  await prisma.$disconnect();
})().catch((e) => { console.error("ERR", e.stack); process.exit(1); });
