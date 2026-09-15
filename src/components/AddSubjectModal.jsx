import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const overlay = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const panel = {
  hidden: { opacity: 0, scale: 0.95, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.95, y: 10 },
};

const fieldClass =
  "mt-1 block w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

const labelClass = "block text-sm font-medium text-ink/70";

export default function AddSubjectModal({ open, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [iconName, setIconName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          icon_name: iconName.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to create subject");
      }

      const created = await res.json();
      setName("");
      setDescription("");
      setIconName("");
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
          <div
            className="absolute inset-0 bg-ink/50 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            className="relative w-full max-w-md rounded-2xl border border-ink/10 bg-white p-6 shadow-card-hover"
            variants={panel}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <h2 className="text-xl font-semibold text-ink">Add Subject</h2>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="subject-name" className={labelClass}>
                  Name *
                </label>
                <input
                  id="subject-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={fieldClass}
                  placeholder="e.g. Physics"
                />
              </div>

              <div>
                <label htmlFor="subject-desc" className={labelClass}>
                  Description
                </label>
                <textarea
                  id="subject-desc"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className={fieldClass}
                  placeholder="Optional description"
                />
              </div>

              <div>
                <label htmlFor="subject-icon" className={labelClass}>
                  Icon name
                </label>
                <input
                  id="subject-icon"
                  type="text"
                  value={iconName}
                  onChange={(e) => setIconName(e.target.value)}
                  className={fieldClass}
                  placeholder="e.g. physics, chemistry, math"
                />
                <p className="mt-1 text-xs text-ink/40">
                  Optional. Used to pick a default icon.
                </p>
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
                  disabled={saving}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Add Subject"}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}