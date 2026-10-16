import katex from "katex";
// The stylesheet is imported once, here: every path that can show math (the
// editor's live preview and the read-only viewer) renders through this module,
// so the KaTeX CSS is guaranteed to be present whenever math is on screen.
import "katex/dist/katex.min.css";

// A dependency-light renderer for the Tiptap JSON we store in block.doc.
//
// It is a plain function component with no hooks (so it is SSR-safe and cheap to
// mount in a list) and it only supports the node / mark set the editor enables.
// Math is rendered with KaTeX; katex.renderToString returns trusted markup, so
// the one dangerouslySetInnerHTML in the module is fed by KaTeX, not by content.
function mathHtml(latex, displayMode) {
  try {
    return katex.renderToString(String(latex ?? ""), { throwOnError: false, displayMode });
  } catch {
    return null;
  }
}

function Math({ latex, display = false }) {
  const html = mathHtml(latex, display);
  const className = display ? "fc-math-block my-2 block text-center" : "fc-math mx-0.5 inline-block";
  if (!html) return <span className={className}>{String(latex ?? "")}</span>;
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

function applyMark(children, mark) {
  switch (mark?.type) {
    case "bold":
      return <strong className="font-semibold">{children}</strong>;
    case "italic":
      return <em>{children}</em>;
    case "strike":
      return <s>{children}</s>;
    case "code":
      return <code className="rounded bg-stone-100 px-1 py-0.5 text-[0.85em]">{children}</code>;
    case "underline":
      return <u>{children}</u>;
    case "highlight":
      return <mark className="rounded bg-yellow-200 px-0.5">{children}</mark>;
    case "link":
      return (
        <a
          href={mark.attrs?.href}
          target="_blank"
          rel="noreferrer"
          className="text-emerald-700 underline"
        >
          {children}
        </a>
      );
    default:
      return children;
  }
}

function children(nodes, prefix) {
  return (nodes ?? []).map((node, i) => <Node key={`${prefix}-${i}`} node={node} />);
}

function Node({ node }) {
  if (!node || typeof node !== "object") return null;
  switch (node.type) {
    case "text": {
      let content = node.text ?? "";
      for (const mark of node.marks ?? []) content = applyMark(content, mark);
      return <>{content}</>;
    }
    case "hardBreak":
      return <br />;
    case "inlineMath":
      return <Math latex={node.attrs?.latex} />;
    case "blockMath":
      return <Math latex={node.attrs?.latex} display />;
    case "paragraph":
      return <p className="my-1 leading-relaxed">{children(node.content, "p")}</p>;
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 2, 1), 6);
      const Tag = `h${level}`;
      return <Tag className="my-1 font-semibold">{children(node.content, "h")}</Tag>;
    }
    case "bulletList":
      return <ul className="my-1 list-disc pl-5">{children(node.content, "ul")}</ul>;
    case "orderedList":
      return <ol className="my-1 list-decimal pl-5">{children(node.content, "ol")}</ol>;
    case "listItem":
      return <li>{children(node.content, "li")}</li>;
    case "blockquote":
      return (
        <blockquote className="my-1 border-l-2 border-ink/20 pl-3 italic">
          {children(node.content, "bq")}
        </blockquote>
      );
    case "codeBlock":
      return (
        <pre className="my-1 overflow-x-auto rounded-lg bg-stone-100 p-2 text-xs">
          <code>{children(node.content, "cb")}</code>
        </pre>
      );
    case "horizontalRule":
      return <hr className="my-2 border-ink/10" />;
    default:
      return <>{children(node.content, "x")}</>;
  }
}

export default function RichTextView({ doc, className = "" }) {
  if (!doc || typeof doc !== "object") return null;
  const content = Array.isArray(doc.content) ? doc.content : [];
  if (!content.length) return null;
  return (
    <div className={`fc-rich leading-relaxed ${className}`.trim()}>
      {content.map((node, i) => (
        <Node key={`doc-${i}`} node={node} />
      ))}
    </div>
  );
}
