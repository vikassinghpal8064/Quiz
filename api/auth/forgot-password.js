import sql from "../_lib/db.js";
import { randomToken } from "../_lib/auth.js";
import { EMAIL_RE } from "../_lib/validate.js";
import { sendPasswordResetEmail, isEmailConfigured } from "../_lib/email.js";

const TOKEN_TTL_MINUTES = 45;

// One single response for every outcome, so this endpoint cannot be
// used to discover which email addresses are registered.
const GENERIC_RESPONSE = {
  message:
    "If an account exists for that email address, a password reset link has been sent.",
};

function baseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");

  const host = req.headers?.host;
  const proto = req.headers?.["x-forwarded-proto"] || "http";
  return host ? `${proto}://${host}` : "http://localhost:5173";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email } = req.body ?? {};
    const mail = String(email ?? "").trim().toLowerCase();

    // A malformed address is a client mistake worth reporting, but it
    // still cannot be used to probe for real accounts.
    if (!mail) {
      return res.status(400).json({ error: "Email is required" });
    }
    if (!EMAIL_RE.test(mail)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }

    const users = await sql`
      SELECT id, username, email
      FROM users
      WHERE lower(email) = ${mail}
    `;

    if (users.length > 0) {
      if (!isEmailConfigured()) {
        console.warn(
          "[auth] forgot-password: RESEND_API_KEY is not set, so no email was sent."
        );
      }

      for (const user of users) {
        // Retire any outstanding tokens first, so only the newest link
        // ever works.
        await sql`
          UPDATE password_reset_tokens
          SET used = true
          WHERE user_id = ${user.id} AND used = false
        `;

        const token = randomToken(32);
        const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

        await sql`
          INSERT INTO password_reset_tokens (user_id, token, expires_at)
          VALUES (${user.id}, ${token}, ${expiresAt.toISOString()})
        `;

        const resetUrl = `${baseUrl(req)}/reset-password/${token}`;

        // Development affordance so the link is reachable without an
        // inbox. Never emitted in production.
        if (process.env.NODE_ENV !== "production") {
          console.log(`[auth] password reset link for ${user.username}: ${resetUrl}`);
        }

        try {
          await sendPasswordResetEmail({
            to: user.email,
            username: user.username,
            resetUrl,
            expiresAt: expiresAt.toISOString(),
          });
        } catch (err) {
          // Log server-side only. The HTTP response stays generic so a
          // mail outage cannot become an enumeration oracle.
          console.error("[auth] failed to send password reset email", err);
        }
      }
    }

    return res.status(200).json(GENERIC_RESPONSE);
  } catch (err) {
    console.error("POST /api/auth/forgot-password", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
