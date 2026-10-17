import { describe, expect, it } from "vitest";
import { buildApkgCandidates, guessImageMime } from "../build.js";
import { SOURCES } from "../../candidate.js";

// Text-only notes exercise the field mapping + tag handling without touching the
// network (uploads only happen when a field actually references an image).
const NOTE = { id: "1", mid: "7", flds: "Q\u001fA\u001fnote", tags: " math geo " };

describe("guessImageMime", () => {
  it("maps common extensions, ignoring a query string", () => {
    expect(guessImageMime("cat.png")).toBe("image/png");
    expect(guessImageMime("cat.JPG?v=2")).toBe("image/jpeg");
    expect(guessImageMime("weird.xyz")).toBe("application/octet-stream");
    expect(guessImageMime("")).toBe("application/octet-stream");
  });
});

describe("buildApkgCandidates", () => {
  it("maps the chosen fields to text sides and keeps tags", async () => {
    const [candidate] = await buildApkgCandidates([NOTE], {
      zip: {},
      mediaMap: {},
      mid: "7",
      mapping: { front: 0, back: [1] },
      includeTags: true,
    });

    expect(candidate.key).toBe("anki-1");
    expect(candidate.source).toBe(SOURCES.apkg);
    expect(candidate.source_ref).toBe("1");
    expect(candidate.front.blocks).toEqual([{ type: "text", text: "Q" }]);
    expect(candidate.back.blocks).toEqual([{ type: "text", text: "A" }]);
    expect(candidate.tags).toEqual(["math", "geo"]);
    expect(candidate.errors).toEqual([]);
    expect(candidate.approved).toBe(true);
  });

  it("joins several back fields and drops tag handling when asked", async () => {
    const [candidate] = await buildApkgCandidates([NOTE], {
      zip: {},
      mediaMap: {},
      mid: "7",
      mapping: { front: 0, back: [1, 2] },
      includeTags: false,
    });
    expect(candidate.back.blocks).toEqual([{ type: "text", text: "A\n\nnote" }]);
    expect(candidate.tags).toEqual([]);
  });

  it("filters to the selected notetype", async () => {
    const notes = [NOTE, { id: "2", mid: "9", flds: "x\u001fy", tags: "" }];
    const candidates = await buildApkgCandidates(notes, {
      zip: {},
      mediaMap: {},
      mid: "7",
      mapping: { front: 0, back: [1] },
    });
    expect(candidates.map((c) => c.key)).toEqual(["anki-1"]);
  });

  it("does not touch the zip when images are switched off", async () => {
    const withImage = { id: "3", mid: "7", flds: 'q <img src="missing.png">\u001fa', tags: "" };
    const [candidate] = await buildApkgCandidates([withImage], {
      zip: null, // would throw if a media lookup were attempted
      mediaMap: {},
      mid: "7",
      mapping: { front: 0, back: [1] },
      includeImages: false,
    });
    expect(candidate.front.blocks).toEqual([{ type: "text", text: "q" }]);
  });

  it("warns (but still builds) when a referenced image cannot be resolved", async () => {
    const withImage = { id: "4", mid: "7", flds: 'q <img src="missing.png">\u001fa', tags: "" };
    const [candidate] = await buildApkgCandidates([withImage], {
      zip: { file: () => null },
      mediaMap: {},
      mid: "7",
      mapping: { front: 0, back: [1] },
      includeImages: true,
    });
    expect(candidate.front.blocks).toEqual([{ type: "text", text: "q" }]);
    expect(candidate.warnings).toEqual(["1 image could not be included"]);
    expect(candidate.approved).toBe(true);
  });
});
