import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolved to an absolute URL on purpose. Vercel bundles this config into a
// temp file before running it, so a relative specifier would be resolved
// against the wrong directory, and a literal specifier would be inlined by
// the bundler - which would import every handler (and therefore read
// DATABASE_URL) while the config is still loading, before .env has been read
// below. A computed specifier stays a real runtime import.
const ROUTER_URL = new URL("./api/_lib/router.js", import.meta.url).href;
let router;
const loadRouter = () => (router ??= import(ROUTER_URL));

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

          const { resolveRoute } = await loadRouter();
          const segments = url.pathname.split("/").filter(Boolean).slice(1);
          const match = resolveRoute(segments);
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

          // Same query shape the deployed catch-all builds, so a handler that
          // works here works there.
          const query = { ...Object.fromEntries(url.searchParams.entries()), ...match.params };

          await match.handler(
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