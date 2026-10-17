// Content hashing for upload de-duplication.
//
// Every encoded image is hashed with SHA-256 before it is uploaded. The hash
// travels with the sign request; when the server already holds an object with
// that hash for the user, it hands back the existing URL and no bytes are sent.
// The hash is mirrored into fc_media.hash (db/flash_005.sql) so the lookup is an
// index probe rather than a scan.
//
// crypto.subtle is only available in a secure context (https / localhost). When
// it is missing the pipeline simply uploads without de-duplication: a null hash
// is a supported outcome everywhere, never an error.

export function hasSubtleCrypto() {
  return typeof crypto !== "undefined" && Boolean(crypto.subtle) && typeof crypto.subtle.digest === "function";
}

// SHA-256 of a Blob/ArrayBuffer, as lowercase hex. Returns null when the runtime
// has no SubtleCrypto (an insecure origin, an old engine), which the caller
// treats as "no de-duplication available".
export async function sha256Hex(input) {
  if (!hasSubtleCrypto() || !input) return null;
  try {
    const buffer = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, "0");
    return hex;
  } catch {
    return null;
  }
}
