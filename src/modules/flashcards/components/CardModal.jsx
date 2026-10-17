import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createCard, updateCard } from "../lib/api";
import { sideText } from "../lib/format";
import { overlay, panel, fieldClass, labelClass } from "./modalMotion";

const MAX_TAG_LENGTH = 64;

// Keep any non-text blocks (image / audio / ink) the card already had, so
// editing the text does not silently drop attached media.
function otherBlocks(side) {
  return (side?.blocks ?? []).filter((b) => b && b.type !== "text");
}

function buildSide(text, original) {
  const blocks = [];
  if (text.trim()) blocks.push({ type: "text", text: text.trim() });
  for (const block of otherBlocks(original)) blocks.push(block);
  return { ...(original ?? {}), blocks };
}

function parseTags(value) {
  return [
    ...new Set(
      value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => t.slice(0, MAX_TAG_LENGTH))
    ),
  ];
}

// Create (omit `card`) or edit (pass `card`) a card's text and tags.
export default function CardModal({ open, card = null, categoryId, onClose, onSaved }) {
  const editing = Boolean(card);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setFront(card ? sideText(card.front) : "");
    setBack(card ? sideText(card.back) : "");
    setTags(card?.tags?.join(", ") ?? "");
    setSaving(false);
    setError(null);
  }, [open, card]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!front.trim()) {
      setError("The front of the card cannot be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        front: buildSide(front, card?.front),
        back: buildSide(back, card?.back),
        tags: parseTags(tags),
      };
      const saved = editing
        ? await updateCard(card.id, payload)
        : await createCard({ ...payload, category_id: Number(categoryId) });
      onSaved(saved);
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
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"
          variants={overlay}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <div className="absolute inset-0 bg-ink/50 backdrop-blur-sm" onClick={onClose} />

          <motion.div
            className="relative my-8 w-full max-w-2xl rounded-2xl border border-ink/10 bg-white p-6 shadow-card-hover"
            variants={panel}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <h2 className="text-xl font-semibold text-ink">
              {editing ? "Edit Card" : "Add Card"}
            </h2>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="card-front" className={labelClass}>
                  Front *
                </label>
                <textarea
                  id="card-front"
                  rows={3}
                  autoFocus
                  value={front}
                  onChange={(e) => setFront(e.target.value)}
                  className={fieldClass}
                  placeholder="Question, term or prompt"
                />
              </div>

              <div>
                <label htmlFor="card-back" className={labelClass}>
                  Back
                </label>
                <textarea
                  id="card-back"
                  rows={3}
                  value={back}
                  onChange={(e) => setBack(e.target.value)}
                  className={fieldClass}
                  placeholder="Answer or explanation"
                />
              </div>

              <div>
                <label htmlFor="card-tags" className={labelClass}>
                  Tags
                </label>
                <input
                  id="card-tags"
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className={fieldClass}
                  placeholder="Comma-separated, e.g. exam, chapter 3"
                />
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
                  disabled={saving || !front.trim()}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {saving ? "Saving..." : editing ? "Save" : "Add Card"}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
