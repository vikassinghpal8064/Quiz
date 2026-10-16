import { useState } from "react";
import RichTextEditor from "./RichTextEditor";
import ImageBlockEditor from "./ImageBlockEditor";
import AudioBlockEditor from "./AudioBlockEditor";
import InkBlockEditor from "./InkBlockEditor";
import { audioBlock, imageBlock, inkBlock, textBlock } from "./blocks";

// The blocks the "Add block" menu can create.
const ADD_OPTIONS = [
  { type: "text", label: "Text", icon: "📝" },
  { type: "image", label: "Image", icon: "🖼️" },
  { type: "audio", label: "Audio", icon: "🔊" },
  { type: "ink", label: "Handwriting", icon: "✍️" },
];

function AddBlockMenu({ open, onToggle, onClose, onAdd }) {
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={onToggle}
        className="rounded-lg border border-dashed border-ink/25 bg-white px-3 py-1.5 text-xs font-semibold text-ink/60 transition hover:bg-stone-100"
      >
        + Add block
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={onClose} aria-hidden="true" />
          <div className="absolute left-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-ink/10 bg-white py-1 shadow-card-hover">
            {ADD_OPTIONS.map((option) => (
              <button
                key={option.type}
                type="button"
                onClick={() => onAdd(option.type)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-stone-100"
              >
                {option.icon} {option.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Edits one card side: a vertical stack of blocks. Text blocks are rich text;
// image and audio blocks embed their own uploader (pick / camera / paste, or
// record / upload). The block list is owned by the parent (the card-type
// editor), so this component is fully controlled.
export default function BlockStackEditor({ side, onChange, disabled = false, placeholder = "Write…" }) {
  const blocks = Array.isArray(side?.blocks) ? side.blocks : [];
  const [menuOpen, setMenuOpen] = useState(false);

  function setBlocks(next) {
    onChange?.({ ...side, blocks: next });
  }

  function updateText(index, doc, text) {
    setBlocks(blocks.map((block, i) => (i === index ? { ...block, doc, text } : block)));
  }

  function updateMedia(index, patch) {
    setBlocks(blocks.map((block, i) => (i === index ? { ...block, ...patch } : block)));
  }

  function removeBlock(index) {
    setBlocks(blocks.filter((_, i) => i !== index));
  }

  function addBlock(type) {
    if (type === "text") setBlocks([...blocks, textBlock("", null)]);
    else if (type === "image") setBlocks([...blocks, imageBlock()]);
    else if (type === "audio") setBlocks([...blocks, audioBlock()]);
    else if (type === "ink") setBlocks([...blocks, inkBlock()]);
    setMenuOpen(false);
  }

  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        const key = block?._key ?? `idx_${index}`;

        if (block && block.type === "text") {
          return (
            <div key={key} className="relative">
              <RichTextEditor
                value={block.doc ?? block.text ?? ""}
                onChange={(doc, text) => updateText(index, doc, text)}
                disabled={disabled}
                placeholder={placeholder}
                ariaLabel={`${placeholder} text`}
              />
              {blocks.length > 1 && !disabled && (
                <button
                  type="button"
                  onClick={() => removeBlock(index)}
                  title="Remove block"
                  aria-label="Remove block"
                  className="absolute -right-2 -top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-ink/15 bg-white text-xs text-ink/50 shadow-sm transition hover:bg-red-50 hover:text-red-600"
                >
                  ✕
                </button>
              )}
            </div>
          );
        }

        if (block && block.type === "image") {
          return (
            <ImageBlockEditor
              key={key}
              block={block}
              onChange={(patch) => updateMedia(index, patch ?? {})}
              onRemove={() => removeBlock(index)}
              disabled={disabled}
            />
          );
        }

        if (block && block.type === "audio") {
          return (
            <AudioBlockEditor
              key={key}
              block={block}
              onChange={(patch) => updateMedia(index, patch ?? {})}
              onRemove={() => removeBlock(index)}
              disabled={disabled}
            />
          );
        }

        if (block && block.type === "ink") {
          return (
            <InkBlockEditor
              key={key}
              block={block}
              onChange={(patch) => updateMedia(index, patch ?? {})}
              onRemove={() => removeBlock(index)}
              disabled={disabled}
            />
          );
        }

        // Unknown block types are stored but not editable; show a small stub so
        // nothing silently disappears from the stack.
        return (
          <div
            key={key}
            className="flex items-center justify-between rounded-xl border border-dashed border-ink/20 bg-stone-50 px-3 py-2 text-sm text-ink/55"
          >
            <span>Block</span>
            {!disabled && (
              <button
                type="button"
                onClick={() => removeBlock(index)}
                className="text-xs font-semibold text-ink/45 transition hover:text-red-600"
              >
                Remove
              </button>
            )}
          </div>
        );
      })}

      {!disabled && (
        <AddBlockMenu
          open={menuOpen}
          onToggle={() => setMenuOpen((open) => !open)}
          onClose={() => setMenuOpen(false)}
          onAdd={addBlock}
        />
      )}
    </div>
  );
}
