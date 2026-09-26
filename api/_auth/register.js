import sql from "../_lib/db.js";
import { hashPassword } from "../_lib/auth.js";
import { validateRegistration } from "../_lib/validate.js";

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
    const { username, password, phone_number, email } = req.body ?? {};

    const { errors, value } = validateRegistration({ username, password, phone_number, email });
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ error: "Validation failed", fields: errors });
    }

    // Pre-check so the caller gets a clear, field-level message rather
    // than a raw unique-violation. The unique indexes remain the real
    // guarantee; we still translate a race into the same clean error.
    const clash = await sql`
      SELECT
        EXISTS (SELECT 1 FROM users WHERE lower(username) = lower(${value.username}))  AS username_taken,
        EXISTS (SELECT 1 FROM users WHERE phone_number = ${value.phone})                   AS phone_taken
    `;

    const fields = {};
    if (clash[0].username_taken) fields.username = "That username is already taken";
    if (clash[0].phone_taken) fields.phone_number = "That phone number is already registered";
    if (Object.keys(fields).length > 0) {
      return res.status(409).json({ error: "Validation failed", fields });
    }

    const password_hash = await hashPassword(String(password));

    let rows;
    try {
      rows = await sql`
        INSERT INTO users (username, password_hash, phone_number, email, role)
        VALUES (${value.username}, ${password_hash}, ${value.phone}, ${value.email}, 'user')
        RETURNING id, username, phone_number, email, role, created_at
      `;
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({
          error: "Validation failed",
          fields: { username: "That username or phone number is already taken" },
        });
      }
      throw err;
    }

    // role is hard-coded to 'user' above: admin accounts are never
    // created through public registration.
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /api/auth/register", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
