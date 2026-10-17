import { describe, it, expect } from "vitest";
import {
  EMPTY_SIGNATURE,
  cardSignature,
  isSignatureComparable,
  normalizeForSignature,
  sidePlainText,
} from "../signature.js";

describe("sidePlainText", () => {
  it("passes a plain string through", () => {
    expect(sidePlainText("hello")).toBe("hello");
  });

  it("joins the text of a side's blocks", () => {
    expect(
      sidePlainText({ blocks: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })
    ).toBe("a b");
  });

  it("ignores non-text blocks and nulls", () => {
    expect(
      sidePlainText({ blocks: [{ type: "image", url: "x.png" }, null, { type: "text", text: "ok" }] })
    ).toBe("ok");
  });

  it("accepts a bare array of blocks", () => {
    expect(sidePlainText([{ type: "text", text: "solo" }])).toBe("solo");
  });

  it("returns an empty string for anything unusable", () => {
    expect(sidePlainText(null)).toBe("");
    expect(sidePlainText(undefined)).toBe("");
    expect(sidePlainText(42)).toBe("");
    expect(sidePlainText({ nope: true })).toBe("");
  });
});

describe("normalizeForSignature", () => {
  it("folds case and collapses whitespace", () => {
    expect(normalizeForSignature("  The   Capital\t of  FRANCE ")).toBe("the capital of france");
  });

  it("drops punctuation so quotes and commas do not split a match", () => {
    expect(normalizeForSignature("Paris, France")).toBe(normalizeForSignature("paris france"));
  });

  it("treats curly and straight apostrophes the same", () => {
    expect(normalizeForSignature("don't")).toBe(normalizeForSignature("don\u2019t"));
  });

  it("keeps letters and numbers from non-latin scripts", () => {
    expect(normalizeForSignature("\u95ee\u7b54")).toBe("\u95ee\u7b54");
  });

  it("is idempotent", () => {
    const once = normalizeForSignature("Messy,   Input!");
    expect(normalizeForSignature(once)).toBe(once);
  });
});

describe("cardSignature", () => {
  it("matches fronts that read the same but are formatted differently", () => {
    expect(cardSignature("What is 2+2?")).toBe(cardSignature("what is 2 + 2"));
  });

  it("differs for genuinely different fronts", () => {
    expect(cardSignature("What is 2+2?")).not.toBe(cardSignature("What is 2+3?"));
  });

  it("reads a side object, not just a string", () => {
    expect(cardSignature({ blocks: [{ type: "text", text: "Rome" }] })).toBe(cardSignature("rome"));
  });

  it("returns the empty signature for a blank front", () => {
    expect(cardSignature("")).toBe(EMPTY_SIGNATURE);
    expect(cardSignature("   ,  ")).toBe(EMPTY_SIGNATURE);
  });
});

describe("isSignatureComparable", () => {
  it("accepts a real signature", () => {
    expect(isSignatureComparable("rome")).toBe(true);
  });

  it("rejects the empty signature - a blank front matches everything", () => {
    expect(isSignatureComparable(EMPTY_SIGNATURE)).toBe(false);
    expect(isSignatureComparable("")).toBe(false);
    expect(isSignatureComparable(null)).toBe(false);
    expect(isSignatureComparable(undefined)).toBe(false);
  });
});
