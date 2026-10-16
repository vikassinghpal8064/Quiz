import sql from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import {
  MAX_TAG_LENGTH,
  flashUserId,
  optionalInt,
  optionalString,
  parsePositiveInt,
  requiredString,
  sendMissingFlashTable,
} from "../../_lib/flashCards.js";
import {
  CREATE_SESSION_SQL,
  DEFAULT_SESSION_CARDS,
  MAX_SESSION_CARDS,
  NEW_INTRODUCED_SQL,
  SESSION_MODES,
  SESSION_SCOPES,
  candidateQuery,
  createSessionArgs,
  focusLimit,
  loadSettings,
  newCapRemaining,
  orderQueue,
} from "../../_lib/flashStudy.js";

// GET  /api/flash/sessions - the caller's most recent study sittings
// POST /api/flash/sessions - start a session and build its due queue
//
// POST body:
//   {
//     scope_type: "folder" | "category" | "tag" | "all",
//     scope_id:   number   (folder / category only),
//     tag:        string   (tag only; scope_id also accepts the tag string),
//     mode:       "due" | "focus" | "struggling" | "all"   (default "due"),
//     fraction:   number   (optional, focus only; 0 < f <= 1),
//     limit:      number   (optional cap on queued cards)
//   }
//
// The candidates are read once (candidateQuery), ordered in JS for the standard
// due mode - due cards by lowest retrievability first, then new cards up to the
// remaining daily cap - and then the session and its ordered queue are written
// in one statement (CREATE_SESSION_SQL), so starting a session is a handful of
// round trips no matter how many cards it holds.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = requireAuth(req, res);
  if (!user) return;
  const uid = flashUserId(user);

  try {
    if (req.method === "GET") {
      const rows = await sql`
        SELECT s.*, count(r.id)::int AS review_count
        FROM fc_sessions s
        LEFT JOIN fc_review_logs r ON r.session_id = s.id
        WHERE s.user_id = ${uid}
        GROUP BY s.id
        ORDER BY s.started_at DESC
        LIMIT 20
      `;
      return res.status(200).json({ sessions: rows });
    }

    if (req.method === "POST") {
      const body = req.body ?? {};

      const scopeType = optionalString(body.scope_type, "scope_type", 32).value ?? "all";
      if (!SESSION_SCOPES.has(scopeType)) {
        return res
          .status(400)
          .json({ error: `scope_type must be one of ${[...SESSION_SCOPES].join(", ")}` });
      }

      // A tag scope carries its own string (fc_sessions.scope_id is INT, so it
      // cannot hold a tag). Accept it either as `tag` or as a string scope_id.
      let scopeId = null;
      let scopeTag = null;
      if (scopeType === "tag") {
        const rawTag = body.tag ?? (typeof body.scope_id === "string" ? body.scope_id : null);
        const parsedTag = requiredString(rawTag, "tag", MAX_TAG_LENGTH);
        if (parsedTag.error) return res.status(400).json({ error: parsedTag.error });
        scopeTag = parsedTag.value;
      } else if (scopeType !== "all") {
        const parsed = parsePositiveInt(body.scope_id, "scope_id");
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        scopeId = parsed.value;
      }

      const mode = optionalString(body.mode, "mode", 32).value ?? "due";
      if (!SESSION_MODES.has(mode)) {
        return res.status(400).json({ error: `mode must be one of ${[...SESSION_MODES].join(", ")}` });
      }

      let fraction = null;
      if (body.fraction !== undefined && body.fraction !== null && body.fraction !== "") {
        const n = Number(body.fraction);
        if (!Number.isFinite(n) || n <= 0 || n > 1) {
          return res.status(400).json({ error: "fraction must be a number greater than 0 and at most 1" });
        }
        fraction = n;
      }

      let requestedLimit = DEFAULT_SESSION_CARDS;
      if (body.limit !== undefined && body.limit !== null && body.limit !== "") {
        const parsed = optionalInt(body.limit, "limit", { min: 1, max: MAX_SESSION_CARDS });
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        requestedLimit = parsed.value ?? DEFAULT_SESSION_CARDS;
      }

      // A scoped session must point at something the caller owns. A folder or
      // category that is missing simply produces an empty queue (the candidate
      // query scopes on user_id), but a clearer 404 is friendlier.
      if (scopeType === "folder") {
        const found = await sql`
          SELECT id FROM fc_folders WHERE id = ${scopeId} AND user_id = ${uid}
        `;
        if (!found.length) return res.status(404).json({ error: "folder not found" });
      } else if (scopeType === "category") {
        const found = await sql`
          SELECT id FROM fc_categories WHERE id = ${scopeId} AND user_id = ${uid}
        `;
        if (!found.length) return res.status(404).json({ error: "category not found" });
      }

      const settings = await loadSettings(sql, uid);
      const query = candidateQuery({ uid, scopeType, scopeId, tag: scopeTag, mode });
      const candidates = await sql.query(query.text, query.params);

      // The standard order (due by lowest retrievability, then new up to the
      // daily cap) is computed for due / focus only; the other modes keep their
      // SQL order.
      let ids;
      if (mode === "due" || mode === "focus") {
        const introduced = await sql.query(NEW_INTRODUCED_SQL, [uid]);
        const newCap = newCapRemaining(settings, introduced[0]?.n ?? 0);
        ids = orderQueue(candidates, { mode, now: new Date(), settings, newCap });
      } else {
        ids = candidates.map((row) => row.id);
      }

      // Focus shortens the queue; every other mode honours the caller's limit.
      const limit =
        mode === "focus"
          ? focusLimit(ids.length, { ...settings, ...(fraction != null ? { focus_fraction: fraction } : {}) })
          : requestedLimit;
      const queuedIds = ids.slice(0, limit);

      const rows = await sql.query(
        CREATE_SESSION_SQL,
        createSessionArgs({
          uid,
          scopeType,
          scopeId,
          mode,
          fraction,
          plannedCount: queuedIds.length,
          // scope_id cannot hold a tag, so the tag travels in the queue's reason
          // label ("tag:grammar") where GET /sessions/:id can surface it again.
          reason: scopeTag ? `tag:${scopeTag}` : mode,
          cardIds: queuedIds,
        })
      );

      return res.status(201).json({ ...rows[0], queued: rows[0].queued ?? queuedIds.length });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (sendMissingFlashTable(res, err)) return;
    console.error("GET/POST /api/flash/sessions", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
