import { useEffect, useRef, useState } from "react";
import { uploadMediaBlob } from "../lib/media";
import { peaksFromBlob } from "../lib/waveform";

// Editor for one audio block. Records with MediaRecorder (record / stop /
// replay / re-record), shows a live level meter while recording and a static
// waveform afterwards, enforces a max length, and also accepts an existing
// audio file. The finished clip is uploaded straight to Blob; the block stores
// the URL, mime, size, and a per-card "auto-play when revealed" flag.
//
// Everything browser-specific lives inside effects/handlers, so the component
// still server-renders (the tests render it with renderToString).

const MAX_KEY = "flash.audio.maxSeconds";
const MAX_OPTIONS = [30, 60, 120, 300];
const METER_BARS = 52;

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/mpeg",
];

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return (
    MIME_CANDIDATES.find((type) => {
      try {
        return MediaRecorder.isTypeSupported(type);
      } catch {
        return false;
      }
    }) ?? ""
  );
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// A row of vertical bars for the live meter (recording) or a stored waveform.
function Bars({ values }) {
  if (!values?.length) return null;
  return (
    <div className="flex h-12 items-center gap-0.5" aria-hidden="true">
      {values.map((value, i) => (
        <span
          key={i}
          className="w-1 rounded-full bg-emerald-500"
          style={{ height: `${Math.max(6, Math.round((value ?? 0) * 100))}%` }}
        />
      ))}
    </div>
  );
}

