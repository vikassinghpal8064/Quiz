// Pure naming rules for flash-card media objects.
//
// Shared by the browser (which uploads the bytes) and by the server (which
// mints the signed upload URL and later deletes the object), so the two can
// never disagree about where a file lives or which content types are allowed.
// Nothing here touches the DOM, fetch or a storage SDK, so it is safe to import
// from either side (and from unit tests).
//
// Objects are laid out as:
//
//   flash/<yyyy>/<uuid>.<ext>
//
// One flat namespace, bucketed by upload year so a bucket listing stays
// manageable. The kind (image vs audio) is not part of the path - it is
// validated from the MIME type before the URL is signed.

// Every upload is capped at 5 MB, whichever kind it is.
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

// The top-level folder inside the bucket.
export const MEDIA_PREFIX = "flash";

// MIME -> file extension. A real filename wins over this table (so a picked
// .wav stays .wav); the table is the fallback for a synthesised/blob file.
const MIME_EXTENSION = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/svg+xml": "svg",
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

// The two kinds the sign endpoint accepts.
export const MEDIA_KINDS = Object.freeze(["image", "audio"]);

export function isImageMime(mime) {
  return /^image\//i.test(String(mime ?? "").trim());
}

export function isAudioMime(mime) {
  return /^audio\//i.test(String(mime ?? "").trim());
}

// "image" | "audio" | null. Ink previews and background images are PNGs, so a
// pencil drawing arrives as kind "image".
export function kindForMime(mime) {
  if (isImageMime(mime)) return "image";
  if (isAudioMime(mime)) return "audio";
  return null;
}

// Pick an extension for the object: a real filename first, then the MIME type,
// then the kind default.
export function extensionFor(kind, filename = "", mime = "") {
  const match = /\.([a-z0-9]{1,5})$/i.exec(String(filename ?? "").split(/[?#]/)[0]);
  if (match) return match[1].toLowerCase();
  return MIME_EXTENSION[String(mime ?? "").toLowerCase()] || DEFAULT_EXTENSION[kind] || "bin";
}

// flash/<yyyy>/<id>.<ext>. `id` is the UUID the server generated; `date` is
// injectable so the year bucket is deterministic in tests.
export function mediaObjectPath(kind, { filename, mime } = {}, { id, date = new Date() } = {}) {
  const ext = extensionFor(kind, filename, mime);
  const year = String(date.getUTCFullYear());
  return `${MEDIA_PREFIX}/${year}/${id}.${ext}`;
}

// A safe object path for fc_media.storage_path: a string under flash/ with no
// traversal, no leading slash and a bounded length. Anything the client sends
// to the delete endpoint is filtered through this.
export function isSafeStoragePath(path) {
  if (typeof path !== "string" || !path.trim()) return false;
  if (path.length > 512) return false;
  if (path.startsWith("/") || path.includes("..") || path.includes("//")) return false;
  return /^flash\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(path);
}
