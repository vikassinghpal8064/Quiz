// OCR via tesseract.js, loaded lazily so the ~2 MB engine (and its language
// data, fetched from the CDN on first use) never lands in the main bundle.
//
// One worker is created per language and reused across every block in the run;
// tesseract workers are expensive to spin up and cheap to reuse.

const workers = new Map();

export const DEFAULT_OCR_LANG = "eng";

async function getWorker(lang) {
  if (!workers.has(lang)) {
    workers.set(
      lang,
      (async () => {
        const { createWorker } = await import("tesseract.js");
        return createWorker(lang);
      })()
    );
  }
  return workers.get(lang);
}

export async function ocrCanvas(canvas, { lang = DEFAULT_OCR_LANG } = {}) {
  const worker = await getWorker(lang);
  const { data } = await worker.recognize(canvas);
  return {
    text: (data?.text ?? "").replace(/\s+/g, " ").trim(),
    confidence: typeof data?.confidence === "number" ? data.confidence : null,
  };
}

export async function terminateWorkers() {
  const pending = [...workers.values()];
  workers.clear();
  await Promise.all(pending.map((p) => p.then((worker) => worker.terminate?.()).catch(() => {})));
}