export default function AudioBlockEditor({ block, onChange, onRemove, disabled = false }) {
  // Capability + pref are read once, during the first render. On the server
  // (and in the tests) MediaRecorder / navigator.mediaDevices / localStorage do
  // not exist, so this quietly resolves to "not supported" and the default
  // length - no effect, no hydration-only state.
  const [supported] = useState(
    () =>
      typeof MediaRecorder !== "undefined" &&
      Boolean(globalThis.navigator?.mediaDevices?.getUserMedia)
  );
  const [phase, setPhase] = useState("idle"); // idle | recording | recorded
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [bars, setBars] = useState([]);
  const [peaks, setPeaks] = useState(null);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordedUrl, setRecordedUrl] = useState(null);
  const [maxSeconds, setMaxSeconds] = useState(() => {
    try {
      const saved = Number(globalThis.localStorage?.getItem(MAX_KEY));
      return MAX_OPTIONS.includes(saved) ? saved : 60;
    } catch {
      return 60;
    }
  });

  const fileRef = useRef(null);
  const audioElRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const analyserRef = useRef(null);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(null);
  const timerRef = useRef(null);
  const startedAtRef = useRef(0);
  const lastPaintRef = useRef(0);
  const recordedUrlRef = useRef(null);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      audioCtxRef.current?.close?.();
      audioCtxRef.current = null;
      if (timerRef.current) clearInterval(timerRef.current);
      if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current);
    };
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function stopMeter() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    analyserRef.current = null;
    audioCtxRef.current?.close?.();
    audioCtxRef.current = null;
  }

  function replaceRecordedUrl(next) {
    if (recordedUrlRef.current && recordedUrlRef.current !== next) {
      URL.revokeObjectURL(recordedUrlRef.current);
    }
    recordedUrlRef.current = next;
    setRecordedUrl(next);
  }

  function tickMeter() {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buffer);
    let peak = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const value = Math.abs(buffer[i]);
      if (value > peak) peak = value;
    }
    const now = performance.now();
    if (now - lastPaintRef.current >= 50) {
      lastPaintRef.current = now;
      setBars((prev) => [...prev.slice(-(METER_BARS - 1)), Math.min(1, peak)]);
    }
    rafRef.current = requestAnimationFrame(tickMeter);
  }

  function stopRecording() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        /* already stopping */
      }
    } else {
      stopMeter();
      stopStream();
      setPhase("idle");
    }
  }

  function finalizeRecording() {
    stopMeter();
    stopStream();
    const mimeType = recorderRef.current?.mimeType || "audio/webm";
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];
    recorderRef.current = null;

    if (!blob.size) {
      setPhase("idle");
      setError("Nothing was recorded. Try again.");
      return;
    }
    setRecordedBlob(blob);
    replaceRecordedUrl(URL.createObjectURL(blob));
    setPhase("recorded");
    peaksFromBlob(blob, METER_BARS)
      .then((values) => setPeaks(values))
      .catch(() => setPeaks(null));
  }

  async function startRecording() {
    if (disabled || busy || !supported) return;
    setError(null);
    setPeaks(null);
    setBars([]);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = finalizeRecording;
      recorderRef.current = recorder;

      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        analyserRef.current = analyser;
        tickMeter();
      }

      recorder.start();
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setPhase("recording");
      timerRef.current = setInterval(() => {
        const ms = Date.now() - startedAtRef.current;
        setElapsedMs(ms);
        if (ms >= maxSeconds * 1000) stopRecording();
      }, 200);
    } catch (err) {
      stopMeter();
      stopStream();
      setPhase("idle");
      setError(
        err?.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : "Could not start recording."
      );
    }
  }

  function replay() {
    const el = audioElRef.current;
    if (!el) return;
    el.currentTime = 0;
    el.play?.().catch(() => {});
  }

  function reRecord() {
    replaceRecordedUrl(null);
    setRecordedBlob(null);
    setPeaks(null);
    setBars([]);
    setElapsedMs(0);
    setError(null);
    setPhase("idle");
  }

  async function upload(source, { filename, mime } = {}) {
    if (!source || disabled || busy) return;
    setError(null);
    setBusy(true);
    setProgress(0);
    try {
      const uploaded = await uploadMediaBlob(source, {
        kind: "audio",
        filename,
        mime,
        onProgress: ({ percentage }) => setProgress(Math.round(percentage ?? 0)),
      });
      onChange?.({
        url: uploaded.url,
        pathname: uploaded.pathname,
        mime: uploaded.mime,
        bytes: uploaded.bytes,
        duration_ms: elapsedMs || block?.duration_ms || null,
      });
      setProgress(100);
    } catch (err) {
      setError(err?.message ?? "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  function handleFile(file) {
    if (!file) return;
    if (!String(file.type).startsWith("audio/")) {
      setError("Choose an audio file.");
      return;
    }
    setElapsedMs(0);
    upload(file, { filename: file.name, mime: file.type });
  }

  function changeMax(value) {
    const seconds = Number(value);
    setMaxSeconds(seconds);
    try {
      globalThis.localStorage?.setItem(MAX_KEY, String(seconds));
    } catch {
      /* storage unavailable */
    }
  }

  const saved = Boolean(block?.url);
  const locked = disabled || busy;

  return (
    <div
      role="group"
      aria-label="Audio block"
      className="rounded-xl border border-ink/10 bg-white p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink/40">🔊 Audio</span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            disabled={locked}
            className="text-xs font-semibold text-ink/45 transition hover:text-red-600 disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>

      {/* A saved clip: play it, set auto-play, or record/pick another. */}
      {saved ? (
        <div className="space-y-2">
          <audio ref={audioElRef} controls src={block.url} className="w-full" />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-ink/60">
              <input
                type="checkbox"
                checked={Boolean(block.autoplay)}
                disabled={locked}
                onChange={(e) => onChange?.({ autoplay: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-ink/25 accent-emerald-600"
              />
              Auto-play when revealed
            </label>
            {block.bytes ? (
              <span className="text-xs text-ink/40">{formatBytes(block.bytes)}</span>
            ) : null}
            <button
              type="button"
              onClick={reRecord}
              disabled={locked}
              className="ml-auto rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/75 transition hover:bg-stone-100 disabled:opacity-50"
            >
              Replace
            </button>
          </div>
        </div>
      ) : phase === "recorded" ? (
        <div className="space-y-2">
          {peaks?.length ? (
            <Bars values={peaks} />
          ) : (
            <p className="text-xs text-ink/45">Recorded {formatDuration(elapsedMs)}</p>
          )}
          <audio ref={audioElRef} controls src={recordedUrl ?? undefined} className="w-full" />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={replay}
              className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/75 transition hover:bg-stone-100"
            >
              ▶ Replay
            </button>
            <button
              type="button"
              onClick={reRecord}
              className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/75 transition hover:bg-stone-100"
            >
              ⟲ Re-record
            </button>
            <button
              type="button"
              onClick={() => upload(recordedBlob, { filename: "recording" })}
              disabled={locked}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              Use this recording
            </button>
          </div>
        </div>
      ) : phase === "recording" ? (
        <div className="space-y-2">
          <Bars values={bars.length ? bars : [0.1]} />
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-600">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" />
              {formatDuration(elapsedMs)} / {formatDuration(maxSeconds * 1000)}
            </span>
            <button
              type="button"
              onClick={stopRecording}
              className="ml-auto rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700"
            >
              ■ Stop
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {supported ? (
            <button
              type="button"
              onClick={startRecording}
              disabled={locked}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              ● Record
            </button>
          ) : (
            <p className="text-xs text-ink/45">
              Recording is not supported in this browser - upload an audio file instead.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={locked}
              className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/75 transition hover:bg-stone-100 disabled:opacity-50"
            >
              Upload audio file
            </button>
            <label className="flex items-center gap-1.5 text-xs text-ink/55">
              Max length
              <select
                value={maxSeconds}
                onChange={(e) => changeMax(e.target.value)}
                className="field px-2 py-1 text-xs"
                aria-label="Maximum recording length"
              >
                {MAX_OPTIONS.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {formatDuration(seconds * 1000)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          handleFile(file);
        }}
      />

      {busy && (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-ink/45">Uploading… {progress}%</p>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
