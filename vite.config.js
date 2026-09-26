import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.join(__dirname, "api");

const isFile = async (p) => {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
};

const isDir = async (p) => {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
};

// Vercel treats any bracketed path segment as a route parameter, so
// [id].js, [token].js and friends all work. Sorted so resolution is
// deterministic if a directory ever holds more than one.
const DYNAMIC_DIR = /^\[([^\]]+)\]$/;
const DYNAMIC_FILE = /^\[([^\]]+)\]\.js$/;

const listDynamic = async (dir, pattern) => {
  const entries = await readdir(dir).catch(() => []);
  return entries
    .filter((e) => pattern.test(e))
    .map((e) => ({ name: pattern.exec(e)[1], entry: e }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

// Matches one path segment against the directories inside `dir`, falling
// back to a dynamic directory such as [id] or [slug].
async function matchDirSegment(dir, segment) {
  const literal = path.join(dir, segment);
  if (await isDir(literal)) return { dir: literal, param: null };
  for (const d of await listDynamic(dir, DYNAMIC_DIR)) {
    const p = path.join(dir, d.entry);
    if (await isDir(p)) return { dir: p, param: { name: d.name, value: segment } };
  }
  return null;
}

// Matches the remaining segments against a handler file inside `dir`.
async function matchFileSegment(dir, fileParts) {
  if (fileParts.length === 0) {
    const index = path.join(dir, "index.js");
    return (await isFile(index)) ? { file: index, param: null } : null;
  }
  const literal = path.join(dir, ...fileParts) + ".js";
  if (await isFile(literal)) return { file: literal, param: null };
  if (fileParts.length === 1) {
    for (const d of await listDynamic(dir, DYNAMIC_FILE)) {
      const p = path.join(dir, d.entry);
      if (await isFile(p)) return { file: p, param: { name: d.name, value: fileParts[0] } };
    }
  }
  return null;
}

async function resolveRoute(segments) {
  for (let k = segments.length; k >= 0; k--) {
    let dir = API_DIR;
    const params = {};
    let ok = true;
    for (let i = 0; i < k; i++) {
      const m = await matchDirSegment(dir, segments[i]);
      if (!m) {
        ok = false;
        break;
      }
      dir = m.dir;
      if (m.param) params[m.param.name] = m.param.value;
    }
    if (!ok) continue;
    const fm = await matchFileSegment(dir, segments.slice(k));
    if (fm) {
      if (fm.param) params[fm.param.name] = fm.param.value;
      return { file: fm.file, params };
    }
  }
  return null;
}

// Exported so scripts/verify_routing.mjs can test the real resolver rather
// than a copy of it. A regression here silently breaks every API call in
// local development.
export { resolveRoute, API_DIR };

function makeRes(res) {
  const respond = (status, payload) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(payload));
  };
  return {
    setHeader: (key, value) => {
      try {
        res.setHeader(key, value);
      } catch {}
    },
    status: (code) => ({
      json: (payload) => respond(code, payload),
      end: (payload) => respond(code, payload),
    }),
    json: (payload) => respond(200, payload),
    end: () => {
      if (!res.writableEnded) res.end();
    },
  };
}

function localServerlessApi() {
  try {
    process.loadEnvFile(path.join(__dirname, ".env"));
  } catch {}

  return {
    name: "local-serverless-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = new URL(req.url, "http://localhost");
          if (!url.pathname.startsWith("/api/")) return next();

          const segments = url.pathname.split("/").filter(Boolean).slice(1);
          const match = await resolveRoute(segments);
          if (!match) {
            res.statusCode = 404;
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ error: "Not found" }), "utf8");
          }

          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          let body = null;
          if (chunks.length) {
            try {
              body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
              body = {};
            }
          }

          const query = Object.fromEntries(url.searchParams.entries());
          for (const [key, value] of Object.entries(match.params)) query[key] = String(value);

          const module = await import(pathToFileURL(match.file).href);
          await module.default(
            {
              method: req.method,
              url: req.url,
              query,
              body,
              // Auth reads the session cookie off the request, so the
              // dev harness has to pass headers through the same way
              // Vercel does.
              headers: req.headers,
            },
            makeRes(res)
          );
        } catch (err) {
          console.error("[api]", err);
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Internal server error" }), "utf8");
          }
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localServerlessApi()],
});