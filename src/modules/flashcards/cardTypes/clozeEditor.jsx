import { clozeSegments, hasCloze } from "./clozeText";

// The "cloze" editor: a single plain-text area where the user wraps parts in
// {{c1::answer}}. The raw text (markers included) is stored on the front side.
export default function ClozeEditor({ draft, onChange, disabled = false }) {
  const text = draft?.front?.blocks?.[0]?.text ?? "";

  function setText(next) {
    // Keep any extra blocks the card already had after the first one.
    const rest = (draft.front?.blocks ?? []).slice(1);
    onChange?.({ ...draft, front: { blocks: [{ type: "text", text: next }, ...rest] } });
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1.5 text-sm font-semibold text-ink/70">Cloze text</h3>
        <textarea
          rows={9}
          disabled={disabled}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="The mitochondria is the {{c1::powerhouse}} of the cell."
          spellCheck
          className="field w-full px-3 py-2.5 text-sm leading-relaxed"
        />
        <p className="mt-1.5 text-xs text-ink/45">
          Wrap the parts to hide in double braces, e.g.{" "}
          <code className="rounded bg-stone-100 px-1">{"{{c1::answer}}"}</code>. Number each blank:{" "}
          <code className="rounded bg-stone-100 px-1">{"{{c2::…}}"}</code>.
        </p>
      </div>
    </div>
  );
}

export function ClozeViewer({ card, face }) {
  const text = card?.front?.blocks?.[0]?.text ?? "";
  if (!hasCloze(text)) {
    return <p className="whitespace-pre-wrap leading-relaxed text-ink">{text || "(empty)"}</p>;
  }
  const segments = clozeSegments(text, { reveal: face === "back" });
  return (
    <p className="whitespace-pre-wrap leading-relaxed text-ink">
      {segments.map((segment, i) => {
        if (segment.kind === "text") return <span key={i}>{segment.value}</span>;
        if (segment.kind === "blank") {
          return (
            <span
              key={i}
              className="mx-0.5 rounded bg-emerald-100 px-1.5 font-semibold text-emerald-800"
            >
              […]
            </span>
          );
        }
        return (
          <span
            key={i}
            className="mx-0.5 rounded bg-amber-100 px-1.5 font-semibold text-amber-800"
          >
            {segment.value}
          </span>
        );
      })}
    </p>
  );
}
