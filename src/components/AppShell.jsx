import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { modules, moduleForPath } from "../modules/registry";
import { useAuth } from "../lib/authContext";

// Small storage helpers. localStorage can throw in private mode / sandboxed
// iframes, so every access is guarded and failures are non-fatal.
const COLLAPSE_KEY = "flash.shell.collapsed";
const MODE_KEY = "flash.lastMode";

function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function BrandMark({ size = "h-9 w-9 text-xs" }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-xl bg-lavender font-bold text-on-accent ${size}`}
      aria-hidden="true"
    >
      MC
    </span>
  );
}

// The shell that wraps every route: a collapsible left sidebar on desktop, a
// bottom tab bar plus a top mode switch on mobile. It is a layout route, so
// pages render through <Outlet /> and keep their own markup untouched.
export default function AppShell() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState(() => readStored(COLLAPSE_KEY) === "1");

  const activeModule = moduleForPath(location.pathname);
  const activeId = activeModule?.id ?? null;

  useEffect(() => {
    writeStored(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  // "Remember the last used mode": mirror the current module into storage
  // whenever the URL moves between modules. The active module itself is
  // derived from the URL, so no state is needed. We deliberately do not
  // auto-redirect the quiz home to the remembered mode - that would change how
  // the existing quiz pages behave on load.
  useEffect(() => {
    if (activeId) writeStored(MODE_KEY, activeId);
  }, [activeId]);

  // Auth screens (login, register, reset) keep their full-screen look: no
  // shell chrome until we know there is a session. Pages still render through
  // the same Outlet, so their markup and behaviour are unchanged.
  if (!isAuthenticated) return <Outlet />;

  function switchMode(id) {
    const target = modules.find((m) => m.id === id);
    if (!target) return;
    writeStored(MODE_KEY, id);
    navigate(target.basePath);
  }

  return (
    <div className="min-h-screen">
      {/* ---------------- Desktop sidebar ---------------- */}
      <aside
        className={`fixed left-0 top-0 z-40 hidden h-screen flex-col border-r border-ink/10 bg-surface transition-[width] duration-200 md:flex ${
          collapsed ? "w-20" : "w-60"
        }`}
      >
        <div
          className={`flex items-center gap-2.5 border-b border-ink/10 py-4 ${
            collapsed ? "justify-center px-2" : "px-4"
          }`}
        >
          <BrandMark />
          {!collapsed && (
            <span className="truncate font-display text-sm font-semibold tracking-tight text-ink">
              Study Deck
            </span>
          )}
        </div>

        {/* Mode switch, pinned to the top of the shell. */}
        <div className={`mt-4 ${collapsed ? "px-2" : "px-3"}`}>
          {collapsed ? (
            <div className="flex flex-col gap-1">
              {modules.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => switchMode(m.id)}
                  title={`Switch to ${m.label}`}
                  aria-label={`Switch to ${m.label}`}
                  aria-pressed={activeId === m.id}
                  className={`grid place-items-center rounded-lg py-2 text-base transition-colors ${
                    activeId === m.id
                      ? "bg-lavender text-on-accent"
                      : "text-ink/55 hover:bg-ink/5 hover:text-ink"
                  }`}
                >
                  <span aria-hidden="true">{m.icon}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1">
              {modules.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => switchMode(m.id)}
                  aria-pressed={activeId === m.id}
                  className={`rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                    activeId === m.id
                      ? "bg-lavender text-on-accent"
                      : "text-ink/55 hover:text-ink"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* One nav item per registry entry, active one highlighted. */}
        <nav className={`mt-4 flex flex-1 flex-col gap-1 ${collapsed ? "px-2" : "px-3"}`}>
          {modules.map((m) => {
            const active = activeId === m.id;
            return (
              <Link
                key={m.id}
                to={m.basePath}
                title={m.label}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                  collapsed ? "justify-center" : ""
                } ${
                  active
                    ? "bg-lavender/15 text-ink"
                    : "text-ink/55 hover:bg-ink/5 hover:text-ink"
                }`}
              >
                <span
                  className={`text-base ${active ? "text-lavender-soft" : ""}`}
                  aria-hidden="true"
                >
                  {m.icon}
                </span>
                {!collapsed && <span className="truncate">{m.label}</span>}
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`m-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-ink/50 transition-colors hover:bg-ink/5 hover:text-ink ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <span aria-hidden="true">{collapsed ? "»" : "«"}</span>
          {!collapsed && <span>Collapse</span>}
        </button>
      </aside>

      {/* ---------------- Content ---------------- */}
      <div className={`${collapsed ? "md:pl-20" : "md:pl-60"} pb-24 transition-[padding] duration-200 md:pb-0`}>
        {/* Mobile mode switch, at the top. Right padding keeps it clear of the
            app's fixed theme/account buttons in the top-right corner. */}
        <div className="sticky top-0 z-30 flex items-center border-b border-ink/10 bg-cream/95 px-3 py-2.5 pr-[7rem] backdrop-blur md:hidden">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1">
            {modules.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => switchMode(m.id)}
                aria-pressed={activeId === m.id}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                  activeId === m.id
                    ? "bg-lavender text-on-accent"
                    : "text-ink/55 hover:text-ink"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <main>
          <Outlet />
        </main>
      </div>

      {/* ---------------- Mobile bottom tab bar ---------------- */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-ink/10 bg-surface/95 backdrop-blur md:hidden">
        {modules.map((m) => {
          const active = activeId === m.id;
          return (
            <Link
              key={m.id}
              to={m.basePath}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition-colors ${
                active ? "text-lavender-soft" : "text-ink/50"
              }`}
            >
              <span className="text-lg leading-none" aria-hidden="true">
                {m.icon}
              </span>
              <span>{m.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
