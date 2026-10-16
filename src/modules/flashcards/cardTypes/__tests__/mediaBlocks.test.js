import { describe, it, expect } from "vitest";
import {
  audioBlock,
  imageBlock,
  isMediaBlockEmpty,
  isSideEmpty,
  toPayloadSide,
} from "../blocks";

describe("media blocks", () => {
  it("creates url-less uploader blocks that carry a transient key", () => {
    const block = imageBlock();
    expect(block).toMatchObject({ type: "image", url: "" });
    expect(block._key).toBeTruthy();
    expect(audioBlock().type).toBe("audio");
  });

  it("treats a media block without a url as empty", () => {
    expect(isMediaBlockEmpty(imageBlock())).toBe(true);
    expect(isMediaBlockEmpty(audioBlock({ url: "https://blob/x.webm" }))).toBe(false);
    expect(isMediaBlockEmpty({ type: "text", text: "hi" })).toBe(false);
  });

  it("counts a side with an uploaded image as non-empty", () => {
    expect(isSideEmpty({ blocks: [imageBlock()] })).toBe(true);
    expect(isSideEmpty({ blocks: [imageBlock({ url: "https://blob/x.webp" })] })).toBe(false);
  });

  it("keeps uploaded media in the payload but drops empty uploaders", () => {
    const side = {
      blocks: [
        imageBlock({
          url: "https://blob/x.webp",
          mime: "image/webp",
          bytes: 1234,
          width: 800,
          height: 600,
        }),
        audioBlock(),
      ],
    };
    const payload = toPayloadSide(side);
    expect(payload.blocks).toHaveLength(1);
    expect(payload.blocks[0]).toMatchObject({
      type: "image",
      url: "https://blob/x.webp",
      mime: "image/webp",
      bytes: 1234,
    });
    expect(payload.blocks[0]._key).toBeUndefined();
  });
});
