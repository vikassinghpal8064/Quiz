import sql from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import { flashUserId } from "../../_lib/flashCards.js";
import {
  createSignedUpload,
  findStoredObjectByHash,
  mediaConfigured,
  normaliseHash,
  validateUploadRequest,
} from "../../_lib/flashMedia.js";

// POST /api/flash/media/sign
//
// Hands the browser a short-lived signed upload URL for Supabase Storage. The
// service-role key never leaves this function: the browser just PUTs the bytes
// to the returned signedUrl and then stores the publicUrl (plus the object path)
// on the media block. The card save mirrors that path into fc_media.storage_path
// (see api/_lib/flashCards.js mediaRowsFromSides).
//
// Body: { kind: "image" | "audio", mime, bytes, filename?, hash? }
// 200 : { signedUrl, token, path, publicUrl, hash }
//       | { deduplicated: true, url, path, publicUrl, mime, bytes, hash }
// 400 : unsupported mime / oversized / bad bytes
// 503 : Supabase Storage not configured
//
// De-duplication: when the client sends a SHA-256 `hash` of the encoded bytes
// and this user already has an fc_media row with that hash, no upload URL is
// minted at all - the existing object's URL is returned instead (deduplicated:
// true) and the client skips the PUT entirely. The hash is only a hint: an
// unknown / malformed hash simply falls through to a normal signed upload.
//
// The endpoint is authenticated, so only a signed-in user can mint an upload
// URL. The type (image vs audio) and the 5 MB ceiling are enforced here from the
// declared mime/size, and every object lands under flash/<year>/<uuid>.<ext>.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = requireAuth(req, res);
  if (!user) return;
  const uid = flashUserId(user);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!mediaConfigured()) {
    return res.status(503).json({
      error:
        "Media storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable image and audio uploads.",
    });
  }

  try {
    const body = req.body ?? {};
    // Validate before the de-dupe lookup so a bad request is still a 400 even
    // when it carries a hash.
    validateUploadRequest({ kind: body.kind, mime: body.mime, bytes: body.bytes });

    const hash = normaliseHash(body.hash);
    if (hash) {
      const existing = await findStoredObjectByHash(sql, uid, hash);
      if (existing) {
        return res.status(200).json({
          deduplicated: true,
          url: existing.url,
          path: existing.path,
          publicUrl: existing.url,
          mime: existing.mime ?? body.mime ?? null,
          bytes: existing.bytes ?? body.bytes ?? null,
          hash,
        });
      }
    }

    const signed = await createSignedUpload({
      kind: body.kind,
      mime: body.mime,
      bytes: body.bytes,
      filename: body.filename,
    });
    return res.status(200).json(hash ? { ...signed, hash } : signed);
  } catch (err) {
    console.error("POST /api/flash/media/sign", err);
    return res.status(400).json({ error: err?.message ?? "Upload not allowed" });
  }
}
