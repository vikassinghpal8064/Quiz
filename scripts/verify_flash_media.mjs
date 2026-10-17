// End-to-end verification for flash-card media (/api/flash/media/* and the
// fc_media mirror written on card save).
//
// Drives the real dispatch entry (api/index.js) with a real session cookie, so
// routing, auth, validation and the database are all exercised exactly as in
// production. Requires db/flash_001.sql, db/flash_002.sql and db/flash_005.sql
// to be applied.
//
// The bucket PUT itself is NOT exercised here: it needs SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY and a real browser-to-bucket upload. What is checked
// is the server half of the contract:
//   - the sign endpoint rejects anonymous callers, bad mime types and oversized
//     files, and answers 503 when Storage is not configured,
//   - the remove endpoint is authenticated and only accepts safe flash/ paths,
//   - a card's image / audio / ink blocks are mirrored into fc_media (including
//     storage_path and the content hash) on save and on edit, and dropped when
//     the media is removed or the card is deleted,
//   - a content hash this user already owns resolves back to the stored object
//     (findStoredObjectByHash), which is what makes sign skip the PUT,
//   - url-less / oversized media blocks are rejected.
//
//   node scripts/verify_flash_media.mjs
//
// The API modules read process.env at import time, so .env is loaded first and
// everything else is a dynamic import.
process.loadEnvFile(".env");

const { createTestAccount } = await import("./_auth_fixture.mjs");
const { default: dispatch } = await import("../api/index.js");
const { default: sql } = await import("../api/_lib/db.js");
const { mediaConfigured } = await import("../api/_lib/flashMedia.js");

let pass = 0;
let fail = 0;
const failures = [];
function check(label, cond, extra = "") {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(label);
    console.log(`  \u2717 ${label}${extra ? ` -> ${extra}` : ""}`);
  }
}

function makeRes() {
  const r = { statusCode: 0, body: null, headers: {} };
  r.setHeader = (k, v) => {
    r.headers[String(k).toLowerCase()] = v;
  };
  r.status = (code) => ({
    json: (p) => {
      r.statusCode = code;
      r.body = p;
    },
    end: () => {
      r.statusCode = code;
    },
  });
  r.json = (p) => {
    r.statusCode = 200;
    r.body = p;
  };
  r.end = () => {};
  return r;
}

async function call(method, path, { query, body, cookie } = {}) {
  const res = makeRes();
  const req = {
    method,
    url: path,
    query: { path, ...(query ?? {}) },
    body: body ?? null,
    headers: cookie ? { cookie } : {},
  };
  await dispatch(req, res);
  return res;
}

const IMAGE_URL = "https://cdn.example.test/storage/v1/object/public/flash-media/flash/2026/probe-image.webp";
const AUDIO_URL = "https://cdn.example.test/storage/v1/object/public/flash-media/flash/2026/probe-audio.webm";
const IMAGE_URL_2 = "https://cdn.example.test/storage/v1/object/public/flash-media/flash/2026/probe-image-2.webp";
const INK_PREVIEW = "https://cdn.example.test/storage/v1/object/public/flash-media/flash/2026/probe-board.png";
const IMAGE_PATH = "flash/2026/probe-image.webp";
const IMAGE_PATH_2 = "flash/2026/probe-image-2.webp";
const AUDIO_PATH = "flash/2026/probe-audio.webm";
const INK_PATH = "flash/2026/probe-board.png";

async function mediaRows(cardId) {
  return sql`
    SELECT side, kind, url, storage_path, mime, bytes, hash
    FROM fc_media
    WHERE card_id = ${cardId}
    ORDER BY side, kind
  `;
}

