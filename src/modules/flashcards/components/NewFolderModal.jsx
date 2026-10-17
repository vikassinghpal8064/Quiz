import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createFolder } from "../lib/api";
import { FOLDER_COLORS, FOLDER_ICONS, DEFAULT_FOLDER_COLOR, DEFAULT_FOLDER_ICON } from "../lib/format";
import { overlay, panel, fieldClass, labelClass } from "./modalMotion";

// "New Folder" dialog: name, colour and icon. Colour is stored as a token key
// (see lib/format.js) so the card keeps a known background/foreground pair.
export default function NewFolderModal({ open, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_FOLDER_COLOR);
  const [icon, setIcon] = useState(DEFAULT_FOLDER_ICON);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setName("");
      setColor(DEFAULT_FOLDER_COLOR);
      setIcon(DEFAULT_FOLDER_ICON);
      setSaving(false);
      setError(null);
    }
  }, [open]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createFolder({ name: name.trim(), color, icon });
      onCreated(created);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          variants={overlay}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <div className="absolute inset-0 bg-ink/50 backdrop-blur-sm" onClick={onClose} />

          <motion.div
            className="relative w-full max-w-2xl rounded-2xl border border-ink/10 bg-white p-6 shadow-card-hover"
            variants={panel}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <h2 className="text-xl font-semibold text-ink">New Folder</h2>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="folder-name" className={labelClass}>
                  Name *
                </label>
                <input
                  id="folder-name"
                  type="text"
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={fieldClass}
                  placeholder="e.g. Biology"
                />
              </div>

              <div>
                <span className={labelClass}>Colour</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {FOLDER_COLORS.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setColor(c.key)}
                      aria-label={c.label}
                      aria-pressed={color === c.key}
                      title={c.label}
                      className={`h-9 w-9 rounded-full transition-transform ${
                        color === c.key
                          ? "ring-2 ring-offset-2 ring-offset-white ring-ink/40"
                          : "hover:scale-105"
                      }`}
                      style={{ backgroundColor: c.swatch }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <span className={labelClass}>Icon</span>
                <div className="mt-2 grid grid-cols-8 gap-1.5">
                  {FOLDER_ICONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setIcon(emoji)}
                      aria-label={`Icon ${emoji}`}
                      aria-pressed={icon === emoji}
                      className={`grid h-9 place-items-center rounded-lg text-lg transition-colors ${
                        icon === emoji
                          ? "bg-emerald-50 ring-1 ring-emerald-500"
                          : "hover:bg-stone-100"
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-ink/60 transition-colors hover:bg-stone-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !name.trim()}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {saving ? "Creating..." : "Create Folder"}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
