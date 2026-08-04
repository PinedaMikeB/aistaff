require("./_prismaSandboxGuard");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

test("safeServiceConfigSnapshot never returns a raw secret value — only Configured/Not configured or safe defaults", () => {
  process.env.OPENAI_API_KEY = "sk-totally-secret-value-should-never-leak";
  process.env.JWT_SECRET = "super-secret-jwt-value";
  delete require.cache[require.resolve("../../src/admin/systemStatus")];
  const systemStatus = require("../../src/admin/systemStatus");

  const snapshot = systemStatus.safeServiceConfigSnapshot();
  const serialized = JSON.stringify(snapshot);
  assert.ok(!serialized.includes("sk-totally-secret-value-should-never-leak"));
  assert.ok(!serialized.includes("super-secret-jwt-value"));
  assert.equal(snapshot.OPENAI_API_KEY, "Configured");
  assert.equal(snapshot.JWT_SECRET, "Configured");
});

test("NEVER_EXPOSE_FIELDS covers password_hash and encrypted-secret columns", () => {
  const { NEVER_EXPOSE_FIELDS } = require("../../src/adminAuth");
  assert.ok(NEVER_EXPOSE_FIELDS.includes("password_hash"));
  assert.ok(NEVER_EXPOSE_FIELDS.includes("mfa_secret_encrypted"));
});

test("directory.js's SAFE_USER_SELECT never selects password_hash or mfa_secret_encrypted", () => {
  const { SAFE_USER_SELECT } = require("../../src/admin/directory");
  assert.equal(SAFE_USER_SELECT.password_hash, undefined);
  assert.equal(SAFE_USER_SELECT.mfa_secret_encrypted, undefined);
  assert.equal(SAFE_USER_SELECT.mfa_backup_codes_hash, undefined);
});

test("no public-facing request schema in this repo accepts a role/platform_role field from the client", () => {
  const schemasSource = fs.readFileSync(path.join(ROOT, "src/brandee/schemas.js"), "utf8");
  assert.ok(!/platform_role|SUPERADMIN|SUPPORT_ADMIN/i.test(schemasSource), "Brandee's public request schema must never mention admin roles");

  // The only schema that accepts a platform role is PlatformRoleBody in
  // admin/routes.js, which sits behind requireSuperAdminApi([SUPERADMIN]) —
  // confirm that route wiring directly in the source rather than asserting
  // it in the abstract.
  const routesSource = fs.readFileSync(path.join(ROOT, "src/admin/routes.js"), "utf8");
  const roleRouteMatch = routesSource.match(/router\.post\("\/users\/:id\/platform-role",([^)]*)\)/s);
  assert.ok(roleRouteMatch, "platform-role route not found");
  assert.match(roleRouteMatch[1], /PLATFORM_ROLES\.SUPERADMIN/, "platform-role assignment must be gated to SUPERADMIN only");
});

test("the platform-role route explicitly blocks an actor changing their own role (self-assignment guard present in source)", () => {
  const routesSource = fs.readFileSync(path.join(ROOT, "src/admin/routes.js"), "utf8");
  assert.match(routesSource, /req\.params\.id === req\.user\.id/, "self-assignment guard must compare target id against the actor's own id");
});

test("no scripts/create-client.js (tenant provisioning) path ever sets platform_role", () => {
  const source = fs.readFileSync(path.join(ROOT, "scripts/create-client.js"), "utf8");
  assert.ok(!/platform_role/.test(source), "tenant provisioning script must never set platform_role");
});

test("Super Admin shell/login pages are not reachable through express.static (they live outside public/)", () => {
  assert.ok(!fs.existsSync(path.join(ROOT, "public/superadmin")), "admin views must not exist under public/");
  assert.ok(fs.existsSync(path.join(ROOT, "src/admin/views/shell.html")));
  assert.ok(fs.existsSync(path.join(ROOT, "src/admin/views/login.html")));
});

test("no customer-facing public page links to /superadmin (admin nav must never appear in customer/public UI)", () => {
  const publicDir = path.join(ROOT, "public");
  const offenders = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".html")) {
        const contents = fs.readFileSync(full, "utf8");
        if (contents.includes("/superadmin")) offenders.push(full);
      }
    }
  }
  walk(publicDir);
  assert.deepEqual(offenders, []);
});

test("the admin shell includes responsive, accessibility, and reduced-motion affordances", () => {
  const shell = fs.readFileSync(path.join(ROOT, "src/admin/views/shell.html"), "utf8");
  assert.match(shell, /@media \(max-width:/, "must include a responsive breakpoint");
  assert.match(shell, /prefers-reduced-motion/, "must respect reduced-motion preference");
  assert.match(shell, /:focus-visible/, "must define a visible focus state");
  assert.match(shell, /aria-label="Super Admin navigation"/, "nav must be labeled for assistive tech");
  assert.match(shell, /aria-modal="true"/, "the details drawer must be marked as a modal dialog for assistive tech");
  assert.match(shell, /<table>/, "status/data tables must use semantic table markup");
});

test("badge status text is always rendered alongside the color (no color-only status indicators)", () => {
  const shell = fs.readFileSync(path.join(ROOT, "src/admin/views/shell.html"), "utf8");
  const badgeFnMatch = shell.match(/function badge\(status\) \{([\s\S]*?)\n\s*\}/);
  assert.ok(badgeFnMatch);
  assert.match(badgeFnMatch[1], /escapeHtml\(status\)/, "badge() must render the status word itself, not just a colored dot");
});

test("every JS <script> block in the admin views is syntactically valid", () => {
  for (const file of ["src/admin/views/shell.html", "src/admin/views/login.html"]) {
    const html = fs.readFileSync(path.join(ROOT, file), "utf8");
    const scripts = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    for (const script of scripts) {
      assert.doesNotThrow(() => new Function(script), `${file} has invalid JS`);
    }
  }
});
