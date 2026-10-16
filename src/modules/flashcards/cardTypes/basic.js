import BasicEditor from "./basicEditor";
import BasicViewer from "./basicViewer";
import { isSideEmpty, normalizeSide, sidePlainText, textBlock, toPayloadSide } from "./blocks";

// "basic" - a rich-text front and back, each a stack of blocks. When adding, the
// user can opt to also create the opposite-direction card; that is stored as a
// separate "basic-reversed" row linked back through source_ref.
//
// A card type is a plain descriptor (see registry.js for the contract):
// { id, label, createDraft, fromCard, Editor, Viewer, validate, toSearchText,
//   buildCards }.

function createDraft() {
  return {
    front: { blocks: [textBlock("", null)] },
    back: { blocks: [textBlock("", null)] },
    meta: { addReverse: false },
  };
}

function fromCard(card) {
  return {
    front: normalizeSide(card?.front),
    back: normalizeSide(card?.back),
    meta: { addReverse: false },
  };
}

function validate(draft) {
  if (isSideEmpty(draft?.front)) return "Add some content to the front of the card.";
  return null;
}

function toSearchText(card) {
  return [card?.front, card?.back].map(sidePlainText).filter(Boolean).join("\n");
}

function buildCards(draft, { creating = false } = {}) {
  const front = toPayloadSide(draft.front);
  const back = toPayloadSide(draft.back);
  const cards = [{ front, back, card_type: "basic" }];
  if (creating && draft.meta?.addReverse) {
    // The reverse card is the same content with the sides swapped. The shell
    // sets source_ref to the first card's id so the pair stays linked.
    cards.push({ front: back, back: front, card_type: "basic-reversed", linkToPrevious: true });
  }
  return cards;
}

export default {
  id: "basic",
  label: "Basic",
  createDraft,
  fromCard,
  Editor: BasicEditor,
  Viewer: BasicViewer,
  validate,
  toSearchText,
  buildCards,
};
