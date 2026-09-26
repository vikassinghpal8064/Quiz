// Shared test-account helper for the verification suites.
//
// Every endpoint except the public auth pages now requires a session, so the
// older suites need a real account. This registers one, optionally promotes it
// to admin directly in the database (there is deliberately no public way to do
// that), logs in, and hands back the session cookie.
//
// Load this with a DYNAMIC import only, after process.loadEnvFile(".env"),
// because the API modules read process.env at import time.
import { neon } from "@neondatabase/serverless";
import registerHandler from "../api/auth/register.js";
import loginHandler from "../api/auth/login.js";

const sql = neon(process.env.DATABASE_URL);

const PASSWORD = "Sup3rSecret!pw";

function makeRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) {
      this.statusCode = code;
      return { json: (p) => { this.body = p; }, end: () => {} };
    },
    json(p) { this.statusCode = 200; this.body = p; },
    end() {},
  };
}

async function invoke(handler, method, body, cookie) {
  const res = makeRes();
  await handler({ method, query: {}, body, url: "", headers: cookie ? { cookie } : {} }, res);
  return res;
}

/**
 * Creates a throwaway account and returns its session cookie.
 * @param {{ role?: "user" | "admin", label?: string }} opts
 */
export async function createTestAccount({ role = "user", label = "test" } = {}) {
  // Unique per run, so an interrupted previous run can never collide.
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const username = `zz_${label}_${stamp}`;
  const phone = `+1666${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;

  const reg = await invoke(registerHandler, "POST", {
    username,
    password: PASSWORD,
    phone_number: phone,
    email: `${username}@example.test`,
  });
  if (reg.statusCode >= 400) {
    throw new Error(`test account registration failed: HTTP ${reg.statusCode} ${JSON.stringify(reg.body)}`);
  }
  const id = reg.body.id;

  if (role === "admin") {
    await sql`UPDATE users SET role = 'admin' WHERE id = ${id}`;
  }

  const login = await invoke(loginHandler, "POST", { username, password: PASSWORD });
  if (login.statusCode >= 400) {
    throw new Error(`test account login failed: HTTP ${login.statusCode} ${JSON.stringify(login.body)}`);
  }
  const setCookie = login.headers["set-cookie"];
  if (!setCookie) throw new Error("login did not return a Set-Cookie header");

  return {
    id,
    username,
    role,
    cookie: setCookie.split(";")[0],
    async cleanup() {
      // ON DELETE SET NULL means the attempts/stars this account owns are
      // orphaned, not destroyed, so this is safe for real history. Scratch
      // rows on scratch subjects are removed by the caller's own cleanup.
      await sql`DELETE FROM users WHERE id = ${id}`;
    },
  };
}
