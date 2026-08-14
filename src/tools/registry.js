/**
 * Provider-neutral tool registry.
 *
 * WHY: Closer declares tools in OpenAI's shape ({type:"function", function:{...}},
 * lowercase JSON-Schema types) and dispatches on `tool_calls`. Pitch declares
 * them in Gemini's shape (bare {name, description, parameters}, UPPERCASE
 * types) and dispatches through execute(). Same idea, incompatible plumbing —
 * so a capability built for one agent cannot be used by the other, and the
 * model choice is welded to the tool layer.
 *
 * A tool is defined ONCE here. Adapters translate to each provider. One
 * dispatcher runs them. Whether a phone call or a Messenger thread asked for a
 * quotation, the same handler runs and writes the same row.
 *
 * TWO RULES, from docs/handoff-masterplan.md, enforced structurally:
 *
 *   1. Tools return FACTS, never words to speak. A handler returns
 *      {sent: true, quotation_number: "Q-2026-0007"}, never a sentence. The
 *      model writes every customer-facing word, in whatever language and
 *      register the customer used. This is why there is no language parameter
 *      anywhere in this file.
 *
 *   2. Guardrails live in code, not in the prompt. A limit written in a prompt
 *      is a suggestion; a limit in `guard` is a rule. Prompts get edited,
 *      truncated, and argued with by clever users.
 */

/** Scopes an agent can present. A tool is offered only where it can work. */
const SCOPES = {
  CLOSER: "closer",   // Facebook Messenger, authenticated tenant
  PITCH: "pitch",     // live voice call, caller ID from the SIP INVITE
  DEMO: "demo"        // public web demo, anonymous prospect — least trusted
};

const registry = new Map();

/**
 * @param {object} def
 * @param {string}   def.name
 * @param {string}   def.description  Written for the MODEL, not the customer.
 * @param {object}   def.parameters   JSON Schema, lowercase types.
 * @param {string[]} def.scopes       Which agents may see this tool.
 * @param {function} [def.guard]      async (args, ctx) => null | {reason}
 * @param {function} def.handler      async (args, ctx) => facts object
 */
function defineTool(def) {
  if (!def || !def.name) throw new Error("tool needs a name");
  if (!def.handler) throw new Error(`tool ${def.name} needs a handler`);
  if (!Array.isArray(def.scopes) || def.scopes.length === 0) {
    throw new Error(`tool ${def.name} needs at least one scope`);
  }
  if (registry.has(def.name)) throw new Error(`tool ${def.name} already defined`);
  registry.set(def.name, Object.assign({
    parameters: { type: "object", properties: {}, required: [] },
    guard: null
  }, def));
  return def.name;
}

/** Tools an agent in this scope may see. Scope decides availability. */
function toolsForScope(scope) {
  return Array.from(registry.values()).filter((t) => t.scopes.indexOf(scope) !== -1);
}

function getTool(name) {
  return registry.get(name) || null;
}

function reset() {
  registry.clear();
}

module.exports = { SCOPES, defineTool, toolsForScope, getTool, registry, reset };
