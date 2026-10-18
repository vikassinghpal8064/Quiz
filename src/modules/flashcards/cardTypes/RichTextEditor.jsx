import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { buildExtensions } from "./extensions";
import Icon from "../../../components/Icon";

// Content area styling. Tiptap tags the editable element with both "tiptap" and
// "ProseMirror"; these arbitrary variants style that subtree without adding new
// global CSS.
const CONTENT_CLASS = [
  "[&_.tiptap]:min-h-[4rem]",
  "[&_.tiptap]:px-3",
  "[&_.tiptap]:py-2",
  "[&_.tiptap]:text-sm",
  "[&_.tiptap]:leading-relaxed",
  "[&_.tiptap]:outline-none",
  "[&_.tiptap_p]:my-1",
  "[&_.tiptap_ul]:my-1 [&_.tiptap_ul]:list-disc [&_.tiptap_ul]:pl-5",
  "[&_.tiptap_ol]:my-1 [&_.tiptap_ol]:list-decimal [&_.tiptap_ol]:pl-5",
  "[&_.tiptap_blockquote]:my-1 [&_.tiptap_blockquote]:border-l-2 [&_.tiptap_blockquote]:border-ink/20 [&_.tiptap_blockquote]:pl-3",
  "[&_.tiptap_mark]:rounded [&_.tiptap_mark]:bg-yellow-200 [&_.tiptap_mark]:px-0.5",
  "[&_.tiptap_strong]:font-semibold",
  "[&_.tiptap_em]:italic",
  "[&_.tiptap_code]:rounded [&_.tiptap_code]:bg-stone-100 [&_.tiptap_code]:px-1",
].join(" ");

const TOOLBAR_BTN =
  "rounded-md px-2 py-1 text-sm font-medium text-ink/65 transition hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-40";
const TOOLBAR_ACTIVE = "bg-ink/10 text-ink";

function ToolButton({ active = false, onClick, title, disabled = false, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      className={`${TOOLBAR_BTN} ${active ? TOOLBAR_ACTIVE : ""}`}
    >
      {children}
    </button>
  );
}

// A small, self-contained rich-text field used for one text block. It keeps its
// own Tiptap instance; the parent remounts it (via a React key) whenever a card
// is reset, so the initial `value` is only read once.
//
// onChange receives BOTH the rich JSON and the plain text: the caller stores
// them as block.doc and block.text respectively.
export default function RichTextEditor({
  value,
  onChange,
  disabled = false,
  placeholder = "Write something…",
  ariaLabel = "Rich text",
}) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const extensions = useMemo(() => buildExtensions(), []);
  const editor = useEditor({
    extensions,
    content: value ?? "",
    editable: !disabled,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: "tiptap fc-editor-content", "aria-label": ariaLabel },
    },
    onUpdate: ({ editor: instance }) => {
      onChangeRef.current?.(instance.getJSON(), instance.getText());
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  if (!editor) {
    // immediatelyRender:false means there is no editor on the very first paint
    // (and none at all during SSR). Show the placeholder until it exists.
    return (
      <div className="rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm text-ink/35">
        {placeholder}
      </div>
    );
  }

  const isEmpty = editor.isEmpty;

  return (
    <div className="overflow-hidden rounded-xl border border-ink/15 bg-white focus-within:border-emerald-500">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-ink/10 bg-stone-50 px-1.5 py-1">
        <ToolButton
          title="Bold"
          active={editor.isActive("bold")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </ToolButton>
        <ToolButton
          title="Italic"
          active={editor.isActive("italic")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </ToolButton>
        <ToolButton
          title="Highlight"
          active={editor.isActive("highlight")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
        >
          <Icon name="highlighter" size={15} />
        </ToolButton>
        <span className="mx-0.5 h-4 w-px bg-ink/10" aria-hidden="true" />
        <ToolButton
          title="Bullet list"
          active={editor.isActive("bulletList")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <Icon name="list" size={15} />
        </ToolButton>
        <ToolButton
          title="Numbered list"
          active={editor.isActive("orderedList")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1.
        </ToolButton>
        <ToolButton
          title="Heading"
          active={editor.isActive("heading", { level: 2 })}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H
        </ToolButton>
        <span className="mx-0.5 h-4 w-px bg-ink/10" aria-hidden="true" />
        <ToolButton
          title="Inline math (or type $x^2$)"
          disabled={disabled}
          onClick={() => {
            const latex = window.prompt("LaTeX, e.g. \\frac{a}{b}");
            if (latex) editor.chain().focus().insertInlineMath({ latex }).run();
          }}
        >
          ∑
        </ToolButton>
        <div className="ml-auto flex items-center gap-0.5">
          <ToolButton
            title="Undo"
            disabled={disabled || !editor.can().undo()}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Icon name="undo" size={15} />
          </ToolButton>
          <ToolButton
            title="Redo"
            disabled={disabled || !editor.can().redo()}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Icon name="redo" size={15} />
          </ToolButton>
        </div>
      </div>

      <div className={`relative ${CONTENT_CLASS}`}>
        {isEmpty && (
          <span className="pointer-events-none absolute left-3 top-2 text-sm text-ink/35">
            {placeholder}
          </span>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
