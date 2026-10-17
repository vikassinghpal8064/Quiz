import { describe, it, expect } from "vitest";
import { fitWithin } from "../image";
import { extensionFor, uploadMediaBlob, uploadMediaBatch } from "../media";
import {
  MAX_MEDIA_BYTES,
  isSafeStoragePath,
  kindForMime,
  mediaObjectPath,
} from "../storage/paths";
import { getStorage, storageNames, DEFAULT_STORAGE } from "../storage/index";
import { downsamplePeaks, rollingLevel } from "../waveform";

// A storage adapter that records calls and can be told to fail the first N
// attempts, so retries are observable without any network.
function fakeStorage({ failures = 0, deduplicate = false } = {}) {
  let attempts = 0;
  const calls = [];
  return {
    name: "fake",
    calls,
    get attempts() {
      return attempts;
    },
    async createUpload(meta) {
      attempts += 1;
      calls.push(["createUpload", meta]);
      if (attempts <= failures) throw new Error("boom");
      // A server that already owns an object with this content hash answers
      // without a signed URL (see api/_flash/media/sign.js).
      if (deduplicate) {
        return {
          deduplicated: true,
          url: "https://cdn.test/existing.webp",
          path: "flash/2026/existing.webp",
          publicUrl: "https://cdn.test/existing.webp",
          mime: "image/webp",
          bytes: 99,
        };
      }
      return {
        signedUrl: `https://cdn.test/signed/${meta.filename ?? "x"}`,
        token: "tok",
        path: `flash/2026/${meta.filename ?? "x"}`,
        publicUrl: `https://cdn.test/${meta.filename ?? "x"}`,
      };
    },
    async uploadToSignedUrl(path) {
      calls.push(["uploadToSignedUrl", path]);
      return { path };
    },
    async remove(paths) {
      calls.push(["remove", paths]);
      return { removed: paths };
    },
  };
}

