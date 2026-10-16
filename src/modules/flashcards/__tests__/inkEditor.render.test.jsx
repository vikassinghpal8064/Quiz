import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import InkBlockEditor from "../cardTypes/InkBlockEditor";
import InkViewer from "../cardTypes/InkViewer";
import SideViewer from "../cardTypes/SideViewer";
import { inkBlock } from "../cardTypes/blocks";

// The handwriting editor is canvas-heavy, but every browser API is only touched
// inside effects or pointer handlers, so it must server-render cleanly. Effects
// do not run under renderToString, which exercises the idle toolbar markup.
const stroke = { id: "s1", tool: "pen", color: "#111827", width: 4, points: [{ x: 1, y: 2, p: 0.5 }] };
const drawn = inkBlock({ strokes: [stroke] });
const previewed = inkBlock({ strokes: [stroke], preview: { url: "https://blob.example/x.png" } });

describe("ink block editor", () => {
  it("renders the toolbar for an empty block", () => {
    const html = renderToString(
      <InkBlockEditor block={inkBlock()} onChange={() => {}} onRemove={() => {}} />
    );
    expect(html).toContain("Handwriting");
    expect(html).toContain("0 strokes");
    expect(html).toContain("Background");
    // Three stacked canvases: background, ink, overlay.
    expect((html.match(/<canvas/g) ?? []).length).toBe(3);
  });

  it("shows the stroke count and a remove control", () => {
    const html = renderToString(
      <InkBlockEditor block={drawn} onChange={() => {}} onRemove={() => {}} />
    );
    expect(html).toContain("1 stroke");
    expect(html).toContain("Remove");
  });
});

describe("ink viewer", () => {
  it("prefers the PNG preview when one exists", () => {
    const html = renderToString(<InkViewer block={previewed} />);
    expect(html).toContain("<img");
    expect(html).toContain("blob.example/x.png");
  });

  it("falls back to a canvas when only strokes exist", () => {
    const html = renderToString(<InkViewer block={drawn} />);
    expect(html).toContain("<canvas");
    expect(html).toContain("Handwriting");
  });

  it("renders nothing for an empty block", () => {
    const html = renderToString(<InkViewer block={inkBlock()} />);
    expect(html).toBe("");
  });

  it("renders inside a card side", () => {
    const html = renderToString(<SideViewer side={{ blocks: [previewed] }} />);
    expect(html).toContain("blob.example/x.png");
  });
});
