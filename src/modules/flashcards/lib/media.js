// Client-side media upload for flash cards.
//
// The bytes go straight from the browser to the storage bucket: this asks the
// app's own /api/flash/media/sign endpoint for a short-lived signed upload URL,
// PUTs the file to it (reporting progress), and returns the fields a media
// block stores. The provider is chosen through the storage adapter registry
// (lib/storage), so Supabase can be swapped for another bucket later without
// touching a single call site.
//
// Uploads are retried on failure: a flaky phone network should not cost the
// user a recording. See UPLOAD_RETRIES.

import { getStorage } from "./storage/index.js";

// A file is retried up to this many times after its first attempt fails, so a
// single upload can run at most UPLOAD_RETRIES + 1 times.
export const UPLOAD_RETRIES = 3;

// Growing pause between attempts (ms): 0.5s, 1s, 1.5s.
const RETRY_BACKOFF_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Re-exported so existing imports keep working and the pure helpers stay
// testable without pulling in fetch/XHR.
export { MAX_MEDIA_BYTES, extensionFor } from "./storage/paths.js";

// Upload one Blob/File and return the fields a media block stores:
//   { url, path, mime, bytes, hash, deduplicated }
// `url` is the public URL stamped into the block; `path` is the object key kept
// in fc_media.storage_path so the server can delete the file later.
//
// `hash` is the SHA-256 of the bytes (from the image pipeline). When the server
// already owns an object with that hash it answers `deduplicated: true` and the
// PUT is skipped entirely - the block still gets a valid URL, just pointing at
// the object that was already there.
//
// onProgress receives { loaded, total, percentage } while the bytes upload and
// { percentage: 0, retry: n } before each retry.
export async function uploadMediaBlob(
  blob,
  { kind, filename, mime, hash, onProgress, retries = UPLOAD_RETRIES, backoffMs = RETRY_BACKOFF_MS, storage } = {}
) {
  const adapter = storage ?? getStorage();
  const fallbackType = kind === "audio" ? "audio/webm" : "image/webp";
  const contentType = mime || blob?.type || fallbackType;
  const bytes = blob?.size ?? null;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const signed = await adapter.createUpload({ kind, mime: contentType, bytes, filename, hash });
      if (signed.deduplicated) {
        return {
          url: signed.url ?? signed.publicUrl,
          path: signed.path,
          mime: signed.mime || contentType,
          bytes: signed.bytes ?? bytes,
          hash: hash ?? null,
          deduplicated: true,
        };
      }
      await adapter.uploadToSignedUrl(signed.path, signed.token, blob, {
        signedUrl: signed.signedUrl,
        contentType,
        onProgress,
      });
      return {
        url: signed.publicUrl,
        path: signed.path,
        mime: contentType,
        bytes,
        hash: hash ?? null,
        deduplicated: false,
      };
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        onProgress?.({ percentage: 0, retry: attempt + 1 });
        await sleep(backoffMs * (attempt + 1));
      }
    }
  }
  throw lastError ?? new Error("Upload failed");
}

// Upload a list of files, preserving order, and report progress as
// { done, total } so the UI can say "3 of 12 uploaded". Each entry is
// { file, filename?, mime? }; the result is { ok: true, value } or
// { ok: false, error } per file, so one bad image never sinks the batch.
export async function uploadMediaBatch(
  items,
  { kind, retries = UPLOAD_RETRIES, concurrency = 2, backoffMs = 0, storage, onProgress } = {}
) {
  const list = items ?? [];
  const results = new Array(list.length);
  let next = 0;
  let done = 0;

  onProgress?.({ done: 0, total: list.length });

  async function run() {
    while (next < list.length) {
      const index = next;
      next += 1;
      const item = list[index];
      try {
        const value = await uploadMediaBlob(item.file, {
          kind,
          filename: item.filename,
          mime: item.mime,
          onProgress: item.onProgress,
          retries,
          backoffMs,
          storage,
        });
        results[index] = { ok: true, value };
      } catch (error) {
        results[index] = { ok: false, error };
      }
      done += 1;
      onProgress?.({ done, total: list.length });
    }
  }

  const runners = [];
  for (let i = 0; i < Math.max(1, Math.min(concurrency, list.length)); i += 1) runners.push(run());
  await Promise.all(runners);

  return results;
}

// Best-effort delete of objects the caller uploaded but no longer needs.
export async function removeMediaPaths(paths, { storage } = {}) {
  const list = (paths ?? []).filter(Boolean);
  if (!list.length) return { removed: [] };
  const adapter = storage ?? getStorage();
  return adapter.remove(list);
}
