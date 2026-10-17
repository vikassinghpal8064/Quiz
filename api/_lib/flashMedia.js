// Server-side helpers for flash-card media (images / audio).
//
// The bytes never pass through a serverless function: the browser asks
// api/_flash/media/sign.js for a short-lived signed upload URL and PUTs the
// file straight to Supabase Storage. What is left for the server is:
//
//   - minting that signed upload URL (service-role key stays here), and
//   - deleting the objects a card / category / folder owned once it is gone.
//
// fc_media rows are derived from the card's block JSON at save time (see
// mediaRowsFromSides in flashCards.js); each row records the object path in
// fc_media.storage_path so deletion never has to parse a URL.
//
// This module lives in api/_lib/ because it is a shared library, not a route.
//
// Storage is opt-in: without SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY every
// helper degrades to a no-op (and the sign endpoint answers 503) instead of
// throwing, so the rest of the app keeps working on a deployment that has not
// configured Storage yet. Old cards keep working too: their blocks still hold
// the original (Vercel Blob) URL, and rows without a storage_path are simply
// never deleted from a bucket.

import {
  MAX_MEDIA_BYTES,
  isSafeStoragePath,
  kindForMime,
  mediaObjectPath,
} from "../../src/modules/flashcards/lib/storage/paths.js";

// fc_media.url is TEXT with no length limit, but blocks are JSONB the client
// controls; cap the stored URL so a pathological value cannot bloat a row.
export const MAX_MEDIA_URL_LENGTH = 2048;

// The default bucket. Overridable with SUPABASE_BUCKET; it must be a public
// bucket so the publicUrl a block stores is directly renderable.
export const DEFAULT_SUPABASE_BUCKET = "flash-media";

export function mediaConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function supabaseBucket() {
  return process.env.SUPABASE_BUCKET || DEFAULT_SUPABASE_BUCKET;
}

let cachedClient = null;

// One service-role client per warm function. Session persistence is off - this
// client only ever makes storage calls. The SDK is imported lazily so the many
// flash endpoints that never upload anything do not pull it in on cold start.
async function supabase() {
  if (!cachedClient) {
    const { createClient } = await import("@supabase/supabase-js");
    cachedClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return cachedClient;
}

// A content hash is 64 lowercase hex characters (SHA-256). Anything else - a
// missing value, a truncated hash, a client that invented one - collapses to
// null, which means "no de-duplication for this upload".
const HASH_RE = /^[0-9a-f]{64}$/;

export function normaliseHash(hash) {
  if (typeof hash !== "string") return null;
  const trimmed = hash.trim().toLowerCase();
  return HASH_RE.test(trimmed) ? trimmed : null;
}

// Validate an upload request without minting anything. Shared by the sign
// endpoint (which de-duplicates before signing) and createSignedUpload (which
// validates again when called directly), so the rules live in one place.
//
// Returns { kind, mime } or throws an Error whose message is safe to show the
// user (the sign endpoint turns it into a 400).
export function validateUploadRequest({ kind, mime, bytes } = {}) {
  const contentType = String(mime ?? "").trim();
  const resolvedKind = kindForMime(contentType);
  if (!resolvedKind) {
    throw new Error("Only image and audio files can be uploaded");
  }
  if (kind && kind !== resolvedKind) {
    throw new Error(`kind "${kind}" does not match the ${resolvedKind} mime type`);
  }

  const size = Number(bytes);
  if (bytes !== undefined && bytes !== null && (!Number.isFinite(size) || size <= 0)) {
    throw new Error("bytes must be a positive number");
  }
  if (Number.isFinite(size) && size > MAX_MEDIA_BYTES) {
    throw new Error(`File is too large (max ${Math.round(MAX_MEDIA_BYTES / (1024 * 1024))} MB)`);
  }

  return { kind: resolvedKind, mime: contentType };
}

// Find an object this user already stored under the same content hash, so the
// sign endpoint can hand back the existing URL instead of minting a fresh upload
// URL for identical bytes. `sql` is the Neon tagged template from
// api/_lib/db.js. Returns { url, path, mime, bytes } or null.
//
// Old rows have a NULL hash and are simply never matched, so this cannot break
// media that predates the hash column.
export async function findStoredObjectByHash(sql, uid, hash) {
  const normalised = normaliseHash(hash);
  if (!normalised) return null;
  try {
    const rows = await sql`
      SELECT url, storage_path, mime, bytes
      FROM fc_media
      WHERE user_id = ${uid} AND hash = ${normalised} AND storage_path IS NOT NULL
      ORDER BY id DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return { url: row.url, path: row.storage_path, mime: row.mime ?? null, bytes: row.bytes ?? null };
  } catch {
    // A database without the hash column (migration not applied yet) must not
    // turn a legitimate upload into a 500 - treat it as a cache miss.
    return null;
  }
}

// Validate an upload request and mint a signed upload URL.
//
// Returns { signedUrl, token, path, publicUrl } or throws an Error whose message
// is safe to show the user (the sign endpoint turns it into a 400).
export async function createSignedUpload({ kind, mime, bytes, filename } = {}) {
  const { kind: resolvedKind, mime: contentType } = validateUploadRequest({ kind, mime, bytes });

  const path = mediaObjectPath(resolvedKind, { filename, mime: contentType }, {
    id: crypto.randomUUID(),
  });

  const bucket = supabaseBucket();
  const client = await supabase();
  const { data, error } = await client.storage.from(bucket).createSignedUploadUrl(path, {
    upsert: false,
  });
  if (error) throw new Error(error.message || "Could not sign the upload");

  const { data: pub } = client.storage.from(bucket).getPublicUrl(path);

  return {
    signedUrl: data.signedUrl,
    token: data.token,
    path: data.path ?? path,
    publicUrl: pub?.publicUrl ?? `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`,
  };
}

// Best-effort: a failure to delete an object must never fail the request that
// triggered it (the row is already gone either way).
export async function removeStoredObjects(paths) {
  const list = [...new Set((paths ?? []).filter(isSafeStoragePath))];
  if (!list.length) return { removed: [] };
  if (!mediaConfigured()) return { removed: [] };

  try {
    const client = await supabase();
    const { data, error } = await client.storage.from(supabaseBucket()).remove(list);
    if (error) {
      console.error("[flash media] storage delete failed", error.message);
      return { removed: [] };
    }
    return { removed: (data ?? []).map((entry) => entry?.name ?? entry?.path ?? entry) };
  } catch (err) {
    console.error("[flash media] storage delete failed", err);
    return { removed: [] };
  }
}

// Delete every storage path that no fc_media row references any more.
//
// After a card (or one of its media blocks) is removed its fc_media rows are
// already gone, so a path with no remaining row cannot be in use and is safe to
// delete from the bucket. The re-check also protects an object deliberately
// shared by two cards. `sql` is the Neon tagged-template function from
// api/_lib/db.js; taking it as an argument keeps this module free of a database
// import.
export async function deleteUnreferencedMedia(sql, paths, uid) {
  const list = [...new Set((paths ?? []).filter(isSafeStoragePath))];
  if (!list.length) return { deleted: 0, kept: 0 };

  const still = await sql`
    SELECT DISTINCT storage_path FROM fc_media
    WHERE user_id = ${uid} AND storage_path = ANY(${list})
  `;
  const kept = new Set(still.map((row) => row.storage_path));
  const gone = list.filter((path) => !kept.has(path));
  await removeStoredObjects(gone);
  return { deleted: gone.length, kept: kept.size };
}
