import { describe, it, expect } from "vitest";
import { getCardType, listCardTypes, registerCardType, SELECTABLE_CARD_TYPES } from "../registry";
import { textBlock } from "../blocks";

const CONTRACT = [
  "id",
  "label",
  "createDraft",
  "fromCard",
  "Editor",
  "Viewer",
  "validate",
  "toSearchText",
  "buildCards",
];

describe("card type registry", () => {
  it("registers the built-in types and falls back to basic", () => {
    expect(getCardType("basic").id).toBe("basic");
    expect(getCardType("cloze").id).toBe("cloze");
    expect(getCardType("basic-reversed").id).toBe("basic-reversed");
    expect(getCardType("does-not-exist").id).toBe("basic");
  });

  it("offers basic and cloze as the selectable types", () => {
    expect(SELECTABLE_CARD_TYPES.map((t) => t.id)).toEqual(["basic", "cloze"]);
  });

  it("implements the full descriptor contract for every type", () => {
    for (const type of listCardTypes()) {
      for (const key of CONTRACT) {
        expect(type[key], `${type.id}.${key}`).toBeTruthy();
      }
    }
  });

  it("builds the reversed twin, swapping the sides, only when asked", () => {
    const draft = {
      front: { blocks: [textBlock("Q", null)] },
      back: { blocks: [textBlock("A", null)] },
      meta: { addReverse: true },
    };
    const cards = getCardType("basic").buildCards(draft, { creating: true });
    expect(cards).toHaveLength(2);
    expect(cards[0].card_type).toBe("basic");
    expect(cards[1].card_type).toBe("basic-reversed");
    expect(cards[1].linkToPrevious).toBe(true);
    expect(cards[1].front.blocks[0].text).toBe("A");
    expect(cards[1].back.blocks[0].text).toBe("Q");

    const noReverse = getCardType("basic").buildCards(draft, { creating: false });
    expect(noReverse).toHaveLength(1);
  });

  it("wraps cloze text on the front with an empty back", () => {
    const type = getCardType("cloze");
    const draft = type.createDraft();
    draft.front.blocks[0].text = "The {{c1::answer}} is hidden.";
    const cards = type.buildCards(draft);
    expect(cards).toHaveLength(1);
    expect(cards[0].card_type).toBe("cloze");
    expect(cards[0].front.blocks[0].text).toContain("{{c1::answer}}");
    expect(cards[0].back.blocks).toHaveLength(0);
  });

  it("rejects a type that is missing its components", () => {
    expect(() => registerCardType({ id: "broken" })).toThrow();
    expect(() => registerCardType({ Editor: () => null, Viewer: () => null })).toThrow();
  });
});
