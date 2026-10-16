// Client-side media upload for flash cards.
//
// The bytes go straight from the browser to Vercel Blob: this asks the app's
// own /api/flash/media/token endpoint for a short-lived client token, then
// uploads to Blob (reporting progress), and returns the URL to stamp into the
// block JSON. `@vercel/blob/client` is imported lazily so the SDK lands in its
// own chunk and is only fetched when an upload actually starts.

export const MEDIA_TOKEN_URL = "/api/flash/media/token";
export const MEDIA_ACCESS = "public";

// Above this size the multipart path is used (parallel parts + retries), which
// is what makes a long recording reliable.
export const MULTIPART_THRESHOLD = 5 * 1024 * 1024;

const MIME_EXTENSION = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/heic": "heic",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
  "audio/opus": "opus",
};

const DEFAULT_EXTENSION = { image: "webp", audio: "webm" };

export function randomMediaId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// Pick an extension for the blob. A real filename wins (so a picked .wav stays
// .wav); otherwise it is derived from the MIME type; otherwise from the kind.
export function extensionFor(kind, filename = "", mime = "") {
  const match = /\.([a-z0-9]{1,5})$/i.exec(String(filename ?? "").split(/[?#]/)[0]);
  if (match) return match[1].toLowerCase();
  return MIME_EXTENSION[mime] || DEFAULT_EXTENSION[kind] || "bin";
}

// fc/<kind>/<random>.<ext>. The prefix + kind is what api/_flash/media/token.js
// validates before it mints a token, so the path can never leave the media
// namespace.
export function mediaPathname(kind, { filename, mime } = {}) {
  return `fc/${kind}/${randomMediaId()}.${extensionFor(kind, filename, mime)}`;
}

// Upload a Blob/File and return the fields a media block stores.
//   { url, pathname, mime, bytes }
// onProgress receives { loaded, total, percentage } from the SDK.
export async function uploadMediaBlob(blob, { kind, filename, mime, onProgress } = {}) {
  const fallbackType = kind === "audio" ? "audio/webm" : "image/webp";
  const contentType = mime || blob.type || fallbackType;
  const pathname = mediaPathname(kind, { filename, mime: contentType });

  const { upload } = await import("@vercel/blob/client");
  const result = await upload(pathname, blob, {
    access: MEDIA_ACCESS,
    handleUploadUrl: MEDIA_TOKEN_URL,
    contentType,
    multipart: (blob.size ?? 0) > MULTIPART_THRESHOLD,
    onUploadProgress: onProgress,
  });

  return {
    url: result.url,
    pathname: result.pathname,
    mime: contentType,
    bytes: blob.size ?? null,
  };
}
