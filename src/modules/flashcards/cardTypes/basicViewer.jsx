import SideViewer from "./SideViewer";

// Basic / basic-reversed viewer: renders whichever face the shell asks for.
// `autoPlay` lets a study shell say "this face was just revealed", which lets an
// audio block whose per-card auto-play flag is set start playing (see
// SideViewer). It defaults off, so previews stay silent.
export default function BasicViewer({ card, face, autoPlay = false }) {
  return <SideViewer side={card?.[face]} autoPlay={autoPlay} />;
}
