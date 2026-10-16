import basic from "./basic";
import cloze from "./cloze";
import basicReversed from "./basicReversed";

// The card-type registry. Every type is a plain descriptor:
//
//   {
//     id,                 // stored in fc_cards.card_type
//     label,              // shown in the type picker / previews
//     createDraft(),      // fresh editor state for a new card
//     fromCard(card),     // editor state hydrated from a stored card
//     Editor,             // React component: ({ draft, onChange, disabled, creating })
//     Viewer,             // React component: ({ card, face }) -> one face
//     validate(draft),    // returns an error string, or null when valid
//     toSearchText(card), // plain text folded into search / previews
//     buildCards(draft),  // [{ front, back, card_type, linkToPrevious? }]
//   }
//
// Adding a type means implementing this shape and registering it - the editor
// shell, the preview and the save path never special-case a concrete type.
const registry = new Map();

export function registerCardType(type) {
  if (!type || typeof type.id !== "string" || !type.id.trim()) {
    throw new Error("A card type needs a non-empty id");
  }
  if (typeof type.Editor !== "function" || typeof type.Viewer !== "function") {
    throw new Error(`Card type "${type.id}" needs Editor and Viewer components`);
  }
  registry.set(type.id, type);
  return type;
}

registerCardType(basic);
registerCardType(cloze);
registerCardType(basicReversed);

export function getCardType(id) {
  return registry.get(id) ?? basic;
}

export function listCardTypes() {
  return [...registry.values()];
}

// The types a user can choose when adding a card. "basic-reversed" is created
// from the basic editor's reverse option, not picked directly.
export const SELECTABLE_CARD_TYPES = [basic, cloze];

export const FALLBACK_CARD_TYPE = basic;