async function main() {
  const a = await createTestAccount({ label: "flash_media_a" });
  let folderId = null;

  try {
    let res = await call("POST", "/api/flash/folders", {
      cookie: a.cookie,
      body: { name: "Media Deck" },
    });
    folderId = res.body?.id;

    res = await call("POST", "/api/flash/categories", {
      cookie: a.cookie,
      body: { folder_id: folderId, name: "Media Cat" },
    });
    const categoryId = res.body?.id;
    check("category created for media tests", res.statusCode === 201 && categoryId > 0);

    // ---------- create with image + audio ----------
    res = await call("POST", "/api/flash/cards", {
      cookie: a.cookie,
      body: {
        category_id: categoryId,
        front: {
          blocks: [
            { type: "image", url: IMAGE_URL, path: IMAGE_PATH, mime: "image/webp", bytes: 2048, width: 800, height: 600 },
            { type: "text", text: "an image card" },
          ],
        },
        back: {
          blocks: [{ type: "audio", url: AUDIO_URL, path: AUDIO_PATH, mime: "audio/webm", bytes: 4096 }],
        },
      },
    });
    const cardId = res.body?.id;
    check("card with media is created", res.statusCode === 201 && cardId > 0, JSON.stringify(res.body));

    let rows = await mediaRows(cardId);
    check("fc_media has one row per media block", rows.length === 2, JSON.stringify(rows));
    const imageRow = rows.find((r) => r.kind === "image");
    const audioRow = rows.find((r) => r.kind === "audio");
    check(
      "image row carries side / url / storage_path / mime / bytes",
      imageRow?.side === "front" &&
        imageRow?.url === IMAGE_URL &&
        imageRow?.storage_path === IMAGE_PATH &&
        imageRow?.mime === "image/webp" &&
        imageRow?.bytes === 2048,
      JSON.stringify(imageRow)
    );
    check(
      "audio row carries side / url / storage_path / mime / bytes",
      audioRow?.side === "back" &&
        audioRow?.url === AUDIO_URL &&
        audioRow?.storage_path === AUDIO_PATH &&
        audioRow?.mime === "audio/webm" &&
        audioRow?.bytes === 4096,
      JSON.stringify(audioRow)
    );

    // A path a saved card references must be recognised by the remove endpoint
    // (and therefore kept); it must never be reported as removed.
    res = await call("POST", "/api/flash/media/remove", {
      cookie: a.cookie,
      body: { paths: [IMAGE_PATH] },
    });
    check(
      "remove endpoint keeps a path a saved card references",
      res.statusCode === 200 &&
        Array.isArray(res.body?.removed) &&
        !res.body.removed.includes(IMAGE_PATH),
      JSON.stringify(res.body)
    );

    // ---------- edit: remove the audio ----------
    res = await call("PATCH", `/api/flash/cards/${cardId}`, {
      cookie: a.cookie,
      body: { back: { blocks: [] } },
    });
    check("edit that drops audio succeeds", res.statusCode === 200, JSON.stringify(res.body));
    rows = await mediaRows(cardId);
    check("dropping the audio leaves only the image row", rows.length === 1 && rows[0].kind === "image", JSON.stringify(rows));

    // ---------- edit: replace the image url ----------
    res = await call("PATCH", `/api/flash/cards/${cardId}`, {
      cookie: a.cookie,
      body: {
        front: {
          blocks: [
            { type: "image", url: IMAGE_URL_2, path: IMAGE_PATH_2, mime: "image/webp", bytes: 1024, width: 400, height: 300 },
          ],
        },
      },
    });
    check("edit that replaces the image succeeds", res.statusCode === 200);
    rows = await mediaRows(cardId);
    check(
      "fc_media reflects the replacement url + storage_path",
      rows.length === 1 && rows[0].url === IMAGE_URL_2 && rows[0].storage_path === IMAGE_PATH_2 && rows[0].bytes === 1024,
      JSON.stringify(rows)
    );

    // ---------- validation ----------
    res = await call("POST", "/api/flash/cards", {
      cookie: a.cookie,
      body: { category_id: categoryId, front: { blocks: [{ type: "image" }] }, back: { blocks: [] } },
    });
    check("an image block without a url is rejected", res.statusCode === 400, JSON.stringify(res.body));

    res = await call("POST", "/api/flash/cards", {
      cookie: a.cookie,
      body: {
        category_id: categoryId,
        front: { blocks: [{ type: "image", url: `https://blob.example.test/${"x".repeat(2100)}` }] },
        back: { blocks: [] },
      },
    });
    check("an over-long media url is rejected", res.statusCode === 400, JSON.stringify(res.body));

    // ---------- delete: rows cascade, no blob token required ----------
    res = await call("DELETE", `/api/flash/cards/${cardId}`, { cookie: a.cookie });
    check("deleting a media card succeeds", res.statusCode === 200, JSON.stringify(res.body));
    rows = await mediaRows(cardId);
    check("fc_media rows are gone after the card is deleted", rows.length === 0, JSON.stringify(rows));

    // ---------- handwriting (ink) ----------
    const INK_STROKE = {
      id: "s1",
      tool: "pen",
      color: "#111827",
      width: 4,
      points: [{ x: 0, y: 0, p: 0.5 }, { x: 10, y: 10, p: 0.6 }],
    };

    res = await call("POST", "/api/flash/cards", {
      cookie: a.cookie,
      body: {
        category_id: categoryId,
        front: {
          blocks: [
            {
              type: "ink",
              width: 1200,
              height: 800,
              background: "grid",
              strokes: [INK_STROKE],
              preview: { url: INK_PREVIEW, path: INK_PATH, mime: "image/png", bytes: 900, width: 1200, height: 800 },
            },
          ],
        },
        back: { blocks: [] },
      },
    });
    const inkCardId = res.body?.id;
    check("card with an ink block is created", res.statusCode === 201 && inkCardId > 0, JSON.stringify(res.body));

    rows = await mediaRows(inkCardId);
    const inkRow = rows.find((r) => r.kind === "ink");
    check(
      "the ink preview is mirrored into fc_media as kind 'ink'",
      inkRow?.side === "front" &&
        inkRow?.url === INK_PREVIEW &&
        inkRow?.storage_path === INK_PATH &&
        inkRow?.mime === "image/png" &&
        inkRow?.bytes === 900,
      JSON.stringify(rows)
    );

    // An ink block with only strokes (no preview yet) is still valid, and adds
    // no fc_media row because there is nothing uploaded to clean up.
    res = await call("PATCH", `/api/flash/cards/${inkCardId}`, {
      cookie: a.cookie,
      body: {
        front: { blocks: [{ type: "ink", width: 1200, height: 800, background: "blank", strokes: [INK_STROKE] }] },
      },
    });
    check("edit to a stroke-only ink block succeeds", res.statusCode === 200, JSON.stringify(res.body));
    rows = await mediaRows(inkCardId);
    check("a stroke-only ink block has no fc_media row", rows.length === 0, JSON.stringify(rows));

    res = await call("DELETE", `/api/flash/cards/${inkCardId}`, { cookie: a.cookie });
    check("deleting the ink card succeeds", res.statusCode === 200, JSON.stringify(res.body));

    // An ink block with neither strokes nor preview is empty and rejected.
    res = await call("POST", "/api/flash/cards", {
      cookie: a.cookie,
      body: { category_id: categoryId, front: { blocks: [{ type: "ink" }] }, back: { blocks: [] } },
    });
    check("an empty ink block is rejected", res.statusCode === 400, JSON.stringify(res.body));

    // ---------- media sign endpoint ----------
    res = await call("POST", "/api/flash/media/sign", {
      body: { kind: "image", mime: "image/webp", bytes: 1024, filename: "x.webp" },
    });
    check("sign endpoint rejects anonymous callers", res.statusCode === 401, `status ${res.statusCode}`);

    res = await call("POST", "/api/flash/media/sign", {
      cookie: a.cookie,
      body: { kind: "image", mime: "image/webp", bytes: 1024, filename: "x.webp" },
    });
    if (mediaConfigured()) {
      check(
        "configured sign endpoint returns a signed upload",
        res.statusCode === 200 &&
          typeof res.body?.signedUrl === "string" &&
          typeof res.body?.token === "string" &&
          /^flash\/\d{4}\/[0-9a-f-]{36}\.webp$/.test(res.body?.path ?? "") &&
          typeof res.body?.publicUrl === "string",
        JSON.stringify(res.body)
      );
    } else {
      check(
        "unconfigured sign endpoint answers 503",
        res.statusCode === 503 && typeof res.body?.error === "string",
        JSON.stringify(res.body)
      );
    }

    res = await call("GET", "/api/flash/media/sign", { cookie: a.cookie });
    check("sign endpoint rejects non-POST", res.statusCode === 405, `status ${res.statusCode}`);

    // The mime / size rules live in createSignedUpload, which is pure validation
    // until it actually signs - so they are checked directly here and hold even
    // on a deployment with no Storage configured.
    const { createSignedUpload } = await import("../api/_lib/flashMedia.js");

    let threw = null;
    try {
      await createSignedUpload({ kind: "video", mime: "video/mp4", bytes: 100 });
    } catch (err) {
      threw = err;
    }
    check(
      "createSignedUpload rejects a non image/audio mime",
      Boolean(threw) && /image and audio/i.test(threw.message),
      String(threw?.message)
    );

    threw = null;
    try {
      await createSignedUpload({ kind: "image", mime: "image/webp", bytes: 6 * 1024 * 1024 });
    } catch (err) {
      threw = err;
    }
    check(
      "createSignedUpload rejects a file over the 5 MB ceiling",
      Boolean(threw) && /too large/i.test(threw.message),
      String(threw?.message)
    );

    threw = null;
    try {
      await createSignedUpload({ kind: "image", mime: "image/webp", bytes: -1 });
    } catch (err) {
      threw = err;
    }
    check(
      "createSignedUpload rejects non-positive bytes",
      Boolean(threw) && /positive/i.test(threw.message),
      String(threw?.message)
    );

    // ---------- content-hash de-duplication ----------
    // The pipeline hashes every encoded upload; on save the hash is mirrored
    // into fc_media, and the sign endpoint resolves a known hash back to the
    // stored object so identical bytes are never uploaded twice.
    const HASH = "d".repeat(64);
    res = await call("POST", "/api/flash/cards", {
      cookie: a.cookie,
      body: {
        category_id: categoryId,
        front: {
          blocks: [
            { type: "image", url: IMAGE_URL, path: IMAGE_PATH, mime: "image/webp", bytes: 2048, hash: HASH },
          ],
        },
        back: { blocks: [] },
      },
    });
    const hashCardId = res.body?.id;
    check("card with a hashed image is created", res.statusCode === 201 && hashCardId > 0, JSON.stringify(res.body));

    rows = await mediaRows(hashCardId);
    check("the image content hash is mirrored into fc_media", rows[0]?.hash === HASH, JSON.stringify(rows));

    const { findStoredObjectByHash } = await import("../api/_lib/flashMedia.js");
    const found = await findStoredObjectByHash(sql, String(a.id), HASH);
    check(
      "findStoredObjectByHash returns the stored object for the hash",
      found?.url === IMAGE_URL && found?.path === IMAGE_PATH && found?.bytes === 2048,
      JSON.stringify(found)
    );
    check(
      "findStoredObjectByHash treats a malformed hash as a cache miss",
      (await findStoredObjectByHash(sql, String(a.id), "not-a-hash")) === null
    );
    check(
      "findStoredObjectByHash misses a hash this user never stored",
      (await findStoredObjectByHash(sql, String(a.id), "e".repeat(64))) === null
    );

    if (mediaConfigured()) {
      // With Storage configured the sign endpoint short-circuits: no signed URL,
      // just the existing object's public URL.
      res = await call("POST", "/api/flash/media/sign", {
        cookie: a.cookie,
        body: { kind: "image", mime: "image/webp", bytes: 2048, filename: "dup.webp", hash: HASH },
      });
      check(
        "sign de-duplicates a known hash (no signed url minted)",
        res.statusCode === 200 &&
          res.body?.deduplicated === true &&
          res.body?.url === IMAGE_URL &&
          !res.body?.signedUrl,
        JSON.stringify(res.body)
      );
    }

    await call("DELETE", `/api/flash/cards/${hashCardId}`, { cookie: a.cookie });

    // ---------- media remove endpoint ----------
    res = await call("POST", "/api/flash/media/remove", { body: { paths: ["flash/2026/x.webp"] } });
    check("remove endpoint rejects anonymous callers", res.statusCode === 401, `status ${res.statusCode}`);

    res = await call("GET", "/api/flash/media/remove", { cookie: a.cookie });
    check("remove endpoint rejects non-POST", res.statusCode === 405, `status ${res.statusCode}`);

    res = await call("POST", "/api/flash/media/remove", {
      cookie: a.cookie,
      body: { paths: ["../etc/passwd", "evil/x.webp", ""] },
    });
    check(
      "remove endpoint ignores unsafe paths",
      res.statusCode === 200 && Array.isArray(res.body?.removed) && res.body.removed.length === 0,
      JSON.stringify(res.body)
    );

    res = await call("POST", "/api/flash/media/remove", {
      cookie: a.cookie,
      body: { paths: ["flash/2026/superseded.webp"] },
    });
    check(
      "remove endpoint accepts a safe flash/ path",
      res.statusCode === 200 && Array.isArray(res.body?.removed),
      JSON.stringify(res.body)
    );
    // ---------- bulk import mirrors media with storage_path ----------
    res = await call("POST", "/api/flash/cards/bulk", {
      cookie: a.cookie,
      body: {
        category_id: categoryId,
        cards: [
          {
            front: { blocks: [{ type: "image", url: IMAGE_URL, path: IMAGE_PATH, mime: "image/webp", bytes: 11 }] },
            back: { blocks: [] },
          },
          {
            front: { blocks: [] },
            back: { blocks: [{ type: "audio", url: AUDIO_URL, path: AUDIO_PATH, mime: "audio/webm", bytes: 12 }] },
          },
        ],
      },
    });
    const bulkIds = (res.body?.cards ?? []).map((c) => c.id);
    check(
      "bulk import creates the cards",
      res.statusCode === 201 && res.body?.inserted === 2 && bulkIds.length === 2,
      JSON.stringify(res.body)
    );
    const bulkMedia = await sql`
      SELECT card_id, kind, storage_path FROM fc_media
      WHERE card_id = ANY(${bulkIds})
      ORDER BY card_id, kind
    `;
    check(
      "bulk import mirrors media rows with storage_path",
      bulkMedia.length === 2 && bulkMedia.every((r) => typeof r.storage_path === "string" && r.storage_path),
      JSON.stringify(bulkMedia)
    );

    // ---------- category delete gathers media paths, and still cascades ----
    res = await call("POST", "/api/flash/cards", {
      cookie: a.cookie,
      body: {
        category_id: categoryId,
        front: {
          blocks: [
            { type: "image", url: IMAGE_URL, path: "flash/2026/cat-delete.webp", mime: "image/webp", bytes: 10 },
          ],
        },
        back: { blocks: [] },
      },
    });
    const catCardId = res.body?.id;
    check("media card created before the category delete", res.statusCode === 201 && catCardId > 0, JSON.stringify(res.body));

    res = await call("DELETE", `/api/flash/categories/${categoryId}`, { cookie: a.cookie });
    check(
      "deleting a category with media cards succeeds",
      res.statusCode === 200,
      `${res.statusCode} ${JSON.stringify(res.body)}`
    );
    rows = await mediaRows(catCardId);
    check("media rows cascade away with the category", rows.length === 0, JSON.stringify(rows));
  } finally {
    if (folderId) await sql`DELETE FROM fc_folders WHERE id = ${folderId}`;
    await sql`DELETE FROM fc_folders WHERE user_id = ${String(a.id)}`;
    await a.cleanup();
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("Failed checks:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(fail ? 1 : 0);
}

await main();
