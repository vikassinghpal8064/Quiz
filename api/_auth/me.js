import sql from "../_lib/db.js";
import { requireAuth } from "../_lib/auth.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    // Re-read rather than trusting the JWT payload alone, so a role
    // change or account deletion takes effect immediately instead of
    // lingering until the token expires.
    const rows = await sql`
      SELECT id, username, email, role, created_at
      FROM users
      WHERE id = ${user.id}
    `;

    if (!rows.length) {
      return res.status(401).json({ error: "Account no longer exists" });
    }

    return res.status(200).json(rows[0]);
  } catch (err) {
    console.error("GET /api/auth/me", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
