export type CloserKnowledgeScene = {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  narration: string;
  bullets: string[];
  visual: "brain" | "workspace" | "identity" | "pricing" | "media" | "rules" | "channels" | "loop";
  audioFile: string;
  durationSeconds: number;
};

export const closerKnowledgeScenes: CloserKnowledgeScene[] = [
  {
    id: "scene-01",
    eyebrow: "THE BIG IDEA",
    title: "Closer does not guess.",
    subtitle: "It answers from the information you approve.",
    narration:
      "Closer does not guess. It works from the information you give it: your business details, products, prices, photos, rules, and the way you want customers handled.",
    bullets: ["Approved knowledge", "Business rules", "Customer-ready answers"],
    visual: "brain",
    audioFile: "voiceovers/closer-knowledge-explainer/scene-01.mp3",
    durationSeconds: 9.221
  },
  {
    id: "scene-02",
    eyebrow: "STEP 1",
    title: "Open your tenant workspace.",
    subtitle: "This is where each company teaches its own Closer.",
    narration:
      "First, open your tenant workspace. This is the control room for one company. Each customer has their own workspace, their own knowledge base, and their own settings.",
    bullets: ["One company workspace", "Private knowledge base", "Own Closer settings"],
    visual: "workspace",
    audioFile: "voiceovers/closer-knowledge-explainer/scene-02.mp3",
    durationSeconds: 8.777
  },
  {
    id: "scene-03",
    eyebrow: "STEP 2",
    title: "Tell Closer who you are.",
    subtitle: "Start with the business profile and what you sell.",
    narration:
      "Start with the basics: who you are, what you sell, your service area, your contact details, and what kind of customers you want Closer to qualify.",
    bullets: ["Business profile", "Service area", "Ideal customer details"],
    visual: "identity",
    audioFile: "voiceovers/closer-knowledge-explainer/scene-03.mp3",
    durationSeconds: 8.307
  },
  {
    id: "scene-04",
    eyebrow: "STEP 3",
    title: "Add products, prices, and conditions.",
    subtitle: "This is the sales information customers ask about most.",
    narration:
      "Next, add your products, services, pricing, inclusions, promos, payment terms, delivery rules, and anything Closer must never invent. This is the sales truth it will use in chat.",
    bullets: ["Products and prices", "Promos and payment terms", "Rules Closer must follow"],
    visual: "pricing",
    audioFile: "voiceovers/closer-knowledge-explainer/scene-04.mp3",
    durationSeconds: 11.128
  },
  {
    id: "scene-05",
    eyebrow: "STEP 4",
    title: "Upload files Closer can send.",
    subtitle: "Photos, posters, videos, PDFs, and price cards can become chat replies.",
    narration:
      "If customers need to see something, upload it. Product photos, posters, price cards, videos, and PDFs can be attached to knowledge entries, so Closer can send the right file at the right moment.",
    bullets: ["Product photos", "Price cards and posters", "PDFs and videos"],
    visual: "media",
    audioFile: "voiceovers/closer-knowledge-explainer/scene-05.mp3",
    durationSeconds: 11.363
  },
  {
    id: "scene-06",
    eyebrow: "STEP 5",
    title: "Set the behavior in AI Studio.",
    subtitle: "This is where the general prompt guides how Closer talks.",
    narration:
      "Then set the behavior in AI Studio. The platform general prompt and tenant settings tell Closer the tone, language behavior, qualification flow, handoff rules, and what to do next.",
    bullets: ["Tone and language", "Qualification flow", "Handoff and next steps"],
    visual: "rules",
    audioFile: "voiceovers/closer-knowledge-explainer/scene-06.mp3",
    durationSeconds: 10.553
  },
  {
    id: "scene-07",
    eyebrow: "ONE SHARED BRAIN",
    title: "Messenger and website chat use the same source.",
    subtitle: "Update knowledge once. Closer picks it up everywhere.",
    narration:
      "The same brain can power Messenger and the website chat widget. If you update the knowledge base or the AI Studio rules, both channels can use the latest approved information.",
    bullets: ["Messenger replies", "Website chat replies", "Same approved knowledge"],
    visual: "channels",
    audioFile: "voiceovers/closer-knowledge-explainer/scene-07.mp3",
    durationSeconds: 8.62
  },
  {
    id: "scene-08",
    eyebrow: "KEEP IT CURRENT",
    title: "When the business changes, update the brain.",
    subtitle: "Closer gets smarter because the business keeps its knowledge clean.",
    narration:
      "When prices change, promos expire, new products launch, or policies update, edit the knowledge base. Closer stays useful because your team keeps the source of truth clean.",
    bullets: ["Update prices", "Expire old promos", "Keep answers accurate"],
    visual: "loop",
    audioFile: "voiceovers/closer-knowledge-explainer/scene-08.mp3",
    durationSeconds: 9.744
  }
];

export const closerKnowledgeTotalSeconds = closerKnowledgeScenes.reduce(
  (total, scene) => total + scene.durationSeconds,
  0
);
