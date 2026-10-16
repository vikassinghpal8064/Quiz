import { describe, it, expect } from "vitest";
import {
  deriveTextFromDoc,
  isSideEmpty,
  normalizeSide,
  sidePlainText,
  textBlock,
  toPayloadSide,
} from "../blocks";

// A tiny Tiptap document: an intro paragraph (with a bold word + inline math)
// and a bullet list.
const doc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Energy is " },
        { type: "text", text: "released", marks: [{ type: "bold" }] },
        { type: "text", text: " by " },
        { type: "inlineMath", attrs: { latex: "E=mc^2" } },
      ],
    },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] },
      ],
    },
  ],
};

describe("blocks", () => {
  it("flattens a rich document to plain text", () => {
    const text = deriveTextFromDoc(doc);
    expect(text).toContain("Energy is released by $E=mc^2$");
    expect(text).toContain("one");
    expect(text).toContain("two");
  });

  it("drops empty text blocks and transient keys when building a payload", () => {
    const side = {
      blocks: [textBlock("", null), textBlock("hello", doc)],
    };
    const payload = toPayloadSide(side);
    expect(payload.blocks).toHaveLength(1);
    expect(payload.blocks[0].text).toBe("hello");
    expect(payload.blocks[0].doc).toBe(doc);
    expect(payload.blocks[0]._key).toBeUndefined();
  });

  it("backfills plain text from the doc when the string is missing", () => {
    const payload = toPayloadSide({ blocks: [{ type: "text", text: "", doc }] });
    expect(payload.blocks).toHaveLength(1);
    expect(payload.blocks[0].text).toContain("Energy");
  });

  it("treats an empty side as empty and keeps media sides", () => {
    expect(isSideEmpty({ blocks: [] })).toBe(true);
    expect(isSideEmpty({ blocks: [textBlock("", null)] })).toBe(true);
    expect(isSideEmpty({ blocks: [textBlock("hi", null)] })).toBe(false);
    expect(isSideEmpty({ blocks: [{ type: "image", url: "x" }] })).toBe(false);
  });

  it("normalises a stored side into editor blocks with stable keys", () => {
    const side = normalizeSide({ blocks: [{ type: "text", text: "legacy" }] });
    expect(side.blocks[0].text).toBe("legacy");
    expect(typeof side.blocks[0]._key).toBe("string");
    expect(sidePlainText(side)).toBe("legacy");
  });
});
