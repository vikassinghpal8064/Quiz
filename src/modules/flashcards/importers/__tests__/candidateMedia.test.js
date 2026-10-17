import { describe, expect, it } from "vitest";
import {
  imageSide,
  makeCandidate,
  payloadSide,
  setCandidateSideText,
  sideHasContent,
  sideHasMedia,
  stripBlockKeys,
  textSide,
  toCardPayload,
  withDerived,
} from "../candidate.js";

const image = (url = "https://blob.example/x.webp") => ({
  blocks: [{ type: "image", url, _previewUrl: "blob:local" }],
});

describe("sideHasContent / sideHasMedia", () => {
  it("counts non-empty text", () => {
    expect(sideHasContent(textSide("hello"))).toBe(true);
    expect(sideHasContent(textSide("   "))).toBe(false);
    expect(sideHasContent(textSide(""))).toBe(false);
  });

  it("counts an image with a url", () => {
    expect(sideHasContent(image())).toBe(true);
    expect(sideHasMedia(image())).toBe(true);
    expect(sideHasContent({ blocks: [{ type: "image", url: "" }] })).toBe(false);
  });

  it("counts ink with strokes or a preview", () => {
    expect(sideHasContent({ blocks: [{ type: "ink", strokes: [[0, 0]] }] })).toBe(true);
    expect(sideHasContent({ blocks: [{ type: "ink", preview: { url: "https://x" } }] })).toBe(true);
    expect(sideHasContent({ blocks: [{ type: "ink" }] })).toBe(false);
  });
});

describe("withDerived", () => {
  it("requires a front", () => {
    const candidate = withDerived({ front: textSide(""), back: textSide("answer"), approved: true });
    expect(candidate.errors).toContain("missing front");
    expect(candidate.approved).toBe(false);
  });

  it("requires a back for a text-only card", () => {
    const candidate = withDerived({ front: textSide("q"), back: textSide(""), approved: true });
    expect(candidate.errors).toContain("missing back");
  });

  it("allows an empty back when the front is media", () => {
    const candidate = withDerived({ front: image(), back: textSide(""), approved: true });
    expect(candidate.errors).toEqual([]);
    expect(candidate.approved).toBe(true);
  });

  it("flags an empty image url as missing front", () => {
    const candidate = withDerived({ front: { blocks: [{ type: "image", url: "" }] }, back: textSide(""), approved: true });
    expect(candidate.errors).toContain("missing front");
  });
});

describe("imageSide", () => {
  it("stores width, height and a transient preview", () => {
    const side = imageSide("https://blob.example/x.webp", { width: 800, height: 600, previewUrl: "blob:local" });
    expect(side.blocks[0]).toMatchObject({ type: "image", url: "https://blob.example/x.webp", width: 800, height: 600 });
    expect(side.blocks[0]._previewUrl).toBe("blob:local");
  });
});

describe("setCandidateSideText", () => {
  it("replaces the text of a text-only side", () => {
    const candidate = makeCandidate({ front: "q", back: "a" });
    const next = setCandidateSideText(candidate, "front", "new q");
    expect(next.front.blocks).toEqual([{ type: "text", text: "new q" }]);
  });

  it("keeps an image block while editing the caption", () => {
    const candidate = makeCandidate({
      front: { blocks: [{ type: "text", text: "old" }, { type: "image", url: "https://x/y.webp" }] },
      back: "a",
    });
    const next = setCandidateSideText(candidate, "front", "new");
    expect(next.front.blocks).toEqual([
      { type: "text", text: "new" },
      { type: "image", url: "https://x/y.webp" },
    ]);
    expect(sideHasMedia(next.front)).toBe(true);
  });

  it("adds a text block in front of an image-only side", () => {
    const candidate = makeCandidate({ front: image(), back: "a" });
    const next = setCandidateSideText(candidate, "front", "caption");
    expect(next.front.blocks).toEqual([
      { type: "text", text: "caption" },
      { type: "image", url: "https://blob.example/x.webp", _previewUrl: "blob:local" },
    ]);
  });
});

describe("payload serialisation", () => {
  it("strips transient keys from blocks", () => {
    expect(stripBlockKeys({ type: "image", url: "u", _previewUrl: "blob:x", _blob: 1 })).toEqual({
      type: "image",
      url: "u",
    });
  });

  it("never lets a preview url reach the payload", () => {
    expect(payloadSide(image()).blocks[0]).toEqual({ type: "image", url: "https://blob.example/x.webp" });
  });

  it("builds a card payload for an image card", () => {
    const payload = toCardPayload({ front: image(), back: image("https://blob.example/y.webp"), tags: ["t"] }, 7);
    expect(payload.category_id).toBe(7);
    expect(payload.front.blocks[0]).toEqual({ type: "image", url: "https://blob.example/x.webp" });
    expect(payload.back.blocks[0].url).toBe("https://blob.example/y.webp");
  });
});
