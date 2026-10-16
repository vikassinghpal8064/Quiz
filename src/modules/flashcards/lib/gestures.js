// Swipe recognition for the study screen on touch devices.
//
// A pure function so the thresholds and the "which axis won" rule can be tested
// without a browser. The component only feeds it the start and end points.
//
//   right -> Good    left -> Again
//   up    -> Easy    down -> Hard
//
// Vertical swipes need a larger travel (and a clearly dominant axis) so a
// normal page scroll is never mistaken for an answer.

export const SWIPE_THRESHOLD = 60;
export const SWIPE_VERTICAL_THRESHOLD = 90;

export function classifySwipe(
  { dx = 0, dy = 0 } = {},
  { threshold = SWIPE_THRESHOLD, verticalThreshold = SWIPE_VERTICAL_THRESHOLD } = {}
) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);

  if (ax >= threshold && ax >= ay) return dx > 0 ? "right" : "left";
  if (ay >= verticalThreshold && ay > ax * 1.5) return dy < 0 ? "up" : "down";
  return null;
}
