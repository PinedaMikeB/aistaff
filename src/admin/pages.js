// AIStaff Super Admin — protected HTML page routes.
//
// These HTML files live in src/admin/views/ — deliberately OUTSIDE public/,
// which Express serves as static assets to anyone. Keeping them outside
// public/ guarantees the auth middleware below always runs before the shell
// is ever sent to a browser; a customer hitting /superadmin gets redirected
// to the admin login (or a 403 page if logged in but not an admin) and never
// receives the admin HTML at all — this is stricter than gating only the
// data APIs, per "Do not protect Super Admin only by hiding navigation
// links" / "Do not expose this interface to ordinary customers."

const path = require("path");
const jwt = require("jsonwebtoken");
const { prisma } = require("../db");
const { COOKIE_NAME, requireAuth } = require("../auth");
const { requireSuperAdminPage, ALL_ADMIN_ROLES } = require("../adminAuth");

const VIEWS_DIR = path.join(__dirname, "views");

function sendView(fileName) {
  return (req, res) => res.sendFile(path.join(VIEWS_DIR, fileName));
}

/**
 * Soft check (never rejects) — if the visitor already has a valid session
 * AND an admin platform_role, skip the login form and go straight to the
 * shell. Anyone else (including invalid/expired sessions) just sees the
 * login page normally.
 */
async function redirectIfAlreadyAdmin(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return next();
    const payload = jwt.verify(token, process.env.JWT_SECRET || "local-dev-secret-change-me");
    const user = await prisma.user.findFirst({ where: { id: payload.sub, status: "active" }, select: { platform_role: true } });
    if (user?.platform_role && ALL_ADMIN_ROLES.includes(user.platform_role)) {
      return res.redirect(302, "/superadmin");
    }
    return next();
  } catch {
    return next();
  }
}

function mountSuperAdminPages(app) {
  // Public: the admin login page itself. If someone with an already-valid
  // admin session hits this, send them straight to the shell instead.
  app.get("/superadmin/login", redirectIfAlreadyAdmin, sendView("login.html"));

  const protectedPaths = [
    "/superadmin",
    "/superadmin/tenants",
    "/superadmin/users",
    "/superadmin/brandee",
    "/superadmin/brandee/creative-brain",
    "/superadmin/brandee/runs",
    "/superadmin/system",
    "/superadmin/audit-logs",
    "/superadmin/security"
  ];

  protectedPaths.forEach((route) => {
    app.get(route, requireAuth, requireSuperAdminPage(ALL_ADMIN_ROLES), sendView("shell.html"));
  });
}

module.exports = { mountSuperAdminPages };
