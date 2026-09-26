import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const COOKIE_NAME = "session";
const SESSION_DAYS = 7;
const BCRYPT_COST = 12;

// A dummy hash compared against when the username does not exist, so
// that a missing account and a wrong password take the same amount of
// time. Without this, response latency reveals which usernames exist.
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.7Zu0kFMDF8RY4Kx5t2QmJmZ2z3D5h1G";

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error("JWT_SECRET must be set and at least 32 characters long");
  }
  return s;
}

// ---------- passwords ----------

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// ---------- tokens ----------

export function issueSessionToken(user) {
  return jwt.sign(
    { sub: String(user.id), username: user.username, role: user.role },
    secret(),
    { expiresIn: `${SESSION_DAYS}d`, issuer: "quiz-app" }
  );
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

export function verifySessionToken(token) {
  try {
    return jwt.verify(token, secret(), { issuer: "quiz-app" });
  } catch {
    return null;
  }
}

// ---------- cookies ----------

export function parseCookies(req) {
  // Vercel's Node runtime pre-parses req.cookies; the local Vite dev
  // server does not, so fall back to the raw header.
  if (req.cookies && typeof req.cookies === "object") return req.cookies;

  const header = req.headers?.cookie;
  if (!header) return {};

  const out = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[k] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

export function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}${secure}`
  );
}

export function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  );
}

// ---------- middleware ----------

// Reads the JWT cookie and attaches req.user. Never rejects on its own.
export function attachUser(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) {
    req.user = null;
    return null;
  }
  const payload = verifySessionToken(token);
  req.user = payload
    ? { id: Number(payload.sub), username: payload.username, role: payload.role }
    : null;
  return req.user;
}

// Returns the logged-in user, or sends 401 and returns null.
export function requireAuth(req, res) {
  const user = attachUser(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return user;
}

// Returns the logged-in admin, or sends 401/403 and returns null.
// Regular users get 403 (not a crash), unauthenticated callers get 401.
export function requireAdmin(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;

  if (user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }
  return user;
}

// Methods that mutate content. These are admin-only. Everything else
// (GET) only needs a signed-in user.
const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export function isWriteMethod(method) {
  return WRITE_METHODS.has(method);
}

// One-line guard for a handler: reads need any signed-in user, writes
// need an admin. Returns the user, or null after having already sent
// the 401/403 response.
//
//   const user = requireAccess(req, res);
//   if (!user) return;
export function requireAccess(req, res) {
  return isWriteMethod(req.method) ? requireAdmin(req, res) : requireAuth(req, res);
}

// Can this user read/answer/finish this attempt row?
//
// Admins may inspect any attempt. Otherwise the caller must be the
// owner. Attempts predating accounts have user_id = NULL and are
// owned by nobody, so only an admin can reach them - a regular user
// must never be able to read another person's history by guessing an
// attempt id.
export function canAccessAttempt(attempt, user) {
  if (!attempt) return false;
  if (user.role === "admin") return true;
  if (attempt.user_id === null || attempt.user_id === undefined) return false;
  return Number(attempt.user_id) === Number(user.id);
}

export { COOKIE_NAME, SESSION_DAYS, DUMMY_HASH };