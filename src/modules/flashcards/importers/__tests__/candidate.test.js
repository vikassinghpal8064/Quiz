import { describe, it, expect } from "vitest";
import {
  SOURCES,
  candidateText,
  isImportable,
  makeCandidate,
  setCandidateApproved,
  setCandidateCategory,
  setCandidateTags,
  setCandidateText,
  toCardPayload,
} from "../candidate.js";
import { cardSignature } from "../signature.js";

describe("makeCandidate", () => {
  it("builds a basic text card from plain strings", () => {
    const candidate = makeCandidate({ front: "Q", back: "A", tags: ["x"] });

    expect(candidate.card_type).toBe("basic");
    expect(candidate.front).toEqual({ blocks: [{ type: "text", text: "Q" }] });
    expect(candidate.back).toEqual({ blocks: [{ type: "text", text: "A" }] });
    expect(candidate.tags).toEqual(["x"]);
  });

  it("derives the signature from the front", () => {
    const candidate = makeCandidate({ front: "  Rome ", back: "Italy" });
    expect(candidate.signature).toBe(cardSignature("rome"));
  });

  it("starts approved when it is valid", () => {
    expect(makeCandidate({ front: "Q", back: "A" }).approved).toBe(true);
  });

  it("starts unapproved and flags a missing side", () => {
    const candidate = makeCandidate({ front: "", back: "A" });
    expect(candidate.errors).toEqual(["missing front"]);
    expect(candidate.approved).toBe(false);
  });

  it("gives each candidate a unique key", () => {
    const a = makeCandidate({ front: "Q", back: "A" });
    const b = makeCandidate({ front: "Q", back: "A" });
    expect(a.key).not.toBe(b.key);
  });

  it("de-duplicates tags", () => {
    expect(makeCandidate({ front: "Q", back: "A", tags: ["a", "a", "b"] }).tags).toEqual(["a", "b"]);
  });

  it("honours an explicit approved override", () => {
    expect(makeCandidate({ front: "Q", back: "A", approved: false }).approved).toBe(false);
  });
});

describe("candidateText", () => {
  it("reads a side back as plain text", () => {
    const candidate = makeCandidate({ front: "Hello", back: "World" });
    expect(candidateText(candidate, "front")).toBe("Hello");
    expect(candidateText(candidate, "back")).toBe("World");
  });
});

describe("editing", () => {
  it("setCandidateText returns a new candidate and re-derives", () => {
    const original = makeCandidate({ front: "Q", back: "A" });
    const edited = setCandidateText(original, "front", "   ");

    expect(original.front.blocks[0].text).toBe("Q");
    expect(edited.errors).toContain("missing front");
    expect(edited.approved).toBe(false);
  });

  it("setCandidateTags accepts a comma separated string", () => {
    const candidate = setCandidateTags(makeCandidate({ front: "Q", back: "A" }), " one, two ,,one");
    expect(candidate.tags).toEqual(["one", "two"]);
  });

  it("setCandidateApproved coerces to a boolean", () => {
    const candidate = setCandidateApproved(makeCandidate({ front: "Q", back: "A" }), undefined);
    expect(candidate.approved).toBe(false);
  });

  it("setCandidateCategory trims and nulls out blanks", () => {
    const candidate = makeCandidate({ front: "Q", back: "A" });
    expect(setCandidateCategory(candidate, "  Bio  ").categoryName).toBe("Bio");
    expect(setCandidateCategory(candidate, "   ").categoryName).toBe(null);
  });
});

describe("isImportable", () => {
  it("needs both a tick and no errors", () => {
    expect(isImportable(makeCandidate({ front: "Q", back: "A" }))).toBe(true);
    expect(isImportable(makeCandidate({ front: "Q", back: "A", approved: false }))).toBe(false);
    expect(isImportable(makeCandidate({ front: "", back: "A" }))).toBe(false);
    expect(isImportable(null)).toBe(false);
  });
});

describe("toCardPayload", () => {
  it("produces exactly what the bulk endpoint validates", () => {
    const candidate = makeCandidate({
      front: "Q",
      back: "A",
      tags: ["t"],
      source: SOURCES.quiz,
      sourceRef: "42",
    });

    expect(toCardPayload(candidate, 7)).toEqual({
      category_id: 7,
      card_type: "basic",
      front: { blocks: [{ type: "text", text: "Q" }] },
      back: { blocks: [{ type: "text", text: "A" }] },
      tags: ["t"],
      source: "quiz-bridge",
      source_ref: "42",
    });
  });

  it("strips the wizard-only bookkeeping", () => {
    const payload = toCardPayload(makeCandidate({ front: "Q", back: "A", duplicate: "existing" }), 1);
    expect(payload).not.toHaveProperty("key");
    expect(payload).not.toHaveProperty("signature");
    expect(payload).not.toHaveProperty("errors");
    expect(payload).not.toHaveProperty("approved");
    expect(payload).not.toHaveProperty("duplicate");
  });

  it("omits empty source fields rather than sending null", () => {
    const payload = toCardPayload(makeCandidate({ front: "Q", back: "A" }), 1);
    expect(payload).not.toHaveProperty("source_ref");
  });
});
