// Supabase Storage adapter for flash-card media.
//
// The browser never sees the service-role key: the bytes go straight to
// Supabase Storage using a short-lived signed upload URL that the server mints
// (POST /api/flash/media/sign). This module only knows how to
//
//   1. ask the server for that signed URL, and
//   2. PUT the file to it (reporting progress), and
//   3. ask the server to delete objects it still owns.
//
// The signed URL is absolute and already carries the token in its query string,
// so no project URL or API key is needed here - which is exactly what keeps the
// secrets server-side.

export const SIGN_ENDPOINT = "/api/flash/media/sign";
export const REMOVE_ENDPOINT = "/api/flash/media/remove";

function errorFrom(payload, fallback) {
  return new Error((payload && payload.error) || fallback);
}

// Ask the server to sign an upload. `meta` is { kind, mime, bytes, filename,
// hash }. Resolves to { signedUrl, token, path, publicUrl, hash } or, when the
// server already holds an object with this content hash, to
// { deduplicated: true, url, path, mime, bytes, hash } and no signedUrl.
export async function createUpload(meta) {
  const response = await fetch(SIGN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(meta ?? {}),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw errorFrom(payload, `Could not prepare the upload (${response.status})`);
  }
  // A de-duplicated response carries no signed URL: the server already holds an
  // object with this content hash, so there is nothing to upload. Callers check
  // `deduplicated` and skip the PUT.
  if (payload?.deduplicated) {
    if (!payload.path || !payload.url) {
      throw errorFrom(payload, "The upload was not signed correctly");
    }
    return payload;
  }
  if (!payload?.signedUrl || !payload?.path) {
    throw errorFrom(payload, "The upload was not signed correctly");
  }
  return payload;
}

// PUT a file to its signed URL. `signedUrl` comes from createUpload; the token
// is part of that URL (and is accepted here for symmetry / debugging).
//
// XHR is used instead of fetch purely so byte-level progress can be reported
// while a large recording uploads.
export function uploadToSignedUrl(path, token, file, { signedUrl, contentType, onProgress } = {}) {
  const url = signedUrl;
  if (!url) {
    return Promise.reject(new Error("Missing signed upload URL"));
  }

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url, true);
    request.setRequestHeader("content-type", contentType || file?.type || "application/octet-stream");
    request.setRequestHeader("x-upsert", "false");
    request.setRequestHeader("cache-control", "3600");

    if (typeof onProgress === "function") {
      request.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        onProgress({
          loaded: event.loaded,
          total: event.total,
          percentage: event.total ? (event.loaded / event.total) * 100 : 0,
        });
      };
    }

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve({ path, token });
      } else {
        reject(new Error(request.responseText || `Upload failed (${request.status})`));
      }
    };
    request.onerror = () => reject(new Error("Upload failed (network error)"));
    request.onabort = () => reject(new Error("Upload cancelled"));
    request.send(file);
  });
}

// Ask the server to delete objects. Only paths the caller still owns are
// removed, so a forged path cannot delete someone else's file.
export async function remove(paths) {
  const list = [...new Set((paths ?? []).filter((p) => typeof p === "string" && p.trim()))];
  if (!list.length) return { removed: [] };

  const response = await fetch(REMOVE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ paths: list }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw errorFrom(payload, `Could not remove the file (${response.status})`);
  }
  return payload ?? { removed: [] };
}

const supabaseStorage = {
  name: "supabase",
  createUpload,
  uploadToSignedUrl,
  remove,
};

export default supabaseStorage;
