/**
 * Provider adapters + the single dispatcher.
 *
 * The ONLY place that knows how OpenAI and Gemini differ. Everything else in
 * the codebase declares a tool once and stays provider-agnostic. Swapping a
 * model becomes a config change instead of a port.
 *
 * The differences are small but total — get one wrong and the model silently
 * stops calling tools rather than erroring:
 *
 *   OpenAI   {type:"function", function:{name, description, parameters}}
 *            JSON-Schema types lowercase ("object", "string")
 *            response: choices[0].message.tool_calls[].function.arguments (a
 *            JSON *string*)
 *
 *   Gemini   {functionDeclarations:[{name, description, parameters}]}
 *            types UPPERCASE ("OBJECT", "STRING")
 *            response: candidates[0].content.parts[].functionCall.args (an
 *            object, already parsed)
 */

const { toolsForScope, getTool } = require("./registry");

/** Gemini wants SCREAMING type names; JSON Schema says lowercase. */
function upperTypes(schema) {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(upperTypes);
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "type" && typeof value === "string") out[key] = value.toUpperCase();
    else if (value && typeof value === "object") out[key] = upperTypes(value);
    else out[key] = value;
  }
  return out;
}

/** Gemini rejects unknown schema keys — additionalProperties is a common one. */
function stripUnsupported(schema) {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(stripUnsupported);
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "additionalProperties" || key === "$schema") continue;
    out[key] = value && typeof value === "object" ? stripUnsupported(value) : value;
  }
  return out;
}

/**
 * Remove parameters a scope must not see. The handler already ignores them,
 * but a schema that advertises `to_number` invites the model to try — and a
 * refusal mid-conversation is a worse experience than never offering it.
 */
function schemaForScope(tool, scope) {
  const hidden = (tool.hideParams && tool.hideParams[scope]) || [];
  if (!hidden.length) return tool.parameters;
  const props = Object.assign({}, tool.parameters.properties);
  for (const key of hidden) delete props[key];
  const required = (tool.parameters.required || []).filter((r) => hidden.indexOf(r) === -1);
  return Object.assign({}, tool.parameters, { properties: props, required });
}

function toOpenAI(scope) {
  return toolsForScope(scope).map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: schemaForScope(t, scope)
    }
  }));
}

function toGemini(scope) {
  const declarations = toolsForScope(scope).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: upperTypes(stripUnsupported(schemaForScope(t, scope)))
  }));
  return declarations.length ? [{ functionDeclarations: declarations }] : [];
}

/** Normalise either provider's response into [{name, args}]. */
function parseToolCalls(providerResponse, provider) {
  try {
    if (provider === "gemini") {
      const parts = providerResponse?.candidates?.[0]?.content?.parts || [];
      return parts
        .filter((p) => p.functionCall)
        .map((p) => ({
          name: p.functionCall.name,
          args: p.functionCall.args || {},
          // Gemini 3 attaches a thoughtSignature to the part. It must be sent
          // back verbatim on the following turn or the API returns 400, so
          // keep the whole original part rather than just name+args.
          rawPart: p
        }));
    }
    const calls = providerResponse?.choices?.[0]?.message?.tool_calls || [];
    return calls.map((c) => {
      let args = {};
      try {
        args = JSON.parse(c.function.arguments || "{}");
      } catch {
        args = {};
      }
      return { name: c.function.name, args, id: c.id };
    });
  } catch {
    return [];
  }
}

/**
 * Run one tool. ALWAYS resolves — a thrown handler would otherwise abandon a
 * live phone call mid-sentence. Errors come back as facts the model can talk
 * about ("that didn't go through") rather than as a crash.
 */
async function execute({ name, args, ctx }) {
  const tool = getTool(name);
  if (!tool) return { error: "unknown_tool", detail: `no tool named ${name}` };

  const scope = ctx && ctx.scope;
  if (!scope || tool.scopes.indexOf(scope) === -1) {
    // Defence in depth: a model can hallucinate a tool name it was never
    // offered, and scope is what keeps a public demo out of tenant tooling.
    return { error: "tool_not_available_here", tool: name };
  }

  if (typeof tool.guard === "function") {
    try {
      const blocked = await tool.guard(args || {}, ctx);
      if (blocked) return Object.assign({ ok: false }, blocked);
    } catch (error) {
      return { ok: false, reason: "guard_failed", detail: error.message };
    }
  }

  try {
    return await tool.handler(args || {}, ctx);
  } catch (error) {
    return { ok: false, reason: "handler_failed", detail: error.message };
  }
}

module.exports = { toOpenAI, toGemini, schemaForScope, parseToolCalls, execute, upperTypes, stripUnsupported };
