import { describe, expect, it } from "vitest";
import {
  ANKI_FIELD_SEP,
  countMediaRefs,
  defaultFieldMapping,
  extractImageRefs,
  fieldText,
  invertMediaMap,
  notetypeFieldNames,
  notetypesWithCounts,
  parseAnkiTags,
  parseMediaMap,
  splitFields,
  stripHtml,
} from "../anki.js";

const MODELS = {
  123: {
    name: "Basic",
    flds: [
      { name: "Front", ord: 0 },
      { name: "Back", ord: 1 },
    ],
  },
  456: {
    name: "Cloze",
    flds: [
      { name: "Extra", ord: 1 },
      { name: "Text", ord: 0 },
    ],
  },
};

describe("stripHtml", () => {
  it("turns line breaks into newlines and drops tags", () => {
    expect(stripHtml("<b>Hi</b><br>there")).toBe("Hi\nthere");
    expect(stripHtml("<div>one</div><div>two</div>")).toBe("one\ntwo");
  });

  it("decodes a few entities", () => {
    expect(stripHtml("a&nbsp;b &amp; c")).toBe("a b & c");
    expect(stripHtml("&lt;x&gt; &quot;y&quot;")).toBe('<x> "y"');
  });

  it("drops Anki sound refs and collapses blank runs", () => {
    expect(stripHtml("[sound:clip.mp3]Hello")).toBe("Hello");
    expect(stripHtml("a<br><br><br>b")).toBe("a\n\nb");
  });

  it("tolerates empty and non-string input", () => {
    expect(stripHtml("")).toBe("");
    expect(stripHtml(null)).toBe("");
    expect(stripHtml(undefined)).toBe("");
  });
});

describe("extractImageRefs", () => {
  it("finds img src values in order, with either quote style", () => {
    expect(extractImageRefs(`<img src="a.png"><img src='b.jpg' alt="x">`)).toEqual(["a.png", "b.jpg"]);
  });

  it("returns nothing when there are no images", () => {
    expect(extractImageRefs("<b>plain</b>")).toEqual([]);
    expect(extractImageRefs(null)).toEqual([]);
  });

  it("countMediaRefs counts image refs", () => {
    expect(countMediaRefs(`<img src="a.png"><img src="b.png">`)).toBe(2);
  });
});

describe("splitFields / parseAnkiTags", () => {
  it("splits on the unit separator", () => {
    expect(splitFields(`a${ANKI_FIELD_SEP}b${ANKI_FIELD_SEP}c`)).toEqual(["a", "b", "c"]);
    expect(splitFields("")).toEqual([""]);
  });

  it("parses the padded, space separated tag string", () => {
    expect(parseAnkiTags("  math geo ")).toEqual(["math", "geo"]);
    expect(parseAnkiTags("")).toEqual([]);
    expect(parseAnkiTags(null)).toEqual([]);
  });
});

describe("notetype helpers", () => {
  it("orders field names by ord, not array position", () => {
    expect(notetypeFieldNames(MODELS[456])).toEqual(["Text", "Extra"]);
  });

  it("falls back to positional names for a shapeless model", () => {
    expect(notetypeFieldNames({ flds: [{}, {}] })).toEqual(["Field 1", "Field 2"]);
    expect(notetypeFieldNames(null)).toEqual([]);
  });

  it("counts notes per notetype and drops empty ones", () => {
    const notes = [
      { mid: "123", flds: "q", tags: "" },
      { mid: "456", flds: "c", tags: "" },
      { mid: "456", flds: "c2", tags: "" },
      { mid: "999", flds: "orphan", tags: "" },
    ];
    const summaries = notetypesWithCounts(MODELS, notes);
    expect(summaries).toEqual([
      { mid: "123", name: "Basic", fieldNames: ["Front", "Back"], count: 1 },
      { mid: "456", name: "Cloze", fieldNames: ["Text", "Extra"], count: 2 },
    ]);
  });
});

describe("defaultFieldMapping / fieldText", () => {
  it("uses the first field as front and the second as back", () => {
    expect(defaultFieldMapping(MODELS[123])).toEqual({ front: 0, back: [1] });
  });

  it("leaves back empty when there is only one field", () => {
    expect(defaultFieldMapping({ flds: [{ name: "Only", ord: 0 }] })).toEqual({ front: 0, back: [] });
    expect(defaultFieldMapping(null)).toEqual({ front: 0, back: [] });
  });

  it("joins the chosen fields, skipping blanks", () => {
    const fields = ["Q", "A", "", "note"];
    expect(fieldText(fields, [1, 2, 3])).toBe("A\n\nnote");
    expect(fieldText(fields, [2])).toBe("");
    expect(fieldText(fields, [])).toBe("");
  });
});

describe("media maps", () => {
  it("parses the media JSON object", () => {
    expect(parseMediaMap('{"0":"cat.jpg","1":"dog.png"}')).toEqual({ 0: "cat.jpg", 1: "dog.png" });
  });

  it("treats anything that is not a plain object as empty", () => {
    expect(parseMediaMap("not json")).toEqual({});
    expect(parseMediaMap(null)).toEqual({});
    expect(parseMediaMap(["x"])).toEqual({});
    expect(parseMediaMap('{"0": 5}')).toEqual({});
  });

  it("inverts a media map from number -> name to name -> number", () => {
    expect(invertMediaMap({ 0: "cat.jpg", 1: "dog.png" })).toEqual({ "cat.jpg": "0", "dog.png": "1" });
    expect(invertMediaMap(null)).toEqual({});
  });
});
