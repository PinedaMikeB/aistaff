// Brandee business-goal mapping — structured data + goal-correction heuristic.
// BusinessGoal values match the goal-selector slugs already shipped on
// public/agents/brandee/index.html (#goal-selector `data-goal` attributes).

const BUSINESS_GOALS = ["purchase", "messages", "booking", "signup", "visit", "discover", "recover"];

const GOAL_MAPPINGS = {
  purchase: {
    label: "Buy a product",
    preferredHookCategories: ["direct", "problem", "question", "curiosity", "social_proof"],
    preferredFrameworks: ["offer", "features-and-benefits", "question", "testimonial", "us-vs-them", "reasons-why"],
    ctaExamples: ["Shop now", "Order now and get it delivered", "Add to cart today"]
  },
  messages: {
    label: "Send a message",
    preferredHookCategories: ["question", "problem", "curiosity", "authority"],
    preferredFrameworks: ["question", "reasons-why", "bold-claim", "iphone-notes", "features-and-benefits"],
    ctaExamples: ["Send us a message", "Ask which option fits your business", "Message us for a recommendation", "Request details through Messenger"]
  },
  booking: {
    label: "Book an appointment",
    preferredHookCategories: ["problem", "question", "authority", "social_proof"],
    preferredFrameworks: ["question", "testimonial", "before-and-after", "reasons-why", "bold-claim"],
    ctaExamples: ["Book your appointment", "Reserve your slot today", "Schedule a consultation"]
  },
  signup: {
    label: "Register or sign up",
    preferredHookCategories: ["curiosity", "direct", "authority", "urgency"],
    preferredFrameworks: ["bold-claim", "reasons-why", "offer", "iphone-notes"],
    ctaExamples: ["Register today", "Save your spot", "Sign up now"]
  },
  visit: {
    label: "Visit your store",
    preferredHookCategories: ["direct", "curiosity", "urgency"],
    preferredFrameworks: ["offer", "reasons-why", "question", "sticky-notes"],
    ctaExamples: ["Visit us today", "Drop by this week", "Come see it in person"]
  },
  discover: {
    label: "Discover a new product",
    preferredHookCategories: ["curiosity", "question", "direct"],
    preferredFrameworks: ["bold-claim", "features-and-benefits", "reasons-why", "question", "iphone-notes"],
    ctaExamples: ["See what's new", "Discover the difference", "Learn more"]
  },
  recover: {
    label: "Return and complete a purchase",
    preferredHookCategories: ["problem", "direct", "social_proof", "urgency"],
    preferredFrameworks: ["offer", "testimonial", "reasons-why", "features-and-benefits"],
    ctaExamples: ["Finish your order", "Come back and save your cart", "Complete your purchase"]
  }
};

const SERVICE_KEYWORDS = [
  "rental", "rent", "service", "consultation", "clinic", "repair", "maintenance",
  "installation", "install", "quotation", "quote", "booking", "appointment",
  "agency", "professional", "contractor", "leasing", "lease", "subscription plan"
];

const ECOMMERCE_SIGNALS = ["add to cart", "buy now", "shop now", "checkout", "free shipping", "in stock"];

/**
 * Heuristic goal correction. This does not overrule the user's choice — it
 * only produces a recommendation + explanation. The caller/UI always lets
 * the visitor keep their original goal.
 */
function correctGoal({ selectedGoal, businessAnalysis }) {
  const summary = `${businessAnalysis?.summary || ""} ${businessAnalysis?.industry || ""}`.toLowerCase();
  const isServiceLike = businessAnalysis?.businessType === "service"
    || businessAnalysis?.businessType === "both"
    || SERVICE_KEYWORDS.some((kw) => summary.includes(kw));
  const hasEcommerceSignals = ECOMMERCE_SIGNALS.some((kw) => summary.includes(kw));

  if (selectedGoal === "purchase" && isServiceLike && !hasEcommerceSignals) {
    return {
      recommendedGoal: "messages",
      goalChanged: true,
      explanation: "This appears to be a considered service purchase rather than an immediate online checkout. A message-focused video may be more appropriate because customers may need to discuss requirements, scope, location, and terms before buying."
    };
  }

  if (selectedGoal === "visit" && (businessAnalysis?.locations || []).length === 0 && !summary.includes("store") && !summary.includes("branch")) {
    return {
      recommendedGoal: "messages",
      goalChanged: true,
      explanation: "No physical location was found on the website. A message-focused video may work better until a specific store or branch address is confirmed."
    };
  }

  if (selectedGoal === "purchase" && (businessAnalysis?.productsOrServices || []).length === 0 && !hasEcommerceSignals) {
    return {
      recommendedGoal: "messages",
      goalChanged: true,
      explanation: "No specific priced products were found on the website. A message-focused video lets Brandee generate interest first, while your team confirms pricing directly with the customer."
    };
  }

  return {
    recommendedGoal: selectedGoal,
    goalChanged: false,
    explanation: "The selected goal fits what Brandee found about this business."
  };
}

function getGoalMapping(goal) {
  return GOAL_MAPPINGS[goal] || null;
}

module.exports = { BUSINESS_GOALS, GOAL_MAPPINGS, getGoalMapping, correctGoal };
