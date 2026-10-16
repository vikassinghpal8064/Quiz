// End-to-end verification for flash-card media (/api/flash/media/* and the
// fc_media mirror written on card save).
//
// Drives the real dispatch entry (api/index.js) with a real session cookie, so
// routing, auth, validation and the database are all exercised exactly as in
// production. Requires db/flash_001.sql and db/flash_002.sql to be applied.
//
// Blob uploads themselves are NOT exercised here: they require
// BLOB_READ_WRITE_TOKEN and a real browser-to-Blob PUT. What is checked is the
// server half of the contract:
//   - the token endpoint rejects anonymous callers and answers 503 when Blob is
//     not configured,
//   - a card's image / audio blocks are mirrored into fc_media on save and on
//     edit, and dropped when the media is removed or the card is deleted,
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
const { blobConfigured } = await import("../api/_lib/flashMedia.js");

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

const IMAGE_URL = "https://blob.example.test/fc/image/probe-image.webp";
const AUDIO_URL = "https://blob.example.test/fc/audio/probe-audio.webm";
const IMAGE_URL_2 = "https://blob.example.test/fc/image/probe-image-2.webp";

async function mediaRows(cardId) {
  return sql`
    SELECT side, kind, url, mime, bytes
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
            { type: "image", url: IMAGE_URL, mime: "image/webp", bytes: 2048, width: 800, height: 600 },
            { type: "text", text: "an image card" },
          ],
        },
        back: {
          blocks: [{ type: "audio", url: AUDIO_URL, mime: "audio/webm", bytes: 4096 }],
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
      "image row carries side / url / mime / bytes",
      imageRow?.side === "front" &&
        imageRow?.url === IMAGE_URL &&
        imageRow?.mime === "image/webp" &&
        imageRow?.bytes === 2048,
      JSON.stringify(imageRow)
    );
    check(
      "audio row carries side / url / mime / bytes",
      audioRow?.side === "back" &&
        audioRow?.url === AUDIO_URL &&
        audioRow?.mime === "audio/webm" &&
        audioRow?.bytes === 4096,
      JSON.stringify(audioRow)
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
            { type: "image", url: IMAGE_URL_2, mime: "image/webp", bytes: 1024, width: 400, height: 300 },
          ],
        },
      },
    });
    check("edit that replaces the image succeeds", res.statusCode === 200);
    rows = await mediaRows(cardId);
    check(
      "fc_media reflects the replacement url",
      rows.length === 1 && rows[0].url === IMAGE_URL_2 && rows[0].bytes === 1024,
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
    const INK_PREVIEW = "https://blob.example.test/fc/ink/probe-board.png";
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
              preview: { url: INK_PREVIEW, mime: "image/png", bytes: 900, width: 1200, height: 800 },
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
      inkRow?.side === "front" && inkRow?.url === INK_PREVIEW && inkRow?.mime === "image/png" && inkRow?.bytes === 900,
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

    // ---------- media token endpoint ----------
    res = await call("POST", "/api/flash/media/token", {
      body: { type: "blob.generate-client-token", payload: { pathname: "fc/image/x.webp" } },
    });
    check("token endpoint rejects anonymous callers", res.statusCode === 401, `status ${res.statusCode}`);

    res = await call("POST", "/api/flash/media/token", {
      cookie: a.cookie,
      body: { type: "blob.generate-client-token", payload: { pathname: "fc/image/x.webp" } },
    });
    if (blobConfigured()) {
      check(
        "configured token endpoint answers a client token",
        res.statusCode === 200 && typeof res.body?.clientToken === "string",
        JSON.stringify(res.body)
      );
    } else {
      check(
        "unconfigured token endpoint answers 503",
        res.statusCode === 503 && typeof res.body?.error === "string",
        JSON.stringify(res.body)
      );
    }

    res = await call("GET", "/api/flash/media/token", { cookie: a.cookie });
    check("token endpoint rejects non-POST", res.statusCode === 405, `status ${res.statusCode}`);

    // The ink prefix is an accepted upload path (used for handwriting previews).
    // With Blob unconfigured the endpoint answers 503 before it validates the
    // path, so this only proves it is not rejected any earlier; when configured
    // it must mint a client token exactly like an image.
    res = await call("POST", "/api/flash/media/token", {
      cookie: a.cookie,
      body: { type: "blob.generate-client-token", payload: { pathname: "fc/ink/probe-board.png" } },
    });
    if (blobConfigured()) {
      check(
        "configured token endpoint accepts an ink preview path",
        res.statusCode === 200 && typeof res.body?.clientToken === "string",
        JSON.stringify(res.body)
      );
    } else {
      check(
        "ink preview token request is not rejected before the config check",
        res.statusCode === 503 && typeof res.body?.error === "string",
        JSON.stringify(res.body)
      );
    }
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
