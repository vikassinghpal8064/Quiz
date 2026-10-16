import { useState } from "react";

// Tag editor with autocomplete. Mirrors the API's limits (validateTags in
// api/_lib/flashCards.js): at most 50 tags, each at most 64 characters.
const MAX_TAGS = 50;
const MAX_TAG_LENGTH = 64;

export default function TagInput({
  value = [],
  onChange,
  suggestions = [],
  disabled = false,
  id = "card-tags",
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);

  const query = text.trim().toLowerCase();
  const matches = query
    ? suggestions
        .filter((tag) => !value.includes(tag) && tag.toLowerCase().includes(query))
        .slice(0, 8)
    : [];

  function addTag(raw) {
    const tag = String(raw ?? "").trim().slice(0, MAX_TAG_LENGTH);
    setText("");
    if (!tag || value.includes(tag) || value.length >= MAX_TAGS) return;
    onChange([...value, tag]);
  }

  function removeTag(tag) {
    onChange(value.filter((t) => t !== tag));
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(text);
    } else if (e.key === "Backspace" && !text && value.length) {
      removeTag(value[value.length - 1]);
    }
  }

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-ink/15 bg-white px-2 py-1.5 focus-within:border-emerald-500">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800"
          >
            #{tag}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeTag(tag)}
                aria-label={`Remove tag ${tag}`}
                className="text-sky-700 transition hover:text-sky-900"
              >
                ×
              </button>
            )}
          </span>
        ))}
        <input
          id={id}
          type="text"
          value={text}
          disabled={disabled || value.length >= MAX_TAGS}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={handleKeyDown}
          placeholder={value.length ? "" : "Add tags…"}
          autoComplete="off"
          className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-ink/35 disabled:opacity-50"
        />
      </div>

      {open && matches.length > 0 && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-ink/10 bg-white py-1 shadow-card-hover">
          {matches.map((tag) => (
            <button
              key={tag}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                addTag(tag);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink transition hover:bg-stone-100"
            >
              <span className="text-ink/40">#</span>
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
