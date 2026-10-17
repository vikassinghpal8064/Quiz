import { describe, it, expect, vi } from "vitest";
import {
  findStoredObjectByHash,
  normaliseHash,
  validateUploadRequest,
} from "../flashMedia.js";

// The content-hash de-duplication path is pure except for one SQL probe, so it
// is exercised here without a database (and without Supabase configured).

describe("normaliseHash", () => {
  it("accepts a 64-char SHA-256 and lowercases + trims it", () => {
    const hex = "a".repeat(64);
    expect(normaliseHash(hex)).toBe(hex);
    expect(normaliseHash(`  ${"B".repeat(64)}  `)).toBe("b".repeat(64));
  });

  it("rejects anything that is not a full hex hash", () => {
    expect(normaliseHash(undefined)).toBe(null);
    expect(normaliseHash(null)).toBe(null);
    expect(normaliseHash("")).toBe(null);
    expect(normaliseHash("a".repeat(63))).toBe(null);
    expect(normaliseHash("a".repeat(65))).toBe(null);
    expect(normaliseHash("g".repeat(64))).toBe(null);
    expect(normaliseHash(12345)).toBe(null);
  });
});

describe("validateUploadRequest", () => {
  it("resolves the kind from the mime type", () => {
    expect(validateUploadRequest({ mime: "image/jpeg" })).toEqual({ kind: "image", mime: "image/jpeg" });
    expect(validateUploadRequest({ kind: "audio", mime: "audio/webm" })).toEqual({
      kind: "audio",
      mime: "audio/webm",
    });
  });

  it("rejects a mime that is neither image nor audio", () => {
    expect(() => validateUploadRequest({ mime: "application/pdf" })).toThrow(/image and audio/);
    expect(() => validateUploadRequest({})).toThrow(/image and audio/);
  });

  it("rejects a kind that disagrees with the mime", () => {
    expect(() => validateUploadRequest({ kind: "audio", mime: "image/webp" })).toThrow(/does not match/);
  });

  it("rejects a non-positive or oversized byte count", () => {
    expect(() => validateUploadRequest({ mime: "image/webp", bytes: 0 })).toThrow(/positive/);
    expect(() => validateUploadRequest({ mime: "image/webp", bytes: -5 })).toThrow(/positive/);
    expect(() => validateUploadRequest({ mime: "image/webp", bytes: Number.MAX_SAFE_INTEGER })).toThrow(/too large/);
  });

  it("allows a missing byte count", () => {
    expect(validateUploadRequest({ mime: "image/webp" }).kind).toBe("image");
  });
});

describe("findStoredObjectByHash", () => {
  const hash = "c".repeat(64);

  it("returns the existing object for a known hash", async () => {
    const sql = vi.fn(async () => [
      { url: "https://cdn/x.webp", storage_path: "flash/2026/x.webp", mime: "image/webp", bytes: 1234 },
    ]);
    await expect(findStoredObjectByHash(sql, 7, hash)).resolves.toEqual({
      url: "https://cdn/x.webp",
      path: "flash/2026/x.webp",
      mime: "image/webp",
      bytes: 1234,
    });
    expect(sql).toHaveBeenCalledTimes(1);
  });

  it("returns null when the user has no such object", async () => {
    const sql = vi.fn(async () => []);
    await expect(findStoredObjectByHash(sql, 7, hash)).resolves.toBe(null);
  });

  it("short-circuits a malformed hash without touching the database", async () => {
    const sql = vi.fn();
    await expect(findStoredObjectByHash(sql, 7, "nope")).resolves.toBe(null);
    expect(sql).not.toHaveBeenCalled();
  });

  it("swallows a missing hash column as a cache miss", async () => {
    const sql = vi.fn(async () => {
      throw new Error('column "hash" does not exist');
    });
    await expect(findStoredObjectByHash(sql, 7, hash)).resolves.toBe(null);
  });
});
