# Flashcards module

A spaced-repetition module that lives inside the quiz app (routes under
`/flash`, API under `/api/flash/*`). It is additive: new `fc_*` tables, its own
API handlers under `api/_flash/`, and its own pages/components under
`src/modules/flashcards/`. No quiz table, endpoint, page or component is
modified.

## Media storage (Supabase Storage)

Image, audio and handwriting-preview files do **not** pass through a serverless
function. The browser asks the server for a short-lived signed upload URL, then
PUTs the bytes straight to Supabase Storage:

```
browser ──POST /api/flash/media/sign──▶ server (service-role key, server-side only)
        ◀──── { signedUrl, token, path, publicUrl }
browser ──PUT signedUrl─────────────▶ Supabase Storage bucket
        block stores { url: publicUrl, path }
card save ─▶ fc_media row (url, storage_path, storage_provider)
```

* Objects are named `flash/<yyyy>/<uuid>.<ext>` (see
  `src/modules/flashcards/lib/storage/paths.js`).
* Only `image/*` and `audio/*` are accepted, and every upload is capped at
  **5 MB**. Handwriting previews and background images are re-encoded to WebP
  (previews losslessly), so they arrive as `image/*`.
* `fc_media.storage_path` is written on every save. When a card, category or
  folder is deleted - and when a saved card's image is replaced - the server
  removes the matching objects from the bucket
  (`api/_lib/flashMedia.js` `deleteUnreferencedMedia`). Objects another card
  still references are kept.
* Old rows written before this move keep their original URL and have a `NULL`
  `storage_path`; they stay readable and are simply never deleted from a bucket.

### Environment variables

Set these in `.env` (local) and in the Vercel project settings (production).
All three are server-side only - never expose the service-role key to the
browser:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>     # server-side only
SUPABASE_BUCKET=flash-media                       # a public bucket
```

Without `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` the media endpoints
answer `503` and the rest of the module works unchanged. The bucket must exist
and be **public** (its public URL is what blocks render). A 5 MB bucket-level
file-size limit is also recommended, since the sign endpoint can only validate
the size the client declares.

Create the bucket once (Dashboard → Storage → New bucket → name `flash-media`,
toggle **Public**), or with the CLI:

```bash
supabase storage create flash-media --public
```

### Testing uploads in one line

With `.env` set and the bucket created, run the media verifier (it exercises
routing, auth, mime/size validation, the `fc_media` mirror and the delete
cascade):

```bash
node scripts/verify_flash_media.mjs
```

For the full end-to-end click-through (button → Supabase object → Neon row),
see **Manual test** below.

## Image pipeline

Every image upload - a camera photo, a file picker, a pasted image, a rendered
PDF page, a crop, an APKG image or an ink preview - goes through one shared
pipeline (`src/modules/flashcards/lib/imageProcessing/`). `prepareImage()` takes
the source and returns the single blob to upload plus what happened
(`{ blob, width, height, mime, bytes, hash, originalBytes, … }`).

The rules (all pinned by `__tests__/plan.test.js`):

* **Never re-encode a compressed file.** A WebP / JPEG / AVIF / HEIC that is
  already inside its size budget is uploaded untouched. A PDF page is
  rasterised **once** at 2× its natural size (`PAGE_RENDER_SCALE`, longest edge
  capped at 2400 px) and encoded **once**. A crop is never downscaled.
* **Format.** WebP first. If the browser cannot encode WebP (Safari), the
  encoder falls back to JPEG 0.92 - or PNG for crops and ink, so typeset or
  drawn edges do not ring.
* **Quality.** The `image_quality` setting picks a preset: `balanced` (0.85),
  `high` (0.92, default) or `lossless`. Crops under 600 KB and ink previews are
  encoded losslessly regardless of the preset.
* **Off the main thread.** Encoding runs in a small worker pool (3 workers) over
  `OffscreenCanvas`; decoding (`createImageBitmap`, EXIF-aware) stays on the main
  thread. If workers are unavailable the encode runs inline.
* **De-duplication.** Each result is SHA-256 hashed. On save the hash is mirrored
  into `fc_media.hash`; before minting an upload URL the sign endpoint looks for
  an existing object with that hash **for the same user** and, if found, returns
  it (`{ deduplicated: true, … }`) so the identical bytes are never uploaded
  twice. Old rows have a `NULL` hash and are simply never matched.

The import **Review** step shows each image's compressed size, and - when the
original bytes are kept (APKG imports) - a **Compare original / compressed**
toggle.

## Manual test

1. `npm run dev`, sign in, and open `/flash`.
2. Create a deck + category, then **New card** (`/flash/cards/new`).
3. Add an **Image** block and pick/capture a photo. The upload signs via
   `/api/flash/media/sign` and PUTs to Supabase.
   * Supabase → Storage → `flash-media` → `flash/<current year>/` shows a new
     `<uuid>.webp` (audio records land as `.webm`).
4. Save the card. In Neon, `SELECT url, storage_path, storage_provider FROM
   fc_media WHERE card_id = <id>;` returns one row whose `storage_path` is the
   `flash/<year>/<uuid>.<ext>` you just saw and whose `storage_provider` is
   `supabase`.
5. Delete the card (or its category/folder). The `fc_media` row cascades away
   and the object disappears from the bucket. Replacing a saved card's image
   removes the old object and leaves the new one.

## Layout

| Path | Purpose |
| --- | --- |
| `src/modules/flashcards/lib/storage/` | Storage adapter registry (`index.js`), Supabase adapter (`supabaseStorage.js`), pure path rules (`paths.js`) |
| `src/modules/flashcards/lib/media.js` | `uploadMediaBlob` / `uploadMediaBatch` (sign + PUT, 3 retries), `removeMediaPaths` |
| `api/_flash/media/sign.js` | Mints a signed upload URL |
| `api/_flash/media/remove.js` | Deletes superseded objects the caller still owns |
| `api/_lib/flashMedia.js` | Server signing / deletion helpers, content-hash lookup |
| `src/modules/flashcards/lib/imageProcessing/` | Browser image pipeline: pure sizing/quality rules (`plan.js`), presets (`presets.js`), hashing (`hash.js`), WebP encode + worker pool (`encode.js`, `encode.worker.js`, `encodePool.js`), entry point (`pipeline.js` → `prepareImage`) |
| `src/modules/flashcards/lib/imageQuality.js` | Reads + caches the `image_quality` preset so editors/importers honour it |
| `db/flash_002.sql` | `fc_media` indexes + `storage_provider` / `storage_path` columns |
| `db/flash_005.sql` | `fc_media.hash` column + `(user_id, hash)` index (upload de-duplication) |
