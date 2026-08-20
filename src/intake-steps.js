/**
 * Intake wizard: the questions, in order, and the industry packs that reorder
 * and relabel them.
 *
 * DESIGN RULE: an industry pack changes WHICH questions are asked and in what
 * order. It must never change storage, schema, or code path. The moment
 * industry forks the code there are five products to maintain. Adding "church"
 * is a config entry below, not a feature.
 *
 * COPY RULE: the `why` line on each step is product copy, written by us, shown
 * to the business owner in their dashboard. That is NOT a rule 2 violation —
 * rule 2 forbids storing sentences for the AGENT to recite to a CUSTOMER.
 *
 * RULE 1: there is no language step, no locale option, no "reply in Tagalog"
 * toggle. Do not add one however natural it looks in a settings wizard.
 */

const { KINDS } = require("./knowledge-base");

const PAIN_INDUSTRY_TEMPLATES = {
  General: {
    pains: [
      "Customers ask the same basic questions repeatedly",
      "Inquiries arrive outside office hours",
      "Leads go cold before staff can reply",
      "Customers are unsure which option fits them",
      "Manual follow-up takes too much staff time",
      "Customers need price, policy and next-step clarity"
    ],
    solutions: [
      "Reply quickly with accurate business information",
      "Recommend the right offer based on the customer's need",
      "Collect the details needed before staff steps in",
      "Move interested customers to quote, booking or payment",
      "Hand off only when human judgment is needed",
      "Keep the conversation warm and moving"
    ],
    outcomes: [
      "Fewer missed inquiries",
      "Faster customer decisions",
      "More complete lead details",
      "Less repetitive staff work",
      "Clearer buying or booking path",
      "Higher trust through consistent answers"
    ]
  },
  "AI Voice and Chat Agent Service": {
    pains: [
      "Business owners miss inquiries when staff are busy or offline",
      "Staff answer the same questions about price, availability and process every day",
      "Hot leads go cold because follow-up is delayed",
      "Customers ask how to avail but are sent to a long website path",
      "Manual quoting, booking and payment steps create friction",
      "The owner cannot monitor every Messenger conversation",
      "Voice calls are missed outside office hours",
      "Leads arrive incomplete, so staff still need to ask basic details"
    ],
    solutions: [
      "Reply instantly inside Messenger, website chat or voice channels",
      "Answer from the business's approved knowledge base",
      "Recommend the right package or next step",
      "Collect name, contact details, requirements and payment details",
      "Move hot buyers directly to booking, quotation or QR/payment link",
      "Hand off qualified leads to staff with useful context",
      "Use live data only after the tenant's systems are connected",
      "Keep follow-up moving while staff focus on higher-value work"
    ],
    outcomes: [
      "More inquiries become qualified leads",
      "Fewer missed after-hours opportunities",
      "Faster payment or booking completion",
      "Less repetitive work for staff",
      "More complete customer information",
      "A smoother Messenger-first sales experience",
      "Better visibility into hot conversations",
      "More time back for the owner and team"
    ]
  },
  "Real estate": {
    pains: [
      "Buyers ask if a property is still available",
      "Renters want location, price and terms before viewing",
      "Leads disappear before a viewing is scheduled",
      "Customers ask for financing or payment terms",
      "Staff repeats the same property details all day",
      "Incomplete buyer details make qualification slow"
    ],
    solutions: [
      "Show matching properties based on budget and location",
      "Collect buyer/renter name, contact, budget and preferred area",
      "Explain viewing, reservation and document requirements",
      "Send available property details from the knowledge base",
      "Hand off hot buyers to an agent for viewing",
      "Use live availability only after property system is connected"
    ],
    outcomes: [
      "More qualified viewing requests",
      "Less time wasted on unqualified leads",
      "Faster response to property inquiries",
      "Clearer reservation next steps",
      "Better buyer/renter matching",
      "Fewer missed serious prospects"
    ]
  },
  "Car dealership": {
    pains: [
      "Buyers ask if a unit is still available",
      "Customers compare models, price and financing",
      "Trade-in and downpayment questions slow the sale",
      "Leads ask many questions but do not visit",
      "Staff repeats the same specs and promo details",
      "Incomplete customer details delay loan assessment"
    ],
    solutions: [
      "Recommend units based on budget and usage",
      "Collect name, contact, preferred model and budget",
      "Explain downpayment, promo and viewing/test-drive steps",
      "Send unit details from the knowledge base",
      "Hand off hot buyers to sales staff",
      "Confirm availability only when inventory is connected or staff confirms"
    ],
    outcomes: [
      "More test-drive or viewing appointments",
      "Better-qualified car buyers",
      "Faster reply to price and promo questions",
      "Less repetitive work for sales agents",
      "Clearer next step for financing",
      "Reduced chance of promising unavailable units"
    ]
  },
  School: {
    pains: [
      "Parents ask the same enrollment questions",
      "Tuition, requirements and schedule details are hard to find",
      "Inquiries come after office hours",
      "Parents need help choosing the right program or grade level",
      "Staff manually follows up incomplete applications",
      "Event and admission dates change"
    ],
    solutions: [
      "Answer tuition, requirements and enrollment steps",
      "Collect student level, parent name and contact details",
      "Guide parents to the correct program or office",
      "Explain deadlines and document requirements from approved info",
      "Hand off qualified applicants to admissions staff",
      "Use live calendars only when school schedules are connected"
    ],
    outcomes: [
      "More complete enrollment inquiries",
      "Faster parent support",
      "Less repeated admin work",
      "Clearer application next steps",
      "Better-qualified admissions leads",
      "Fewer missed after-hours inquiries"
    ]
  },
  Gym: {
    pains: [
      "Prospects ask about rates, schedules and inclusions",
      "People hesitate because they are unsure which plan fits",
      "Trial, class and personal training slots need confirmation",
      "Staff repeats membership details every day",
      "Leads forget to book a visit",
      "Promos expire and get misquoted"
    ],
    solutions: [
      "Recommend membership or training options",
      "Explain rates, promos and inclusions",
      "Collect fitness goal, preferred schedule and contact details",
      "Move prospects to trial, visit, booking or payment",
      "Hand off personal training questions to staff",
      "Check schedules only after live calendar connection"
    ],
    outcomes: [
      "More booked trials or visits",
      "Faster membership decisions",
      "Clearer plan recommendations",
      "Less repetitive staff messaging",
      "Better follow-up on interested prospects",
      "Fewer incorrect promo quotes"
    ]
  },
  Salon: {
    pains: [
      "Customers ask prices for services and packages",
      "Appointment slots need staff confirmation",
      "Clients are unsure which treatment fits their concern",
      "Staff repeats location, schedule and promo details",
      "Clients ask for before-and-after or service expectations",
      "Last-minute booking questions interrupt staff"
    ],
    solutions: [
      "Recommend services based on the customer's concern",
      "Explain service price, duration and basic expectations",
      "Collect name, mobile, preferred service and schedule",
      "Move clients to booking or reservation fee when configured",
      "Send approved photos or describe available media",
      "Confirm slots only after calendar or staff confirmation"
    ],
    outcomes: [
      "More complete booking requests",
      "Less interruption during service hours",
      "Faster client decisions",
      "Clearer service expectations",
      "Better upsell to packages",
      "Fewer missed appointment inquiries"
    ]
  },
  "Repair service": {
    pains: [
      "Customers ask if an item can be repaired",
      "Staff needs model, issue and location before quoting",
      "Customers want price before diagnosis",
      "Repair status and schedule questions repeat often",
      "Urgent inquiries arrive outside office hours",
      "Incomplete details slow dispatch or assessment"
    ],
    solutions: [
      "Collect item type, model, issue, photos if available and location",
      "Explain assessment, quotation and repair process",
      "Set expectations when exact price needs diagnosis",
      "Route urgent or complex cases to staff",
      "Move qualified customers to booking or service request",
      "Check technician slots only after live schedule connection"
    ],
    outcomes: [
      "More complete repair requests",
      "Faster diagnosis handoff",
      "Less back-and-forth before quoting",
      "Better expectation setting",
      "Fewer missed urgent inquiries",
      "More efficient technician scheduling"
    ]
  },
  Hotel: {
    pains: [
      "Guests ask if rooms are available for specific dates",
      "Customers compare room types, inclusions and rates",
      "Reservation and downpayment terms need clear explanation",
      "Staff repeats check-in, amenities and policy details",
      "Guests abandon when booking steps are unclear",
      "Room availability changes quickly"
    ],
    solutions: [
      "Recommend room types based on guests, dates and budget",
      "Collect check-in date, nights, guest count and contact details",
      "Explain inclusions, policies and reservation steps",
      "Move ready guests to booking link or reservation fee",
      "Hand off special requests to staff",
      "Confirm room availability only after booking system connection or staff confirmation"
    ],
    outcomes: [
      "More complete booking inquiries",
      "Faster reservation decisions",
      "Less repetitive front-desk messaging",
      "Clearer guest expectations",
      "Reduced booking friction",
      "Fewer promises on unavailable rooms"
    ]
  },
  Restaurant: {
    pains: [
      "Customers ask menu prices and availability",
      "Table reservations need date, time and headcount",
      "Delivery area and fee questions repeat often",
      "Customers abandon when ordering steps are unclear",
      "Staff is busy during peak hours",
      "Promos and sold-out items change"
    ],
    solutions: [
      "Answer menu, promo, delivery and reservation questions",
      "Collect order details, date/time, headcount or delivery address",
      "Recommend best-sellers, bundles or packages",
      "Move customers to order, reservation or payment step",
      "Hand off catering or special requests to staff",
      "Confirm item/table availability only after live system or staff confirmation"
    ],
    outcomes: [
      "More complete orders or reservations",
      "Less interruption during peak hours",
      "Faster customer decisions",
      "Clearer delivery expectations",
      "Better promo conversion",
      "Fewer missed food inquiries"
    ]
  },
  Church: {
    pains: [
      "Visitors ask service times, location and what to expect",
      "People need help finding ministries or events",
      "Questions arrive outside office hours",
      "Staff repeats the same event details",
      "Sensitive pastoral concerns need human care",
      "Schedules change and can become outdated"
    ],
    solutions: [
      "Answer service, event and location questions from approved info",
      "Collect visitor name and contact when follow-up is requested",
      "Guide people to the right ministry or next step",
      "Hand off pastoral, counseling or safety concerns to leaders",
      "Use calendars only when schedules are maintained",
      "Avoid speaking beyond the church's stated beliefs"
    ],
    outcomes: [
      "Visitors feel welcomed quickly",
      "Less repeated admin messaging",
      "Better follow-up for new visitors",
      "Clearer event information",
      "Sensitive cases reach human leaders",
      "Fewer missed community inquiries"
    ]
  },
  Clinic: {
    pains: [
      "Patients ask prices, treatment options and schedules",
      "Appointment slots need confirmation",
      "Patients are unsure which service fits their concern",
      "Staff repeats requirements, location and promo details",
      "Medical questions need safe human handling",
      "Incomplete details slow appointment booking"
    ],
    solutions: [
      "Explain services, packages, prices and general expectations",
      "Collect name, contact, concern and preferred schedule",
      "Recommend consultation or service options only from approved info",
      "Hand off medical, diagnosis or prescription questions to staff",
      "Move ready patients to appointment or reservation step",
      "Confirm slots only after calendar/system connection or staff confirmation"
    ],
    outcomes: [
      "More complete appointment inquiries",
      "Faster patient support",
      "Less repetitive front-desk work",
      "Safer handling of medical questions",
      "Clearer treatment next steps",
      "Fewer missed patient messages"
    ]
  },
  Retail: {
    pains: [
      "Customers ask if an item is available",
      "Price, size, color and delivery questions repeat often",
      "Customers ask then disappear before checkout",
      "Staff manually answers the same product questions",
      "Order details arrive incomplete",
      "Payment and delivery steps create friction"
    ],
    solutions: [
      "Recommend items based on need, size, budget or preference",
      "Answer price, promo, delivery and policy questions",
      "Collect name, mobile, item, quantity and delivery address",
      "Move ready buyers to payment or checkout",
      "Hand off special requests to staff",
      "Confirm stock only after inventory connection or staff confirmation"
    ],
    outcomes: [
      "More complete order details",
      "Faster buyer decisions",
      "Less repetitive seller messaging",
      "Reduced checkout friction",
      "Better follow-up on interested buyers",
      "Fewer promises on unavailable stock"
    ]
  }
};

