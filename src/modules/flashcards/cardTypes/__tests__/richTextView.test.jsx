import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import RichTextView from "../RichTextView";

// The viewer is a plain function component, so it can be rendered to a string
// with no DOM. This exercises the whole node/mark switch, including the KaTeX
// path (katex.renderToString runs fine outside a browser).
describe("RichTextView", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Energy " },
          { type: "text", text: "matters", marks: [{ type: "bold" }] },
          { type: "text", text: " and " },
          { type: "text", text: "highlighted", marks: [{ type: "highlight" }] },
          { type: "text", text: " as " },
          { type: "inlineMath", attrs: { latex: "E=mc^2" } },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }],
          },
        ],
      },
    ],
  };

  it("renders text, marks, lists and maths", () => {
    const html = renderToString(<RichTextView doc={doc} />);
    expect(html).toContain("<strong");
    expect(html).toContain("<mark");
    expect(html).toContain("<ul");
    expect(html).toContain("first");
    // KaTeX wraps its output in a span with class "katex".
    expect(html).toContain("katex");
  });

  it("renders nothing for an empty document", () => {
    expect(renderToString(<RichTextView doc={{ type: "doc", content: [] }} />)).toBe("");
    expect(renderToString(<RichTextView doc={null} />)).toBe("");
  });
});
