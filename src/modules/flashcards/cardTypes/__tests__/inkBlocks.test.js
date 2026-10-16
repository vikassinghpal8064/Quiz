import { describe, it, expect } from "vitest";
import { inkBlock, isInkBlockEmpty, isSideEmpty, normalizeSide, toPayloadSide } from "../blocks";

const stroke = { id: "s1", tool: "pen", color: "#111827", width: 4, points: [{ x: 0, y: 0, p: 0.5 }] };

describe("ink blocks", () => {
  it("creates an empty handwriting block with a transient key and surface size", () => {
    const block = inkBlock();
    expect(block).toMatchObject({ type: "ink", background: "blank", strokes: [] });
    expect(block.width).toBeGreaterThan(0);
    expect(block.height).toBeGreaterThan(0);
    expect(block._key).toBeTruthy();
  });

  it("is empty until it has a stroke or a preview", () => {
    expect(isInkBlockEmpty(inkBlock())).toBe(true);
    expect(isInkBlockEmpty(inkBlock({ strokes: [stroke] }))).toBe(false);
    expect(isInkBlockEmpty(inkBlock({ preview: { url: "https://blob/x.png" } }))).toBe(false);
    expect(isInkBlockEmpty({ type: "text", text: "hi" })).toBe(false);
  });

  it("counts a side with drawn strokes as non-empty", () => {
    expect(isSideEmpty({ blocks: [inkBlock()] })).toBe(true);
    expect(isSideEmpty({ blocks: [inkBlock({ strokes: [stroke] })] })).toBe(false);
  });

  it("keeps strokes and preview in the payload but drops nothing else", () => {
    const side = {
      blocks: [
        inkBlock({
          strokes: [stroke],
          background: "grid",
          preview: { url: "https://blob/x.png", pathname: "fc/ink/x.png" },
        }),
        inkBlock(),
      ],
    };
    const payload = toPayloadSide(side);
    expect(payload.blocks).toHaveLength(1);
    expect(payload.blocks[0]).toMatchObject({
      type: "ink",
      background: "grid",
      preview: { url: "https://blob/x.png" },
    });
    expect(payload.blocks[0].strokes).toHaveLength(1);
    expect(payload.blocks[0]._key).toBeUndefined();
  });

  it("normalises a stored ink block with defaults and a fresh key", () => {
    const side = normalizeSide({ blocks: [{ type: "ink", strokes: [stroke] }] });
    const block = side.blocks[0];
    expect(block.width).toBeGreaterThan(0);
    expect(block.height).toBeGreaterThan(0);
    expect(block.background).toBe("blank");
    expect(block._key).toBeTruthy();
    // Round-trips through the payload with the strokes intact.
    expect(toPayloadSide(side).blocks[0].strokes).toHaveLength(1);
  });

  it("coerces a malformed stored ink block into a safe shape", () => {
    const side = normalizeSide({ blocks: [{ type: "ink" }] });
    expect(side.blocks[0].strokes).toEqual([]);
    expect(side.blocks[0].background).toBe("blank");
  });
});
