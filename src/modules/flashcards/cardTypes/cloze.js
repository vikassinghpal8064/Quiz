import ClozeEditor, { ClozeViewer } from "./clozeEditor";
import { clozePlainText, validateCloze } from "./clozeText";
import { normalizeSide, textBlock } from "./blocks";

// "cloze" - one block of text where parts are wrapped in {{c1::answer}}. The raw
// text (markers and all) is stored on the front side; the blanked question and
// the revealed answer are both derived from it, so there is no separate back
// side. The viewer's "front" is the blanked text and its "back" reveals every
// answer.

function clozeTextOf(draft) {
  const block = draft?.front?.blocks?.[0];
  return typeof block?.text === "string" ? block.text : "";
}

function createDraft() {
  return {
    front: { blocks: [textBlock("", null)] },
    back: { blocks: [] },
    meta: {},
  };
}

function fromCard(card) {
  return {
    front: normalizeSide(card?.front),
    back: { blocks: [] },
    meta: {},
  };
}

function validate(draft) {
  return validateCloze(clozeTextOf(draft));
}

function toSearchText(card) {
  return clozePlainText(card?.front?.blocks?.[0]?.text ?? "");
}

function buildCards(draft) {
  const text = clozeTextOf(draft).trim();
  return [
    {
      front: { blocks: text ? [{ type: "text", text }] : [] },
      back: { blocks: [] },
      card_type: "cloze",
    },
  ];
}

export default {
  id: "cloze",
  label: "Cloze",
  createDraft,
  fromCard,
  Editor: ClozeEditor,
  Viewer: ClozeViewer,
  validate,
  toSearchText,
  buildCards,
};
