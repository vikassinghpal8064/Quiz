import { requireAuth } from "../../_lib/auth.js";
import {
  AUDIO_CONTENT_TYPES,
  IMAGE_CONTENT_TYPES,
  MAX_AUDIO_BYTES,
  MAX_IMAGE_BYTES,
  blobConfigured,
} from "../../_lib/flashMedia.js";

// POST /api/flash/media/token
//
// Client-upload handshake for Vercel Blob. The browser calls @vercel/blob/client
// `upload()`, which POSTs here with { type: "blob.generate-client-token", ... };
// handleUpload validates that event, calls onBeforeGenerateToken, and answers
// with a short-lived, scoped client token. The browser then PUTs the bytes
// straight to Blob - they never touch this function - and the card save records
// the resulting URL (see api/_lib/flashCards.js mediaRowsFromSides).
//
// The endpoint is authenticated, so only a signed-in user can mint an upload
// token. The pathname the client asks for must sit under fc/<kind>/..., which
// fixes the kind (image vs audio), and therefore the size limit and content-type
// allow-list, before a token is issued. addRandomSuffix keeps two uploads from
// ever colliding (and stops one user overwriting another user's blob).
//
// No onUploadCompleted callback is registered on purpose: fc_media rows are
// written when the card is saved (fc_media.card_id is NOT NULL), and the
// callback is a Vercel -> deployment webhook that cannot run in local dev. The
// client already holds the blob URL from the direct upload, so a callback would
// only duplicate work.
const PATH_RE = /^fc\/(image|audio|ink)\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!blobConfigured()) {
    return res.status(503).json({
      error:
        "Media storage is not configured. Set BLOB_READ_WRITE_TOKEN to enable image and audio uploads.",
    });
  }

  try {
    // Imported lazily so the SDK is only pulled in when an upload actually
    // starts, keeping the router and the dev server light.
    const { handleUpload } = await import("@vercel/blob/client");

    const jsonResponse = await handleUpload({
      request: req,
      body: req.body,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname) => {
        const match = PATH_RE.exec(String(pathname ?? ""));
        if (!match) {
          throw new Error("Invalid upload path");
        }
        const kind = match[1];
        // Ink previews are PNG images, so "ink" shares the image limits; only
        // the storage prefix differs (fc/ink/...).
        return kind === "audio"
          ? {
              allowedContentTypes: AUDIO_CONTENT_TYPES,
              maximumSizeInBytes: MAX_AUDIO_BYTES,
              addRandomSuffix: true,
            }
          : {
              allowedContentTypes: IMAGE_CONTENT_TYPES,
              maximumSizeInBytes: MAX_IMAGE_BYTES,
              addRandomSuffix: true,
            };
      },
    });

    return res.status(200).json(jsonResponse);
  } catch (err) {
    console.error("POST /api/flash/media/token", err);
    return res.status(400).json({ error: err?.message ?? "Upload not allowed" });
  }
}