/**
 * Ordered by what breaks a conversation soonest. Irene's real thread reached
 * "can you send me prices" in three messages, so pricing sits early.
 */
const STEPS = [
  {
    id: "identity",
    title: "Who you are and what you sell",
    why: "Without this your agent answers like a generic assistant. With it, every reply sounds like your business.",
    kind: KINDS.PROSE,
    category: "Business",
    required: true,
    fields: [
      { name: "answer", label: "What do you sell, and who usually buys it?", type: "textarea", required: true },
      { name: "areas", label: "Areas or branches you serve", type: "text" }
    ]
  },
  {
    id: "pain_solutions",
    title: "Pain points and solutions",
    why: "This is where Closer learns why customers should care. The owner or manager can say what pain the business solves, what outcome customers want, and which solution angle Closer should use when selling.",
    kind: KINDS.PAIN_SOLUTION,
    category: "Pain points",
    required: false,
    painSetup: true,
    painTemplates: PAIN_INDUSTRY_TEMPLATES,
    structured: true,
    rowLabels: { label: "Pain/problem", value: "Solution", note: "Outcome" },
    fields: [
      {
        name: "pain_industry",
        label: "Choose a business category for suggested pain points",
        type: "select",
        options: Object.keys(PAIN_INDUSTRY_TEMPLATES),
        default: "General"
      },
      {
        name: "pain_solution_notes",
        label: "Describe the pains you solve and the solution you offer, if you already know it",
        type: "textarea",
        placeholder: "Example: Our customers are busy business owners who miss inquiries after office hours. We help them reply instantly, qualify buyers, and collect payment details without hiring another staff member."
      },
      {
        name: "customer_pains",
        label: "Common customer pain points",
        type: "checkbox_group",
        allowOther: true,
        templateKey: "pains",
        options: PAIN_INDUSTRY_TEMPLATES.General.pains
      },
      {
        name: "solutions_offered",
        label: "Solutions or advantages to offer",
        type: "checkbox_group",
        allowOther: true,
        templateKey: "solutions",
        options: PAIN_INDUSTRY_TEMPLATES.General.solutions
      },
      {
        name: "outcomes_to_emphasize",
        label: "Outcomes Closer should emphasize",
        type: "checkbox_group",
        allowOther: true,
        templateKey: "outcomes",
        options: PAIN_INDUSTRY_TEMPLATES.General.outcomes
      }
    ]
  },
  {
    id: "products",
    title: "Products, services and prices",
    why: "This is the first thing customers ask and the most common reason an agent stalls. Give it prices and it can answer instead of promising a callback.",
    kind: KINDS.PRICELIST,
    category: "Pricing",
    required: true,
    allowUpload: true,
    uploadHint: "Upload a price list — a photo of a poster, a PDF, or a spreadsheet. We read the prices out of it.",
    fields: [
      // "What is this list?" removed 2026-08-17 — it defaulted to "Price list"
      // and read as bureaucracy on a first run. The server falls back to the
      // step title, so nothing downstream needs it.
      { name: "answer", label: "Manual written entry — products or services, and their prices", type: "textarea", required: true },
      { name: "currency", label: "Currency", type: "select", options: ["PHP", "USD"], default: "PHP" }
    ]
  },
  {
    id: "promos",
    title: "Promos, bundles and discounts",
    why: "An expired promo quoted to a customer is worse than no promo at all. Give each one an end date and the agent stops mentioning it on its own.",
    kind: KINDS.PROMO,
    category: "Promos",
    required: false,
    validityDefault: "30",
    fields: [
      { name: "title", label: "Promo name", required: true },
      { name: "answer", label: "What is the offer, and what are the conditions?", type: "textarea", required: true },
      { name: "valid_until", label: "How long does it run?", type: "validity" }
    ]
  },
  {
    id: "media",
    title: "Photos, posters and videos",
    why: "A customer asking what something looks like should see it, not read a description. Tag each file to what it shows so the agent picks the right one.",
    kind: KINDS.MEDIA,
    category: "Media",
    required: false,
    allowUpload: true,
    uploadHint: "Upload product photos, promo posters or short videos.",
    fields: [
      { name: "title", label: "What does this show?", required: true },
      { name: "answer", label: "Manual written entry — when should the agent send it?", type: "textarea" }
    ]
  },
  {
    id: "payments",
    title: "Payment and checkout",
    why: "Ready buyers stall when payment instructions are unclear. Tell Closer whether to collect payment in chat, send a booking link, quote first, or hand off — using your business's real payment process.",
    kind: KINDS.PAYMENT,
    category: "Payment",
    required: false,
    paymentSetup: true,
    fields: [
      {
        name: "payment_policy_text",
        label: "Existing payment terms or policy notes, if you already have one",
        type: "textarea",
        placeholder: "Paste your existing payment policy here. Example: Downpayments are non-refundable once the slot is reserved. Orders are confirmed only after payment is verified."
      },
      {
        name: "payment_acceptance",
        label: "Do you accept payment from inquiries?",
        type: "checkbox_group",
        allowOther: true,
        options: [
          "Yes, full payment",
          "Yes, deposit/downpayment only",
          "Yes, reservation/booking fee only",
          "No payment in chat, booking/inquiry only",
          "No payment at all, human will quote first"
        ]
      },
      {
        name: "preferred_closing_path",
        label: "Preferred closing path",
        type: "checkbox_group",
        allowOther: true,
        options: [
          "Collect payment inside Messenger/chat",
          "Book appointment inside Messenger/chat without payment",
          "Book appointment inside Messenger/chat with payment",
          "Reserve inside Messenger/chat without downpayment",
          "Reserve inside Messenger/chat with payment/downpayment",
          "Send customer to website checkout",
          "Send booking/reservation link",
          "Hand off to staff",
          "Quote first, payment later"
        ]
      },
      {
        name: "payment_methods",
        label: "Payment methods accepted",
        type: "checkbox_group",
        allowOther: true,
        options: [
          "QRPh",
          "GCash",
          "Maya",
          "Card",
          "Bank transfer",
          "Cash on delivery",
          "Pay at branch/store",
          "Website checkout"
        ]
      },
      { name: "provider_source", label: "Payment provider or link source", type: "text", placeholder: "PayMongo, Shopify, booking engine, Calendly, bank QR, POS, manual staff link..." },
      {
        name: "collect_before_payment",
        label: "What must Closer collect before payment?",
        type: "checkbox_group",
        allowOther: true,
        options: [
          "Name",
          "Email",
          "Mobile",
          "Product/package chosen",
          "Quantity",
          "Delivery address",
          "Booking date/time",
          "Branch/location",
          "Special notes"
        ]
      },
      {
        name: "amount_rules",
        label: "Amount rules",
        type: "checkbox_group",
        allowOther: true,
        options: [
          "Full amount",
          "Fixed deposit",
          "Percentage deposit",
          "Reservation fee",
          "Staff confirms amount first",
          "Different rules per product/service"
        ]
      },
      { name: "fixed_deposit_amount", label: "If fixed deposit/downpayment, how much?", type: "text", placeholder: "Example: ₱500, ₱2,000, or one night" },
      { name: "percentage_deposit", label: "If percentage deposit, what percent?", type: "text", placeholder: "Example: 30%" },
      { name: "reservation_fee_amount", label: "If reservation/booking fee, how much?", type: "text", placeholder: "Example: ₱1,000 reservation fee" },
      { name: "website_checkout_url", label: "Website checkout link, if any", type: "text", placeholder: "https://..." },
      { name: "booking_link", label: "Booking or reservation link, if any", type: "text", placeholder: "https://..." },
      { name: "customer_instructions", label: "Customer payment instructions", type: "textarea", placeholder: "Example: After they choose a plan, ask for name and email, then send the QRPh link. Tell them they can download the QR and upload it in GCash." },
      {
        name: "must_not_do",
        label: "What Closer must not do",
        type: "checkbox_group",
        allowOther: true,
        defaultChecked: true,
        options: [
          "Do not ask for OTP",
          "Do not ask for passwords",
          "Do not claim payment is received unless confirmed",
          "Do not accept screenshot as final proof unless staff verifies",
          "Do not promise booking confirmation unless calendar/system confirms"
        ]
      },
      {
        name: "after_payment",
        label: "After payment",
        type: "checkbox_group",
        allowOther: true,
        options: [
          "Tell them payment is being verified",
          "Confirm automatically when webhook says paid",
          "Hand off to staff",
          "Send onboarding/setup steps",
          "Book appointment after details are collected",
          "Reserve slot/order after details are collected",
          "Reserve slot/order only after confirmation"
        ]
      }
    ]
  },
  {
    id: "shipping",
    title: "Delivery, shipping and lead time",
    why: "\"How much to ship to Cebu?\" loses sales when the answer is a callback. Give the agent your rates however you have them and it reads instead of guessing.",
    kind: KINDS.SHIPPING,
    category: "Shipping",
    required: false,
    structured: true,
    // Rows are no longer pre-seeded empty. Three businesses arrive here with
    // three different shapes and all must work:
    //   1. a courier rate card (J&T, LBC) — a weight x region MATRIX, which a
    //      flat area/fee list cannot hold, so upload and let extraction flatten
    //      it into one line per combination;
    //   2. an exported CSV from their courier;
    //   3. no table at all — "free within Metro Manila, we don't ship outside"
    //      is the whole policy for a lot of small sellers, and asking them to
    //      fill a grid for that is friction with nothing at the end of it.
    // Uploading builds the rows; the paragraph covers everyone else.
    rowLabels: { label: "Area / weight", value: "Fee", note: "Lead time" },
    allowUpload: true,
    uploadHint: "Upload your courier's rate card — a photo of a J&T or LBC poster, a PDF, or a CSV export. We turn it into rates you can check line by line.",
    fields: [
      { name: "answer", label: "Or just describe it — a paragraph is fine (\"Free delivery within Metro Manila, we don't ship outside\"), or paste a CSV here", type: "textarea" },
      { name: "currency", label: "Currency", type: "select", options: ["PHP", "USD"], default: "PHP" }
    ]
  },
  {
    id: "policies",
    title: "Returns and warranty",
    why: "Returns, warranty and house rules are where a ready buyer hesitates. Answered instantly they close; answered with \"let me check\" they shop around.",
    kind: KINDS.POLICY,
    category: "Policies",
    required: false,
    fields: [
      { name: "title", label: "Which rule?", required: true },
      { name: "answer", label: "What should Closer know?", type: "textarea", required: true }
    ]
  },
  {
    id: "qualification",
    title: "What you need to know from a buyer",
    why: "These become the questions the agent asks, and what marks a lead hot. Without them it uses generic defaults built for a different kind of business.",
    kind: null,
    category: "Qualification",
    required: false,
    qualification: true,
    fields: [
      { name: "question_list", label: "What do you need to know before you can quote or book? One per line.", type: "textarea" },
      { name: "hot_signal", label: "What does a customer say when they are ready to buy?", type: "textarea" }
    ]
  },
  {
    id: "boundaries",
    title: "What the agent must never say",
    why: "Store the boundary, not the secret. Say \"never quote below PHP X\" rather than pasting your cost sheet — anything in here can be reasoned about, so it should never contain the confidential thing itself.",
    kind: KINDS.INSTRUCTION,
    category: "Boundaries",
    required: false,
    fields: [
      { name: "answer", label: "What should the agent never say, promise or discuss?", type: "textarea", required: true }
    ]
  },
  {
    id: "documents",
    title: "Additional documents and files",
    why: "Upload blank templates, standard contracts, quotation formats, service agreements, menus, guides or company documents Closer should understand. Use clear filenames so Closer and your team can find the right document later.",
    kind: KINDS.DOCUMENT,
    category: "Documents",
    required: false,
    allowUpload: true,
    uploadHint: "Use clear filenames like \"House rental quotation template\", \"Clinic treatment consent form\", or \"Standard service agreement\". Upload only blank/shareable templates and company reference docs — not signed contracts, private customer files or confidential records.",
    docUploadTitle: "Documents and templates",
    docUploadHint: "PDF, Word, Excel, CSV or image files. Name each file by purpose, not \"scan123\". Do not upload signed or private customer documents here.",
    photoUploadTitle: "Supporting images",
    photoUploadHint: "Optional photos, signed sample forms, menus or visual references.",
    fields: [
      { name: "title", label: "What is this document or template for?", required: true, placeholder: "Example: House rental quotation template" },
      { name: "answer", label: "How should Closer use it?", type: "textarea", placeholder: "Example: Use this as the quotation format for house rental inquiries. Staff must verify final price before sending a final quotation." }
    ]
  },
  {
    id: "faq",
    title: "Can Closer answer these?",
    why: "We list the questions your customers are most likely to ask, then check each one against what you have entered. Anything Closer cannot answer yet is a sale that stalls — answer it here and it never stalls again.",
    kind: KINDS.QA,
    category: "FAQ",
    required: false,
    faqCheck: true,
    fields: []
  },
  {
    id: "live_data",
    title: "Can Closer check what is actually available?",
    why: "Closer can answer prices from your knowledge base, but it should not promise rooms, items, tables, food or slots are available unless it can check the live system you already use.",
    kind: null,
    category: "Live data",
    required: false,
    liveData: true,
    // The dropdown is a SURVEY. It tells us which systems real customers run,
    // which decides the order we build connectors in. It activates nothing.
    note: "Live availability requires a connection to your existing system — a custom app, a paid app with an API we can request, a booking system, POS, inventory tool or calendar. Google Calendar can help with schedules if it is kept updated, but it is not a full dynamic inventory system. Setup is manual and usually runs ₱10,000–₱15,000 depending on the system. Nothing is charged or committed by answering below.",
    fields: [
      {
        name: "availability_items",
        label: "What should Closer check live?",
        type: "checkbox_group",
        allowOther: true,
        options: [
          "Room availability",
          "Product stock",
          "Menu item availability",
          "Table availability",
          "Appointment slots",
          "Booking/reservation slots",
          "Delivery slots",
          "Branch/location availability",
          "Event seats or tickets",
          "Staff/service schedule"
        ]
      },
      {
        name: "live_data_sources",
        label: "Where is that availability tracked today?",
        type: "checkbox_group",
        allowOther: true,
        options: [
          "Custom app or website",
          "Paid app with API",
          "Hotel/property booking system",
          "POS or inventory system",
          "Shopify/WooCommerce or ecommerce platform",
          "Food ordering/POS platform",
          "Google Calendar",
          "Google Sheets or Excel",
          "Paper/notebook/manual staff knowledge",
          "Not tracked yet"
        ]
      },
      {
        name: "connection_access",
        label: "What can you provide for connection?",
        type: "checkbox_group",
        allowOther: true,
        options: [
          "API documentation",
          "API key/token",
          "Admin login for assessment",
          "Webhook access",
          "Database/export access",
          "Google account/calendar access",
          "Staff can show us the system",
          "Not sure — need assessment"
        ]
      },
      {
        name: "availability_behavior",
        label: "Until connected, what should Closer say?",
        type: "checkbox_group",
        allowOther: true,
        options: [
          "Say staff will confirm availability",
          "Do not promise stock, room, table or slot",
          "Collect preferred date/time/item and hand off",
          "Reserve only after staff confirms",
          "Confirm automatically only after live connection is active"
        ]
      },
      {
        name: "request_call",
        label: "Would you like our IT to assess this live-data connection?",
        type: "select",
        options: [
          "Not right now",
          "Yes — please schedule a call"
        ]
      },
      { name: "contact_name", label: "Your name", type: "text", showWhen: "request_call" },
      { name: "contact_mobile", label: "Mobile number", type: "text", showWhen: "request_call" },
      { name: "contact_email", label: "Email", type: "text", showWhen: "request_call" },
      { name: "preferred_day", label: "Preferred day", type: "date", showWhen: "request_call" },
      {
        name: "preferred_time",
        label: "Preferred time",
        type: "select",
        options: ["Morning (9am–12nn)", "Afternoon (1pm–5pm)", "Evening (6pm–8pm)"],
        showWhen: "request_call"
      }
    ]
  }
];