describe("image.fitWithin", () => {
  it("leaves an image already inside the box untouched", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("scales the longest edge down to the limit and keeps the aspect ratio", () => {
    expect(fitWithin(3200, 1600, 1600)).toEqual({ width: 1600, height: 800 });
    expect(fitWithin(1600, 3200, 1600)).toEqual({ width: 800, height: 1600 });
  });

  it("never produces a zero dimension", () => {
    expect(fitWithin(0, 0, 1600)).toEqual({ width: 1, height: 1 });
  });
});

describe("media pathnames", () => {
  it("prefers a real file extension", () => {
    expect(extensionFor("audio", "Clip.WAV", "audio/webm")).toBe("wav");
  });

  it("falls back to the mime type, then the kind", () => {
    expect(extensionFor("image", "", "image/png")).toBe("png");
    expect(extensionFor("audio", "", "")).toBe("webm");
    expect(extensionFor("image", "", "")).toBe("webp");
  });

  it("scopes the object under flash/<year>/ with the given id", () => {
    const path = mediaObjectPath(
      "image",
      { mime: "image/webp" },
      { id: "abc123", date: new Date("2026-02-01T00:00:00Z") }
    );
    expect(path).toBe("flash/2026/abc123.webp");
  });
});

describe("storage paths", () => {
  it("classifies mime types into image / audio / other", () => {
    expect(kindForMime("image/png")).toBe("image");
    expect(kindForMime("audio/webm")).toBe("audio");
    expect(kindForMime("application/pdf")).toBe(null);
    expect(kindForMime("")).toBe(null);
  });

  it("caps uploads at 5 MB", () => {
    expect(MAX_MEDIA_BYTES).toBe(5 * 1024 * 1024);
  });

  it("accepts only safe flash/ paths", () => {
    expect(isSafeStoragePath("flash/2026/abc.webp")).toBe(true);
    expect(isSafeStoragePath("/flash/2026/abc.webp")).toBe(false);
    expect(isSafeStoragePath("flash/../secret")).toBe(false);
    expect(isSafeStoragePath("other/abc.webp")).toBe(false);
    expect(isSafeStoragePath("")).toBe(false);
  });
});

describe("storage registry", () => {
  it("defaults to supabase", () => {
    expect(DEFAULT_STORAGE).toBe("supabase");
    expect(storageNames()[0]).toBe("supabase");
    expect(getStorage().name).toBe("supabase");
    expect(getStorage("missing").name).toBe("supabase");
  });
});

describe("uploadMediaBlob", () => {
  const mkBlob = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });

  it("signs then uploads and returns url / path / mime / bytes", async () => {
    const storage = fakeStorage();
    const result = await uploadMediaBlob(mkBlob(), { kind: "image", mime: "image/webp", filename: "a.webp", storage });
    expect(result.path).toBe("flash/2026/a.webp");
    expect(result.url).toBe("https://cdn.test/a.webp");
    expect(result.mime).toBe("image/webp");
    expect(result.bytes).toBe(3);
    expect(storage.calls.map((c) => c[0])).toEqual(["createUpload", "uploadToSignedUrl"]);
  });

  it("forwards the content hash to the sign step", async () => {
    const storage = fakeStorage();
    const hash = "a".repeat(64);
    await uploadMediaBlob(mkBlob(), { kind: "image", mime: "image/webp", filename: "a.webp", hash, storage });
    expect(storage.calls[0][1].hash).toBe(hash);
  });

  it("skips the PUT when the server already holds the hash", async () => {
    const storage = fakeStorage({ deduplicate: true });
    const hash = "b".repeat(64);
    const result = await uploadMediaBlob(mkBlob(), {
      kind: "image",
      mime: "image/webp",
      filename: "a.webp",
      hash,
      storage,
    });
    expect(result.deduplicated).toBe(true);
    expect(result.url).toBe("https://cdn.test/existing.webp");
    expect(result.path).toBe("flash/2026/existing.webp");
    // createUpload happened, but the bytes were never PUT to a signed URL.
    expect(storage.calls.map((c) => c[0])).toEqual(["createUpload"]);
  });

  it("retries a failed upload and then succeeds", async () => {
    const storage = fakeStorage({ failures: 2 });
    const progress = [];
    const result = await uploadMediaBlob(mkBlob(), {
      kind: "image",
      storage,
      backoffMs: 0,
      onProgress: (p) => progress.push(p),
    });
    expect(result.url).toBe("https://cdn.test/x");
    expect(storage.attempts).toBe(3);
    expect(progress.filter((p) => p.retry).length).toBe(2);
  });

  it("gives up after the retry budget and throws", async () => {
    const storage = fakeStorage({ failures: 99 });
    await expect(
      uploadMediaBlob(mkBlob(), { kind: "image", storage, retries: 2, backoffMs: 0 })
    ).rejects.toThrow("boom");
    expect(storage.attempts).toBe(3);
  });
});

describe("uploadMediaBatch", () => {
  it("reports 3 of 3 uploaded and captures per-file failures", async () => {
    const storage = fakeStorage();
    const items = [1, 2, 3].map((n) => ({
      file: new Blob([new Uint8Array(n)], { type: "image/webp" }),
      filename: `img-${n}.webp`,
      mime: "image/webp",
    }));
    const seen = [];
    const results = await uploadMediaBatch(items, {
      kind: "image",
      storage,
      concurrency: 1,
      onProgress: (p) => seen.push(p),
    });
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results[2].value.path).toBe("flash/2026/img-3.webp");
    expect(seen.at(-1)).toEqual({ done: 3, total: 3 });
  });
});

describe("waveform", () => {
  it("reduces samples to the requested number of peaks", () => {
    const peaks = downsamplePeaks([0, 0.5, 1, -1, 0.2, 0], 3);
    expect(peaks).toHaveLength(3);
    expect(peaks[0]).toBeCloseTo(0.5);
    expect(peaks[1]).toBeCloseTo(1);
    expect(peaks[2]).toBeCloseTo(0.2);
  });

  it("handles empty input and clamps to 0..1", () => {
    expect(downsamplePeaks([], 4)).toEqual([0, 0, 0, 0]);
    expect(downsamplePeaks([2, -3], 2).every((p) => p <= 1)).toBe(true);
  });

  it("averages a rolling level", () => {
    expect(rollingLevel([0, 1])).toBe(0.5);
    expect(rollingLevel([])).toBe(0);
  });
});
