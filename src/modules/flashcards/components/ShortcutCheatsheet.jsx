import { useEffect, useState } from "react";
import Icon from "../../../components/Icon.jsx";
import { AnimatePresence, motion } from "framer-motion";
import { overlay, panel } from "./modalMotion";

// Keyboard-shortcut cheat sheet, opened with "?" (or the floating button) from
// anywhere in the flash module. The list mirrors the real bindings: the study
// screen's reveal / rate / undo keys and the swipe gesture.
const GROUPS = [
  {
    title: "General",
    items: [
      { keys: ["?"], label: "Show or hide this cheat sheet" },
      { keys: ["Esc"], label: "Close a dialog" },
    ],
  },
  {
    title: "Studying",
    items: [
      { keys: ["Space", "Enter"], label: "Reveal the answer" },
      { keys: ["1"], label: "Again — bring it back soon" },
      { keys: ["2"], label: "Hard" },
      { keys: ["3"], label: "Good" },
      { keys: ["4"], label: "Easy" },
      { keys: ["U"], label: "Undo the last answer" },
    ],
  },
  {
    title: "Touch / stylus",
    items: [
      { keys: ["←"], label: "Swipe left — Again" },
      { keys: ["→"], label: "Swipe right — Good" },
      { keys: ["↑"], label: "Swipe up — Easy" },
      { keys: ["↓"], label: "Swipe down — Hard" },
    ],
  },
];

export default function ShortcutCheatsheet() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(event) {
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || event.target?.isContentEditable) return;
      if (event.key === "?") {
        event.preventDefault();
        setOpen((prev) => !prev);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        id="cheatsheet-trigger"
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        className="fixed bottom-20 right-5 z-40 grid h-8 w-8 place-items-center rounded-lg border border-line bg-elevated/95 text-sm font-semibold text-ink/60 backdrop-blur transition hover:bg-ink/5 hover:text-ink md:bottom-3 md:left-3 md:right-auto"
      >
        ?
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            variants={overlay}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />

            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Keyboard shortcuts"
              className="card relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden p-0"
              variants={panel}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-ink/10 px-6 py-4">
                <h2 className="text-lg font-semibold text-ink">Keyboard shortcuts</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="grid h-8 w-8 place-items-center rounded-md text-ink/50 transition hover:bg-ink/5 hover:text-ink"
                >
                  <Icon name="x" size={18} />
                </button>
              </div>

              <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
                {GROUPS.map((group) => (
                  <section key={group.title}>
                    <h3 className="label-caps mb-2">{group.title}</h3>
                    <ul className="space-y-2">
                      {group.items.map((item) => (
                        <li key={item.label} className="flex items-center justify-between gap-4 text-sm">
                          <span className="text-ink/70">{item.label}</span>
                          <span className="flex shrink-0 items-center gap-1">
                            {item.keys.map((k) => (
                              <kbd
                                key={k}
                                className="rounded-md border border-line bg-elevated px-2 py-1 text-xs font-semibold text-ink/80"
                              >
                                {k}
                              </kbd>
                            ))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
