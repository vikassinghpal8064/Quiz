import basic from "./basic";
import { toPayloadSide } from "./blocks";

// "basic-reversed" - the opposite-direction twin of a basic card (front and back
// swapped). It is created automatically by the basic editor's "also add the
// reverse card" option, which links it to the original through source_ref, and
// is registered here so an existing reversed card can be edited and rendered
// exactly like a basic card. It is deliberately not offered in the type picker.
//
// Everything (editor, viewer, validation, search text) is shared with "basic";
// only the identity and the payload differ.

function buildCards(draft) {
  return [
    {
      front: toPayloadSide(draft.front),
      back: toPayloadSide(draft.back),
      card_type: "basic-reversed",
    },
  ];
}

export default {
  ...basic,
  id: "basic-reversed",
  label: "Basic (reversed)",
  buildCards,
};
