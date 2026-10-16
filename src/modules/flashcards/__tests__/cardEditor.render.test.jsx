import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import CardEditorModal from "../components/CardEditorModal";

// The editor is a client component (Tiptap), but it must still server-render
// cleanly: the editor area falls back to a placeholder until the browser mounts
// the real editor, and the shell (title, preview, actions) is plain markup.
describe("CardEditorModal", () => {
  it("server-renders the full-screen add editor", () => {
    const html = renderToString(
      <CardEditorModal open categoryId={1} onClose={() => {}} onSaved={() => {}} />
    );
    expect(html).toContain("Add Card");
    expect(html).toContain("Live preview");
    expect(html).toContain("Save &amp; add another");
    expect(html).toContain("Add block");
    expect(html).toContain("Ctrl + Enter");
  });

  it("offers both selectable card types for a new card", () => {
    const html = renderToString(
      <CardEditorModal open categoryId={1} onClose={() => {}} onSaved={() => {}} />
    );
    expect(html).toContain("Basic");
    expect(html).toContain("Cloze");
  });

  it("renders nothing while closed", () => {
    const html = renderToString(
      <CardEditorModal open={false} categoryId={1} onClose={() => {}} onSaved={() => {}} />
    );
    expect(html).toBe("");
  });
});
