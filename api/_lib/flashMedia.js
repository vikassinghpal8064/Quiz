// Server-side helpers for flash-card media (images / audio).
//
// The bytes never pass through a serverless function: the browser asks
// api/_flash/media/token.js for a short-lived client token and uploads straight
// to Vercel Blob. What is left for the server is:
//
//   - deciding whether Blob storage is configured at all, and
//   - deleting the blobs a card owned once the card (or a media block) is gone.
//
// fc_media rows are derived from the card's block JSON at save time (see
// mediaRowsFromSides in flashCards.js), so deleting a blob only needs its URL.
// This module lives in api/_lib/ because it is a shared library, not a route.
//
// Storage is opt-in: without BLOB_READ_WRITE_TOKEN every helper degrades to a
// no-op (and the token endpoint answers 503) instead of throwing, so the rest
// of the app keeps working on a deployment that has not configured Blob yet.

// Uploads are scoped to fc/<kind>/... so the token endpoint can infer the kind
// (and therefore the size and content-type limits) from the path the client
// asks for, and so a crafted path cannot escape the media prefix. The same
// prefix is enforced by api/_flash/media/token.js and built by
// src/modules/flashcards/lib/media.js.
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 30 * 1024 * 1024;

// Vercel Blob accepts wildcards in allowedContentTypes ("image/*"), so a new
// camera or recorder format does not need a code change to work.
export const IMAGE_CONTENT_TYPES = ["image/*"];
export const AUDIO_CONTENT_TYPES = ["audio/*"];

// fc_media.url is TEXT with no length limit, but blocks are JSONB the client
// controls; cap the stored URL so a pathological value cannot bloat a row.
export const MAX_MEDIA_URL_LENGTH = 2048;

export function blobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

// Best-effort: a failure to delete a blob must never fail the request that
// triggered it (the card/row is already gone either way).
export async function deleteBlobs(urls) {
  const list = (urls ?? []).filter((url) => typeof url === "string" && url.trim());
  if (!list.length) return { deleted: 0, skipped: 0 };
  if (!blobConfigured()) return { deleted: 0, skipped: list.length };
  try {
    const { del } = await import("@vercel/blob");
    await del(list);
    return { deleted: list.length, skipped: 0 };
  } catch (err) {
    console.error("[flash media] blob delete failed", err);
    return { deleted: 0, skipped: list.length };
  }
}

// Delete every URL that no fc_media row references any more.
//
// After a card (or one of its media blocks) is removed its fc_media rows are
// already gone, so a URL with no remaining row cannot be in use and is safe to
// delete from the store. The re-check also protects a blob deliberately shared
// by two cards. `sql` is the Neon tagged-template function from api/_lib/db.js;
// taking it as an argument keeps this module free of a database import.
export async function deleteUnreferencedBlobs(sql, urls, uid) {
  const list = [...new Set((urls ?? []).filter((url) => typeof url === "string" && url.trim()))];
  if (!list.length) return { deleted: 0, kept: 0 };

  const still = await sql`
    SELECT DISTINCT url FROM fc_media
    WHERE user_id = ${uid} AND url = ANY(${list})
  `;
  const kept = new Set(still.map((row) => row.url));
  const gone = list.filter((url) => !kept.has(url));
  await deleteBlobs(gone);
  return { deleted: gone.length, kept: kept.size };
}
