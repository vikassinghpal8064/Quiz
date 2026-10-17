import { describe, it, expect } from "vitest";
import {
  BATCH_SIZE,
  DUPLICATE_BATCH,
  DUPLICATE_EXISTING,
  groupCandidates,
  markDuplicates,
  progressOf,
  summarise,
  toBatches,
} from "../plan.js";
import { isImportable, makeCandidate, setCandidateApproved } from "../candidate.js";

const card = (front, back = "A") => makeCandidate({ front, back });

describe("markDuplicates", () => {
  it("flags a front that already exists in the target category", () => {
    const [flagged] = markDuplicates([card("Rome")], ["rome"]);
    expect(flagged.duplicate).toBe(DUPLICATE_EXISTING);
  });

  it("unticks a duplicate so the user opts back in", () => {
    const [flagged] = markDuplicates([card("Rome")], ["rome"]);
    expect(flagged.approved).toBe(false);
    expect(isImportable(flagged)).toBe(false);
  });

  it("flags a front repeated within the import itself", () => {
    const marked = markDuplicates([card("Rome"), card("Rome")], []);
    expect(marked[0].duplicate).toBe(null);
    expect(marked[1].duplicate).toBe(DUPLICATE_BATCH);
  });

  it("matches case- and punctuation-insensitively", () => {
    const [flagged] = markDuplicates([card("Paris, France")], ["paris france"]);
    expect(flagged.duplicate).toBe(DUPLICATE_EXISTING);
  });

  it("leaves a clean candidate alone", () => {
    const [flagged] = markDuplicates([card("Rome")], ["Berlin"]);
    expect(flagged.duplicate).toBe(null);
    expect(flagged.approved).toBe(true);
  });

  it("never flags a blank front - an empty signature matches everything", () => {
    const [flagged] = markDuplicates([card("")], ["", "rome"]);
    expect(flagged.duplicate).toBe(null);
  });

  it("ignores blank entries in the existing list", () => {
    const [flagged] = markDuplicates([card("Rome")], ["", "  "]);
    expect(flagged.duplicate).toBe(null);
  });

  it("does not mutate its input", () => {
    const input = [card("Rome")];
    markDuplicates(input, ["rome"]);
    expect(input[0].duplicate).toBe(undefined);
  });
});

describe("groupCandidates", () => {
  const target = { targetCategoryId: 10, categories: [] };

  it("sends unnamed cards to the chosen target category", () => {
    const groups = groupCandidates([card("a"), card("b")], target);
    expect(groups).toHaveLength(1);
    expect(groups[0].categoryId).toBe(10);
    expect(groups[0].candidates).toHaveLength(2);
  });

  it("resolves a named card to an existing category", () => {
    const groups = groupCandidates(
      [makeCandidate({ front: "a", back: "b", categoryName: "Bio" })],
      { targetCategoryId: 10, categories: [{ id: 3, name: "Biology" }, { id: 4, name: "Bio" }] }
    );
    expect(groups[0].categoryId).toBe(4);
  });

  it("resolves a name case-insensitively", () => {
    const groups = groupCandidates(
      [makeCandidate({ front: "a", back: "b", categoryName: "bioLOGY" })],
      { targetCategoryId: 10, categories: [{ id: 3, name: "Biology" }] }
    );
    expect(groups[0].categoryId).toBe(3);
  });

  it("returns an unknown name with no id so the run can create it", () => {
    const groups = groupCandidates(
      [makeCandidate({ front: "a", back: "b", categoryName: "New Thing" })],
      { targetCategoryId: 10, categories: [{ id: 3, name: "Biology" }] }
    );
    expect(groups[0].categoryId).toBe(null);
    expect(groups[0].name).toBe("New Thing");
  });

  it("groups cards sharing a name together", () => {
    const groups = groupCandidates(
      [
        makeCandidate({ front: "a", back: "b", categoryName: "Bio" }),
        makeCandidate({ front: "c", back: "d", categoryName: "Bio" }),
        makeCandidate({ front: "e", back: "f", categoryName: "Chem" }),
      ],
      target
    );
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.name === "Bio").candidates).toHaveLength(2);
  });

  it("drops candidates that are not importable", () => {
    const unticked = setCandidateApproved(card("x"), false);
    const groups = groupCandidates([card("a"), unticked], target);
    expect(groups[0].candidates).toHaveLength(1);
    expect(groups[0].candidates[0].front.blocks[0].text).toBe("a");
  });
});

describe("toBatches", () => {
  const cards = (n, front = "q") =>
    Array.from({ length: n }, (_, i) => makeCandidate({ front: `${front}-${i}`, back: "a" }));

  it("splits a large group into batches of at most 200", () => {
    const groups = groupCandidates(cards(450), { targetCategoryId: 5, categories: [] });
    const batches = toBatches(groups);

    expect(batches).toHaveLength(3);
    expect(batches.map((b) => b.size)).toEqual([200, 200, 50]);
    expect(batches.reduce((n, b) => n + b.size, 0)).toBe(450);
  });

  it("uses the documented default batch size", () => {
    expect(BATCH_SIZE).toBe(200);
  });

  it("stamps every payload with the group's category", () => {
    const groups = groupCandidates(cards(3, "x"), { targetCategoryId: 5, categories: [] });
    const batches = toBatches(groups);
    expect(batches[0].cards.every((payload) => payload.category_id === 5)).toBe(true);
  });

  it("emits one batch for a small group", () => {
    const groups = groupCandidates(cards(3), { targetCategoryId: 5, categories: [] });
    expect(toBatches(groups)).toHaveLength(1);
  });

  it("returns nothing when there is nothing to import", () => {
    expect(toBatches(groupCandidates([], { targetCategoryId: 5, categories: [] }))).toEqual([]);
  });
});

describe("summarise", () => {
  it("counts the ticked, invalid and duplicate rows", () => {
    const duplicate = markDuplicates([card("Rome"), card("Rome")], [])[1];
    const broken = makeCandidate({ front: "", back: "a" });
    const stats = summarise([card("a"), card("b"), duplicate, broken]);

    expect(stats.total).toBe(4);
    expect(stats.importable).toBe(2);
    expect(stats.excluded).toBe(2);
    expect(stats.invalid).toBe(1);
    expect(stats.duplicates).toBe(1);
  });

  it("handles an empty list", () => {
    expect(summarise([])).toMatchObject({ total: 0, importable: 0, excluded: 0 });
  });
});

describe("progressOf", () => {
  it("expresses progress as a clamped percentage", () => {
    expect(progressOf(0, 400)).toEqual({ done: 0, total: 400, percent: 0 });
    expect(progressOf(200, 400)).toEqual({ done: 200, total: 400, percent: 50 });
    expect(progressOf(400, 400)).toEqual({ done: 400, total: 400, percent: 100 });
  });

  it("never divides by zero", () => {
    expect(progressOf(0, 0).percent).toBe(0);
    expect(progressOf(5, 0).percent).toBe(0);
  });
});