/**
 * Validity dropdown. NULL is "no expiry" — a real state, not a far-future date
 * somebody has to notice. "Specific date" exists because a Christmas sale ends
 * on a known day, and converting that into "about 130 days" invites exactly the
 * error the field is meant to prevent.
 */
const VALIDITY_OPTIONS = [
  { value: "", label: "No end date" },
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "custom", label: "On a specific date..." }
];

/**
 * Industry packs order and relabel the shared steps. `drop` removes steps that
 * make no sense for that industry. Nothing here changes how a row is stored.
 */
const INDUSTRY_PACKS = {
  general: {
    label: "General business",
    order: ["identity", "pain_solutions", "products", "promos", "media", "payments", "shipping", "policies", "qualification", "boundaries", "documents", "faq", "live_data"]
  },
  retail: {
    label: "Retail / online selling",
    order: ["identity", "pain_solutions", "products", "promos", "media", "payments", "shipping", "policies", "qualification", "boundaries", "documents", "faq", "live_data"],
    labels: { products: "Your items and prices" }
  },
  clinic: {
    label: "Clinic / aesthetic / dental",
    order: ["identity", "pain_solutions", "products", "promos", "media", "payments", "policies", "qualification", "boundaries", "documents", "faq", "live_data"],
    drop: ["shipping"],
    labels: {
      products: "Treatments, packages and prices",
      media: "Before-and-after photos"
    },
    whys: {
      media: "Marketing-approved before-and-after photos only. Patient images carry consent obligations that stay with your clinic."
    }
  },
  church: {
    label: "Church / ministry",
    order: ["identity", "pain_solutions", "media", "payments", "policies", "qualification", "boundaries", "documents", "faq", "live_data"],
    drop: ["products", "promos", "shipping"],
    labels: {
      identity: "Who you are and what you believe",
      policies: "Service times, location and what to expect",
      qualification: "What you want to know from a visitor"
    }
  },
  hotel: {
    label: "Hotel / resort / staycation",
    order: ["identity", "pain_solutions", "products", "promos", "media", "payments", "policies", "qualification", "boundaries", "documents", "faq", "live_data"],
    drop: ["shipping"],
    labels: { products: "Rooms, rates and inclusions" }
  },
  restaurant: {
    label: "Restaurant / food",
    order: ["identity", "pain_solutions", "products", "promos", "media", "payments", "shipping", "policies", "qualification", "boundaries", "documents", "faq", "live_data"],
    labels: { products: "Menu and prices", shipping: "Delivery areas and fees" }
  }
};

