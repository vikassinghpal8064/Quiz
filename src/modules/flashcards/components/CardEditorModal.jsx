import { useState } from "react";
import Icon from "../../../components/Icon";
import { AnimatePresence, motion } from "framer-motion";
import { createCard, updateCard } from "../lib/api";
import { SELECTABLE_CARD_TYPES, getCardType } from "../cardTypes/registry";
import TagInput from "./TagInput";
import { overlay, panel } from "./modalMotion";

function PreviewPanel({ label, Viewer, card, face }) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-stone-50 p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/40">{label}</div>
      <div className="min-h-[3rem] text-sm">
        <Viewer card={card} face={face} />
      </div>
    </div>
  );
}

// The full-screen card editor. It hosts whichever card type is selected and
// owns everything the type does not: the live preview, tags, saving and the
// keyboard shortcut. "Add another" resets the type editor by remounting it.
export default function CardEditorModal({
  open,
  card = null,
  categoryId,
  tagSuggestions = [],
  onClose,
  onSaved,
}) {
  const editing = Boolean(card);

  // Seeded synchronously so the form is present on the very first render - which
  // also makes the editor server-renderable. The caller remounts the modal (via
  // a React key) when it targets a different card, so no hydration effect runs.
  const [typeId, setTypeId] = useState(() => getCardType(card?.card_type).id);
  const [draft, setDraft] = useState(() => {
    const type = getCardType(card?.card_type);
    return card ? type.fromCard(card) : type.createDraft();
  });
  const [tags, setTags] = useState(() => (Array.isArray(card?.tags) ? card.tags : []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [resetToken, setResetToken] = useState(0);

  const type = getCardType(typeId);

  function chooseType(nextId) {
    if (editing || nextId === typeId) return;
    setTypeId(nextId);
    setDraft(getCardType(nextId).createDraft());
    setError(null);
  }

  async function save({ addAnother = false } = {}) {
    if (!draft || saving) return;

    const validationError = type.validate(draft);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payloads = type.buildCards(draft, { creating: !editing });

      if (editing) {
        const [primary] = payloads;
        await updateCard(card.id, {
          front: primary.front,
          back: primary.back,
          tags,
          card_type: primary.card_type,
        });
      } else {
        let previousId = null;
        for (const payload of payloads) {
          const body = {
            category_id: Number(categoryId),
            front: payload.front,
            back: payload.back,
            tags,
            card_type: payload.card_type,
          };
          // The reversed twin links back to the card it was generated from.
          if (payload.linkToPrevious && previousId != null) {
            body.source_ref = String(previousId);
          }
          const created = await createCard(body);
          previousId = created?.id ?? previousId;
        }
      }

      onSaved?.();

      if (addAnother && !editing) {
        setDraft(getCardType(typeId).createDraft());
        setTags([]);
        setError(null);
        setResetToken((n) => n + 1);
      } else {
        onClose?.();
      }
    } catch (err) {
      setError(err?.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      save({ addAnother: false });
    }
  }

  const previewCard = draft ? { card_type: typeId, front: draft.front, back: draft.back } : null;

  return (
    <AnimatePresence>
      {open && draft && (
        <motion.div
          className="fixed inset-0 z-50 flex justify-center overflow-hidden sm:p-6"
          variants={overlay}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <div className="absolute inset-0 bg-ink/50 backdrop-blur-sm" onClick={onClose} />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={editing ? "Edit card" : "Add card"}
            onKeyDown={handleKeyDown}
            className="relative flex h-full w-full max-w-4xl flex-col overflow-hidden border border-ink/10 bg-white shadow-card-hover sm:h-[calc(100vh-3rem)] sm:rounded-2xl"
            variants={panel}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* header */}
            <div className="flex items-center justify-between gap-3 border-b border-ink/10 px-5 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-semibold text-ink">
                  {editing ? "Edit Card" : "Add Card"}
                </h2>
                {!editing && (
                  <div className="flex rounded-lg border border-ink/15 bg-stone-50 p-0.5">
                    {SELECTABLE_CARD_TYPES.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => chooseType(option.id)}
                        aria-pressed={typeId === option.id}
                        className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                          typeId === option.id
                            ? "bg-white text-ink shadow-sm"
                            : "text-ink/55 hover:text-ink"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close editor"
                className="icon-circle text-lg hover:bg-ink/5"
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            {/* body */}
            <div className="grid flex-1 gap-6 overflow-y-auto p-5 lg:grid-cols-2">
              <div key={resetToken} className="space-y-5">
                <type.Editor
                  draft={draft}
                  onChange={setDraft}
                  disabled={saving}
                  creating={!editing}
                />
                <div>
                  <label
                    htmlFor="card-tags"
                    className="mb-1.5 block text-sm font-semibold text-ink/70"
                  >
                    Tags
                  </label>
                  <TagInput
                    id="card-tags"
                    value={tags}
                    onChange={setTags}
                    suggestions={tagSuggestions}
                    disabled={saving}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-ink/70">Live preview</h3>
                <PreviewPanel label="Front" Viewer={type.Viewer} card={previewCard} face="front" />
                <PreviewPanel label="Back" Viewer={type.Viewer} card={previewCard} face="back" />
              </div>
            </div>

            {/* footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 px-5 py-3">
              <p className="min-w-0 text-sm text-red-600">{error}</p>
              <div className="flex items-center gap-2">
                <span className="hidden text-xs text-ink/40 sm:inline">⌘/Ctrl + Enter to save</span>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-ink/60 transition-colors hover:bg-stone-100"
                >
                  Cancel
                </button>
                {!editing && (
                  <button
                    type="button"
                    onClick={() => save({ addAnother: true })}
                    disabled={saving}
                    className="rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-semibold text-ink/75 transition hover:bg-stone-100 disabled:opacity-50"
                  >
                    Save &amp; add another
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => save({ addAnother: false })}
                  disabled={saving}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {saving ? "Saving…" : editing ? "Save" : "Add Card"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
