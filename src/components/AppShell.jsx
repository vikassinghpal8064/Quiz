import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { modules, moduleForPath } from "../modules/registry";
import { useAuth } from "../lib/authContext";
import Icon from "./Icon";

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
// bottom tab bar on mobile, and one slim sticky top bar (breadcrumb on the
// left, theme/account controls on the right). It is a layout route, so pages
// render through <Outlet /> and keep their own markup untouched.
export default function AppShell() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

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

  return (
    <div className={`min-h-screen ${collapsed ? "shell-collapsed" : ""}`}>
      {/* ---------------- Desktop sidebar ---------------- */}
      <aside
        className={`fixed left-0 top-0 z-40 hidden h-screen flex-col border-r border-ink/10 bg-surface transition-[width] duration-200 md:flex ${
          collapsed ? "w-[60px]" : "w-[220px]"
        }`}
      >
        <div
          className={`flex h-12 shrink-0 items-center gap-2 border-b border-ink/10 ${
            collapsed ? "justify-center px-2" : "px-3"
          }`}
        >
          <BrandMark size="h-7 w-7 text-[10px]" />
          {!collapsed && (
            <span className="truncate font-display text-sm font-semibold tracking-tight text-ink">
              Study Deck
            </span>
          )}
        </div>

        {/* ONE nav list: each module, with the active module's own links
            nested underneath. No separate mode-switch row. */}
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {modules.map((m) => {
            const active = activeId === m.id;
            return (
              <div key={m.id} className="flex flex-col gap-0.5">
                <Link
                  to={m.basePath}
                  title={m.label}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                    collapsed ? "justify-center" : ""
                  } ${
                    active
                      ? "bg-lavender font-semibold text-on-accent"
                      : "font-medium text-ink/70 hover:bg-ink/5 hover:text-ink"
                  }`}
                >
                  <Icon name={m.icon} size={18} className="shrink-0" />
                  {!collapsed && <span className="truncate">{m.label}</span>}
                </Link>

                {!collapsed && active && m.links?.length > 0 && (
                  <div className="mb-1 ml-[1.15rem] flex flex-col gap-0.5 border-l border-ink/10 pl-2">
                    {m.links.map((l) => (
                      <Link
                        key={l.to}
                        to={l.to}
                        className="truncate rounded-md px-2 py-1.5 text-xs font-medium text-ink/55 transition-colors hover:bg-ink/5 hover:text-ink"
                      >
                        {l.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer row: the collapse control lives here. The help "?" trigger
            (rendered by ShortcutCheatsheet) sits in the same row on desktop. */}
        <div
          className={`flex shrink-0 items-center border-t border-ink/10 py-2 ${
            collapsed ? "justify-center px-2" : "justify-end px-3"
          }`}
        >
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="grid h-7 w-7 place-items-center rounded-md text-xs font-semibold text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <Icon name={collapsed ? "chevrons-right" : "chevrons-left"} size={16} />
          </button>
        </div>
      </aside>

      {/* ---------------- Content ---------------- */}
      <div
        className={`${
          collapsed ? "md:pl-[60px]" : "md:pl-[220px]"
        } pb-24 transition-[padding] duration-200 md:pb-0`}
      >
        {/* Sticky top bar, all widths. Content scrolls underneath it, so it
            never covers a page. Right padding keeps the breadcrumb clear of the
            fixed theme/account buttons (which overlay the bar's right end). */}
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-ink/10 bg-cream/90 px-3 pr-[7.5rem] backdrop-blur md:pr-32">
          <nav className="flex min-w-0 items-center gap-1.5 text-sm" aria-label="Breadcrumb">
            <Link
              to="/"
              className="shrink-0 font-display font-semibold tracking-tight text-ink"
            >
              Study Deck
            </Link>
            {activeModule && activeModule.basePath !== "/" && (
              <>
                <span className="text-ink/30" aria-hidden="true">
                  /
                </span>
                <Link
                  to={activeModule.basePath}
                  className="truncate font-medium text-ink/55 transition-colors hover:text-ink"
                >
                  {activeModule.label}
                </Link>
              </>
            )}
          </nav>
        </header>

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
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
                active ? "text-lavender-soft" : "text-ink/50"
              }`}
            >
              <span className="text-base leading-none" aria-hidden="true">
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
