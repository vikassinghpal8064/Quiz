import sql from "../../_lib/db.js";
import { hashPassword } from "../../_lib/auth.js";
import { validatePassword } from "../../_lib/validate.js";

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
    const { token } = req.query;
    const { new_password } = req.body ?? {};

    if (!token) {
      return res.status(400).json({ error: "Reset token is required" });
    }

    const { error } = validatePassword(new_password);
    if (error) {
      return res.status(400).json({ error });
    }

    const rows = await sql`
      SELECT id, user_id, expires_at, used
      FROM password_reset_tokens
      WHERE token = ${token}
      LIMIT 1
    `;

    if (!rows.length) {
      return res.status(400).json({ error: "This reset link is invalid or has already been used" });
    }

    const row = rows[0];
    if (row.used) {
      return res.status(400).json({ error: "This reset link is invalid or has already been used" });
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      return res.status(400).json({ error: "This reset link has expired. Please request a new one." });
    }

    const password_hash = await hashPassword(String(new_password));

    // Claim the token in the same statement that rotates the hash, so
    // two concurrent redemptions of the same link cannot both win.
    const claimed = await sql`
      UPDATE password_reset_tokens
      SET used = true
      WHERE id = ${row.id} AND used = false
      RETURNING user_id
    `;

    if (!claimed.length) {
      return res.status(400).json({ error: "This reset link is invalid or has already been used" });
    }

    await sql`
      UPDATE users
      SET password_hash = ${password_hash}
      WHERE id = ${row.user_id}
    `;

    // Burn any other outstanding tokens for this account.
    await sql`
      UPDATE password_reset_tokens
      SET used = true
      WHERE user_id = ${row.user_id} AND used = false
    `;

    return res.status(200).json({ message: "Password updated. You can now sign in." });
  } catch (err) {
    console.error("POST /api/auth/reset-password/:token", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
