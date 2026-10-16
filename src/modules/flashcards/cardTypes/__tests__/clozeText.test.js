import { describe, it, expect } from "vitest";
import {
  clozeNumbers,
  clozePlainText,
  clozeSegments,
  findClozes,
  hasCloze,
  validateCloze,
} from "../clozeText";

describe("clozeText", () => {
  it("finds every cloze marker", () => {
    const found = findClozes("The {{c1::mitochondria}} makes {{c2::ATP}}.");
    expect(found.map((m) => m.num)).toEqual([1, 2]);
    expect(found.map((m) => m.answer)).toEqual(["mitochondria", "ATP"]);
  });

  it("detects presence and numbers", () => {
    expect(hasCloze("plain text")).toBe(false);
    expect(hasCloze("a {{c1::b}} c")).toBe(true);
    expect(clozeNumbers("{{c2::x}} {{c1::y}} {{c2::z}}")).toEqual([1, 2]);
  });

  it("blanks markers on the front and reveals them on the back", () => {
    const text = "Water is {{c1::H2O}}.";
    const front = clozeSegments(text, { reveal: false });
    expect(front.map((s) => s.kind)).toEqual(["text", "blank", "text"]);
    expect(front[1].value).toBe("H2O");

    const back = clozeSegments(text, { reveal: true });
    expect(back.map((s) => s.kind)).toEqual(["text", "answer", "text"]);
    expect(back[1].value).toBe("H2O");
  });

  it("keeps the answers in the search text but drops the markers", () => {
    expect(clozePlainText("The {{c1::mitochondria}} is the {{c2::powerhouse}}.")).toBe(
      "The mitochondria is the powerhouse."
    );
  });

  it("validates that at least one cloze exists", () => {
    expect(validateCloze("")).toMatch(/add/i);
    expect(validateCloze("no markers here")).toMatch(/\{\{c1::answer\}\}/);
    expect(validateCloze("has {{c1::one}}")).toBeNull();
  });
});