/** Resolve a pack into the actual ordered step list, with its labels applied. */
function stepsForPack(packKey = "general") {
  const pack = INDUSTRY_PACKS[packKey] || INDUSTRY_PACKS.general;
  const dropped = new Set(pack.drop || []);
  const byId = new Map(STEPS.map((step) => [step.id, step]));

  return (pack.order || [])
    .filter((id) => !dropped.has(id))
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((step) => ({
      ...step,
      title: (pack.labels && pack.labels[step.id]) || step.title,
      why: (pack.whys && pack.whys[step.id]) || step.why
    }));
}

/** Facebook Page categories are messy; match loosely and let the owner change it. */
function suggestPack(company = {}, pageName = "") {
  const hay = `${company.industry || ""} ${company.name || ""} ${pageName}`.toLowerCase();
  if (/church|ministry|fellowship|parish|chapel/.test(hay)) return "church";
  if (/clinic|dental|aesthetic|derma|medical|spa/.test(hay)) return "clinic";
  if (/hotel|resort|staycation|inn|lodge/.test(hay)) return "hotel";
  if (/restaurant|cafe|coffee|food|grill|eatery|bakery/.test(hay)) return "restaurant";
  if (/shop|store|boutique|closet|apparel|clothing|retail|shirt|ads|funnel|studio/.test(hay)) return "retail";
  return "general";
}

module.exports = { STEPS, VALIDITY_OPTIONS, INDUSTRY_PACKS, PAIN_INDUSTRY_TEMPLATES, stepsForPack, suggestPack };
