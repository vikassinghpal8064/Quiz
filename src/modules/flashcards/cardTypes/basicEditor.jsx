import BlockStackEditor from "./BlockStackEditor";

// The "basic" card editor: a rich-text front and back, each a stack of blocks.
// When creating, it also offers the reverse-card option, which the descriptor's
// buildCards() turns into a linked "basic-reversed" row.
export default function BasicEditor({ draft, onChange, disabled = false, creating = false }) {
  function patch(next) {
    onChange?.({ ...draft, ...next });
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-1.5 text-sm font-semibold text-ink/70">Front</h3>
        <BlockStackEditor
          side={draft.front}
          onChange={(front) => patch({ front })}
          disabled={disabled}
          placeholder="Question, term or prompt"
        />
      </div>

      <div>
        <h3 className="mb-1.5 text-sm font-semibold text-ink/70">Back</h3>
        <BlockStackEditor
          side={draft.back}
          onChange={(back) => patch({ back })}
          disabled={disabled}
          placeholder="Answer or explanation"
        />
      </div>

      {creating && (
        <label className="flex items-start gap-2 rounded-xl border border-ink/10 bg-stone-50 px-3 py-2 text-sm text-ink/70">
          <input
            type="checkbox"
            checked={Boolean(draft.meta?.addReverse)}
            onChange={(e) => patch({ meta: { ...draft.meta, addReverse: e.target.checked } })}
            className="mt-0.5 h-4 w-4 rounded border-ink/25 accent-emerald-600"
          />
          <span>
            Also add the reverse card
            <span className="mt-0.5 block text-xs text-ink/45">
              Creates a second card with the back as the question, linked to this one.
            </span>
          </span>
        </label>
      )}
    </div>
  );
}
