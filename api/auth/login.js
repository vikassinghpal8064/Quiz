import sql from "../_lib/db.js";
import { verifyPassword, issueSessionToken, setSessionCookie, DUMMY_HASH } from "../_lib/auth.js";

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
    const { username, password } = req.body ?? {};

    const name = String(username ?? "").trim();
    const pw = String(password ?? "");

    if (!name || !pw) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    const rows = await sql`
      SELECT id, username, password_hash, role
      FROM users
      WHERE lower(username) = lower(${name})
      LIMIT 1
    `;

    // Always run a bcrypt comparison, even for a missing account, so
    // timing does not reveal which usernames are registered. The
    // message below is identical in both cases.
    const ok = rows.length
      ? await verifyPassword(pw, rows[0].password_hash)
      : (await verifyPassword(pw, DUMMY_HASH), false);

    if (!rows.length || !ok) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const user = rows[0];
    setSessionCookie(res, issueSessionToken(user));

    return res.status(200).json({
      id: user.id,
      username: user.username,
      role: user.role,
    });
  } catch (err) {
    console.error("POST /api/auth/login", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
