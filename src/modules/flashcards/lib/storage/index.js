// Storage adapter registry.
//
// The upload path is provider-agnostic: callers ask the registry for the active
// adapter and use its three methods. Adding S3 / R2 / a different bucket later
// means writing one more adapter and registering it here - no call site changes.
//
//   createUpload(meta)                     -> { signedUrl, token, path, publicUrl }
//   uploadToSignedUrl(path, token, file)   -> { path, token }
//   remove(paths)                          -> { removed: [...] }
//
// The default is Supabase Storage (see supabaseStorage.js).

import supabaseStorage from "./supabaseStorage.js";

const registry = new Map();

export function registerStorage(adapter) {
  if (!adapter || typeof adapter.name !== "string") {
    throw new Error("a storage adapter needs a name");
  }
  registry.set(adapter.name, adapter);
  return adapter;
}

registerStorage(supabaseStorage);

export const DEFAULT_STORAGE = supabaseStorage.name;

// Names returned as a stable array, default first - handy for a future settings
// dropdown.
export function storageNames() {
  const names = [...registry.keys()];
  names.sort((a, b) => (a === DEFAULT_STORAGE ? -1 : b === DEFAULT_STORAGE ? 1 : a.localeCompare(b)));
  return names;
}

// Resolve an adapter by name, falling back to the default.
export function getStorage(name) {
  return registry.get(name) ?? registry.get(DEFAULT_STORAGE);
}

export { supabaseStorage };
