import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";

// The editor feature set: bold / italic / strike / code / headings / lists /
// blockquote / code block (StarterKit), a highlighter mark, and inline + block
// LaTeX rendered with KaTeX.
//
// A fresh list is built per editor instance because Tiptap configures the
// extension objects in place - sharing them between two mounted editors is not
// safe.
export function buildExtensions() {
  return [
    StarterKit,
    Highlight,
    InlineMath.configure({ katexOptions: { throwOnError: false } }),
    BlockMath.configure({ katexOptions: { throwOnError: false } }),
  ];
}
