import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/authContext";

// Logout lives in a right-hand drawer instead of a floating pill. A small
// corner button (styled by #account-toggle in index.css) sits directly to the
// left of the dark-mode button and slides the panel in from the right.
export default function AccountSidebar() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const toggleRef = useRef(null);
  const panelRef = useRef(null);

  // Every hook runs before the unauthenticated early return below, so the
  // hook order stays stable across renders.
  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(e) {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Stop the page scrolling behind the panel.
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Move focus into the panel so keyboard and screen-reader users land there.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!user) return null;

  function close() {
    setOpen(false);
    toggleRef.current?.focus();
  }

  async function handleLogout() {
    setBusy(true);
    try {
      await logout();
      setOpen(false);
      navigate("/login", { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={toggleRef}
        id="account-toggle"
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        aria-controls="account-sidebar"
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="account-backdrop"
            className="fixed inset-0 z-[105] bg-ink/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            onClick={close}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div
            key="account-panel"
            id="account-sidebar"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Account"
            tabIndex={-1}
            className="fixed right-0 top-0 z-[110] flex h-full w-80 max-w-[85vw] flex-col border-l border-ink/10 bg-white shadow-card outline-none"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { type: "tween", duration: 0.25, ease: "easeOut" }
            }
          >
            <div className="flex items-start justify-between gap-3 border-b border-ink/10 p-6">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
                  Signed in as
                </p>
                <p className="mt-1 truncate text-lg font-semibold text-ink">
                  {user.username}
                </p>
                {isAdmin && (
                  <span className="mt-2 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
                    Admin
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close account menu"
                className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-sm font-semibold text-ink/70 transition hover:bg-ink/10"
              >
                ✕
              </button>
            </div>

            {/* Spacer keeps the logout block pinned to the bottom. */}
            <div className="flex-1" />

            <div className="border-t border-ink/10 p-6">
              <button
                type="button"
                onClick={handleLogout}
                disabled={busy}
                className="w-full rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink/90 disabled:opacity-50"
              >
                {busy ? "Logging out…" : "Logout"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
