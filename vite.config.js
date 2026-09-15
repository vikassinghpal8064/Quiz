import { stat } from "node:fs/promises";
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

async function matchFile(dir, fileParts) {
  if (fileParts.length === 0) {
    const index = path.join(dir, "index.js");
    return (await isFile(index)) ? index : null;
  }
  const literal = path.join(dir, ...fileParts) + ".js";
  if (await isFile(literal)) return literal;
  if (fileParts.length === 1) {
    const dyn = path.join(dir, "[id].js");
    if (await isFile(dyn)) return dyn;
  }
  return null;
}

async function resolveRoute(segments) {
  for (let k = segments.length; k >= 0; k--) {
    let dir = API_DIR;
    const params = {};
    let ok = true;
    for (let i = 0; i < k; i++) {
      const part = segments[i];
      const literal = path.join(dir, part);
      const dynDir = path.join(dir, "[id]");
      if (await isDir(literal)) {
        dir = literal;
      } else if (await isDir(dynDir)) {
        dir = dynDir;
        params.id = part;
      } else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const fileParts = segments.slice(k);
    const file = await matchFile(dir, fileParts);
    if (file) {
      if (path.basename(file) === "[id].js" && fileParts.length === 1) {
        params.id = fileParts[0];
      }
      return { file, params };
    }
  }
  return null;
}

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
          for (const [key, value] of Object.entries(match.params)) query[key] = value;
          if (query.id !== undefined) query.id = String(query.id);

          const module = await import(pathToFileURL(match.file).href);
          await module.default(
            { method: req.method, url: req.url, query, body },
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