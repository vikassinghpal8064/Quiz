import { describe, it, expect } from "vitest";
import {
  ALREADY_COMPRESSED_MIMES,
  JPEG,
  PAGE_MAX_EDGE,
  PHOTO_MAX_EDGE,
  PNG,
  WEBP,
  fitEdge,
  maxEdgeFor,
  pageRenderSize,
  planEncoding,
} from "../plan";
import {
  DEFAULT_IMAGE_QUALITY,
  IMAGE_QUALITY_NAMES,
  QUALITY_PRESETS,
  isImageQualityName,
  resolveQualityPreset,
} from "../presets";
import { sha256Hex, hasSubtleCrypto } from "../hash";
import { comparisonOf, describePreparation, formatBytes } from "../pipeline";

describe("quality presets", () => {
  it("exposes the three documented presets with the spec's qualities", () => {
    expect(IMAGE_QUALITY_NAMES).toEqual(["balanced", "high", "lossless"]);
    expect(QUALITY_PRESETS.balanced.quality).toBe(0.85);
    expect(QUALITY_PRESETS.high.quality).toBe(0.92);
    expect(QUALITY_PRESETS.lossless.lossless).toBe(true);
    expect(DEFAULT_IMAGE_QUALITY).toBe("high");
  });

  it("resolves by name and falls back to high for anything unknown", () => {
    expect(resolveQualityPreset("balanced").quality).toBe(0.85);
    expect(resolveQualityPreset("nonsense").name).toBe("high");
    expect(resolveQualityPreset(undefined).name).toBe("high");
    expect(isImageQualityName("lossless")).toBe(true);
    expect(isImageQualityName("ultra")).toBe(false);
  });
});

describe("fitEdge", () => {
  it("never upscales an image inside the box", () => {
    expect(fitEdge(800, 600, 2000)).toEqual({ width: 800, height: 600, scale: 1, resized: false });
  });

  it("shrinks the longest edge to the limit and keeps the ratio", () => {
    expect(fitEdge(5000, 3000, 2000)).toMatchObject({ width: 2000, height: 1200, resized: true });
    expect(fitEdge(3000, 5000, 2000)).toMatchObject({ width: 1200, height: 2000 });
  });

  it("treats Infinity as 'keep every pixel'", () => {
    expect(fitEdge(9000, 9000, Infinity).resized).toBe(false);
    expect(fitEdge(9000, 9000, Infinity).width).toBe(9000);
  });

  it("never produces a zero dimension", () => {
    expect(fitEdge(0, 0, 2000)).toMatchObject({ width: 1, height: 1 });
  });
});

describe("pageRenderSize", () => {
  it("rasterises a page at 2x its natural size", () => {
    expect(pageRenderSize(612, 792)).toEqual({ width: 1224, height: 1584 });
  });

  it("caps the longest edge at 2400 px", () => {
    const size = pageRenderSize(1236, 1584);
    expect(size.height).toBe(PAGE_MAX_EDGE);
    expect(size.width).toBe(1873);
  });
});

