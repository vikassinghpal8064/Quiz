import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import ImageBlockEditor from "../cardTypes/ImageBlockEditor";
import AudioBlockEditor from "../cardTypes/AudioBlockEditor";
import SideViewer from "../cardTypes/SideViewer";

// The media pieces must server-render cleanly even though every browser API
// (canvas, MediaRecorder, AudioContext) lives inside effects/handlers. Effects
// do not run under renderToString, so this exercises the idle markup.
const image = { type: "image", url: "https://blob.example/x.webp", alt: "A cell" };
const audio = { type: "audio", url: "https://blob.example/x.webm", autoplay: true };

describe("media block editor", () => {
  it("renders an empty image uploader", () => {
    const html = renderToString(
      <ImageBlockEditor
        block={{ type: "image", url: "" }}
        onChange={() => {}}
        onRemove={() => {}}
      />
    );
    expect(html).toContain("Choose image");
    expect(html).toContain("Camera");
  });

  it("renders a saved image with alt text", () => {
    const html = renderToString(<ImageBlockEditor block={image} onChange={() => {}} />);
    expect(html).toContain("blob.example/x.webp");
    expect(html).toContain("A cell");
  });

  it("renders the audio recorder controls", () => {
    const html = renderToString(
      <AudioBlockEditor
        block={{ type: "audio", url: "" }}
        onChange={() => {}}
        onRemove={() => {}}
      />
    );
    expect(html).toContain("Upload audio file");
    expect(html).toContain("Max length");
  });

  it("renders a saved audio clip with its auto-play toggle", () => {
    const html = renderToString(<AudioBlockEditor block={audio} onChange={() => {}} />);
    expect(html).toContain("blob.example/x.webm");
    expect(html).toContain("Auto-play when revealed");
  });
});

describe("SideViewer media", () => {
  it("renders an image with a zoom affordance", () => {
    const html = renderToString(<SideViewer side={{ blocks: [image] }} />);
    expect(html).toContain("Zoom image");
    expect(html).toContain("blob.example/x.webp");
  });

  it("renders audio with native controls", () => {
    const html = renderToString(<SideViewer side={{ blocks: [audio] }} />);
    expect(html).toContain("<audio");
    expect(html).toContain("blob.example/x.webm");
  });
});