describe("planEncoding", () => {
  it("caps a camera photo at 2000 px and encodes to WebP", () => {
    const plan = planEncoding({ sourceKind: "photo", mime: "image/jpeg", width: 4000, height: 3000 });
    expect(plan).toMatchObject({
      format: WEBP,
      fallbackFormat: JPEG,
      width: PHOTO_MAX_EDGE,
      height: 1500,
      resize: true,
      passthrough: false,
      lossless: false,
    });
    expect(plan.quality).toBe(0.92);
  });

  it("caps a PDF page at 2400 px and falls back to JPEG", () => {
    const plan = planEncoding({ sourceKind: "page", width: 3000, height: 4000 });
    expect(plan).toMatchObject({ format: WEBP, fallbackFormat: JPEG, maxEdge: PAGE_MAX_EDGE });
    expect(plan.width).toBe(1800);
    expect(plan.height).toBe(2400);
  });

  it("never downscales a crop", () => {
    const plan = planEncoding({ sourceKind: "crop", width: 3000, height: 3000, bytes: 4 * 1024 * 1024 });
    expect(plan.resize).toBe(false);
    expect(plan.width).toBe(3000);
    expect(maxEdgeFor("crop")).toBe(Infinity);
  });

  it("uses lossless WebP for a crop under 600 KB", () => {
    const plan = planEncoding({ sourceKind: "crop", width: 800, height: 600, bytes: 120 * 1024 });
    expect(plan.lossless).toBe(true);
    expect(plan.quality).toBe(1);
    expect(plan.reason).toBe("crop:small-lossless");
    expect(plan.fallbackFormat).toBe(PNG);
  });

  it("falls back to the pixel budget when a crop's byte size is unknown", () => {
    const small = planEncoding({ sourceKind: "crop", width: 900, height: 900 });
    expect(small.lossless).toBe(true);
    const big = planEncoding({ sourceKind: "crop", width: 4000, height: 4000 });
    expect(big.lossless).toBe(false);
  });

  it("always encodes an ink preview losslessly as WebP", () => {
    const plan = planEncoding({ sourceKind: "ink", width: 1200, height: 800, mime: "image/webp" });
    expect(plan.lossless).toBe(true);
    expect(plan.format).toBe(WEBP);
    expect(plan.fallbackFormat).toBe(PNG);
    expect(plan.passthrough).toBe(false);
  });

  it("passes through an already-compressed image that needs no resize", () => {
    for (const mime of ALREADY_COMPRESSED_MIMES) {
      const plan = planEncoding({ sourceKind: "photo", mime, width: 1000, height: 800 });
      expect(plan.passthrough).toBe(true);
      expect(plan.reason).toBe("passthrough:already-compressed");
    }
  });

  it("re-encodes a compressed image that has to be resized", () => {
    const plan = planEncoding({ sourceKind: "photo", mime: "image/jpeg", width: 4000, height: 3000 });
    expect(plan.passthrough).toBe(false);
  });

  it("honours the lossless preset for large crops", () => {
    const plan = planEncoding({ sourceKind: "crop", width: 4000, height: 4000, quality: "lossless" });
    expect(plan.lossless).toBe(true);
    expect(plan.quality).toBe(1);
  });

  it("applies the balanced preset", () => {
    const plan = planEncoding({ sourceKind: "photo", width: 1000, height: 800, quality: "balanced" });
    expect(plan.quality).toBe(0.85);
  });

  it("treats an unknown source kind as a photo", () => {
    expect(planEncoding({ sourceKind: "mystery", width: 10, height: 10 }).sourceKind).toBe("photo");
  });
});

describe("hash", () => {
  it("reports whether SubtleCrypto is available", () => {
    expect(typeof hasSubtleCrypto()).toBe("boolean");
  });

  it("hashes a blob to the known SHA-256 of its bytes", async () => {
    if (!hasSubtleCrypto()) return; // insecure origin: hashing is optional
    const hash = await sha256Hex(new Blob(["abc"]));
    expect(hash).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("returns null when the runtime has no SubtleCrypto", async () => {
    expect(await sha256Hex(null)).toBeNull();
  });
});

describe("pipeline summaries", () => {
  it("formats byte sizes the way the import UI reads them", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(formatBytes(undefined)).toBe("");
  });

  it("describes a prepared image", () => {
    expect(
      describePreparation({ width: 2400, height: 3360, mime: "image/webp", lossless: false, bytes: 212 * 1024 })
    ).toBe("2400×3360 · webp · 212 KB");
    expect(
      describePreparation({ width: 800, height: 600, mime: "image/webp", lossless: true, bytes: 90 * 1024 })
    ).toContain("WebP lossless");
  });

  it("computes the original/compressed saving for the compare toggle", () => {
    const saving = comparisonOf({ originalBytes: 1_400_000, bytes: 212 * 1024 });
    expect(saving.savedBytes).toBe(1_400_000 - 212 * 1024);
    expect(saving.originalBytes).toBe(1_400_000);
    expect(saving.label).toBe("84% smaller");
    expect(comparisonOf({ bytes: 100 })).toBeNull();
  });
});
