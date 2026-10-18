import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Toast from "../../../components/Toast";
import Icon from "../../../components/Icon";
import useToast from "../hooks/useToast";
import {
  bulkCreateCards,
  createCategory,
  createFolder,
  createImportJob,
  getDuplicateSignatures,
  getCategory,
  listCategories,
  listFolders,
  updateImportJob,
} from "../lib/api";
import { buildCandidates, delimiterLabel, PREVIEW_ROWS } from "../importers/csv";
import { loadCandidates as loadQuizCandidates } from "../importers/quizBridge";
import * as quizApi from "../importers/quizApi";
import { listImporters } from "../importers/registry";
import {
  DUPLICATE_BATCH,
  DUPLICATE_EXISTING,
  groupCandidates,
  markDuplicates,
  progressOf,
  summarise,
  toBatches,
} from "../importers/plan";
import {
  isImportable,
  setCandidateApproved,
  setCandidateSideText,
  setCandidateTags,
  setCandidateText,
} from "../importers/candidate";
import WizardSteps from "../components/import/WizardSteps";
import CategoryModal from "../components/CategoryModal";
import NewFolderModal from "../components/NewFolderModal";
import { comparisonOf, formatBytes } from "../lib/imageProcessing";

// /flash/import - a six-step wizard for bringing cards in.
//
//   1 Source    pick a CSV/TSV file (or paste one) or bridge from the quiz app
//   2 Target    choose the folder + category, or create them here
//   3 Preview   parse, map the columns, see the first rows and the duplicates
//   4 Review    edit and tick the cards you actually want
//   5 Import    POST them in batches of 200, recording progress in fc_import_jobs
//   6 Summary   what landed, what was skipped, and anything that failed
//
// All the parsing, duplicate marking, grouping and batching is pure and lives
// in src/modules/flashcards/importers/; this file is the state machine and the
// controls around it. The target may be preselected with ?folderId=&categoryId=,
// which is how the "Import" button on a category page links here.

const STEPS = [
  { id: 1, label: "Source" },
  { id: 2, label: "Target" },
  { id: 3, label: "Preview" },
  { id: 4, label: "Review" },
  { id: 5, label: "Import" },
  { id: 6, label: "Summary" },
];

const DELIMITER_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "\t", label: "Tab" },
  { value: ",", label: "Comma" },
  { value: ";", label: "Semicolon" },
];

const HEADER_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "yes", label: "First row is a header" },
  { value: "no", label: "No header" },
];

const PREVIEW_ERROR_ROWS = 6;

// A stable empty array so `categories` keeps its identity between renders while
// a folder's categories are still loading.
const EMPTY_CATEGORIES = [];

const NO_COLUMN = -1;

function delimiterFor(mode) {
  return mode === "auto" ? undefined : mode;
}

function optionFor(mode) {
  return mode === "auto" ? undefined : mode === "yes";
}

function badgeClass(kind) {
  if (kind === "error") return "bg-red-100 text-red-700";
  if (kind === "duplicate") return "bg-amber-100 text-amber-800";
  if (kind === "warning") return "bg-sky-100 text-sky-800";
  return "bg-stone-100 text-ink/60";
}

function firstBlock(side) {
  return side?.blocks?.[0] ?? null;
}

function candidateLabel(candidate) {
  const block = firstBlock(candidate?.front);
  if (!block) return "card";
  if (block.type === "image") return "image card";
  if (block.type === "audio") return "audio card";
  if (block.type === "ink") return "handwriting card";
  const text = block.text?.trim();
  return text ? text.slice(0, 60) : "card";
}

// A review image with its compressed size, and - when the original bytes were
// kept - a toggle between the original and the compressed upload.
//
// The original object URL is created lazily on the first click (never during
// render) and revoked on unmount, so a long review list never pins every
// original in memory.
function CompareImage({ block, label }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [originalSrc, setOriginalSrc] = useState(block?._originalUrl ?? null);
  const originalBytes = Number(block?._originalBytes);
  const compressedBytes = Number(block?.bytes);
  const hasOriginal = Boolean(block?._originalFile) || Boolean(block?._originalUrl);
  const canCompare = hasOriginal && Number.isFinite(originalBytes) && originalBytes > 0;
  const showingOriginal = canCompare && showOriginal;
  const saving = comparisonOf({ originalBytes, bytes: compressedBytes });

  // Revoke a blob URL we created once it is replaced or the row unmounts; a
  // server-supplied _originalUrl is left alone.
  useEffect(
    () => () => {
      if (typeof originalSrc === "string" && originalSrc.startsWith("blob:")) {
        URL.revokeObjectURL(originalSrc);
      }
    },
    [originalSrc]
  );

  function toggle() {
    if (!showingOriginal && !originalSrc && block?._originalFile) {
      setOriginalSrc(URL.createObjectURL(block._originalFile));
    }
    setShowOriginal((v) => !v);
  }

  const shownBytes = showingOriginal ? originalBytes : compressedBytes;

  return (
    <div className="space-y-1">
      <img src={showingOriginal ? originalSrc : block.url} alt={label} className="mx-auto max-h-52 rounded" />
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[10px] text-ink/45">
        {canCompare && (
          <span className="font-semibold uppercase tracking-wide text-ink/50">
            {showingOriginal ? "Original" : "Compressed"}
          </span>
        )}
        {Number.isFinite(shownBytes) && <span>{formatBytes(shownBytes)}</span>}
        {!showingOriginal && saving && saving.savedRatio > 0 && (
          <span className="text-emerald-600">· {saving.label}</span>
        )}
        {canCompare && (
          <button type="button" onClick={toggle} className="font-semibold text-emerald-700 hover:underline">
            {showingOriginal ? "Show compressed" : "Compare original"}
          </button>
        )}
      </div>
    </div>
  );
}

// ReviewStep shows a media block as a preview (with a way back to a text side)
// and anything else as an editable textarea. PDF imports produce image sides;
// APKG imports can produce a side that holds *both* text and an image, so a
// media side also keeps an editable caption for its text block; CSV and quiz
// imports produce text sides.
function MediaPreview({ block, label }) {
  if (block.type === "image" && block.url) {
    return <CompareImage block={block} label={label} />;
  }
  if (block.type === "audio" && block.url) return <audio controls src={block.url} className="w-full" />;
  if (block.type === "ink" && block.preview?.url) {
    return <img src={block.preview.url} alt={label} className="mx-auto max-h-52 rounded" />;
  }
  return null;
}

function ReviewField({ label, side, onChange, onClear }) {
  const blocks = side?.blocks ?? [];
  const media = blocks.filter((b) => b && (b.type === "image" || b.type === "audio" || b.type === "ink"));
  const textBlock = blocks.find((b) => b?.type === "text");

  if (media.length > 0) {
    return (
      <div className="rounded-lg border border-ink/10 bg-stone-50 p-2">
        <div className="space-y-2">
          {media.map((block, i) => (
            <MediaPreview key={i} block={block} label={label} />
          ))}
        </div>
        {textBlock && (
          <textarea
            value={textBlock.text ?? ""}
            onChange={(e) => onChange(e.target.value)}
            rows={2}
            placeholder={label}
            className="field mt-2 w-full resize-y px-2.5 py-1.5 text-sm"
          />
        )}
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-ink/40">
            {label} · {media.length > 1 ? `${media.length} media` : media[0].type}
          </span>
          <button type="button" onClick={onClear} className="text-[10px] font-semibold text-red-600 hover:underline">
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <textarea
      value={textBlock?.text ?? ""}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
      placeholder={label}
      className="field w-full resize-y px-2.5 py-1.5 text-sm"
    />
  );
}

export default function ImportPage() {
  const [params] = useSearchParams();
  const { toasts, notify, dismiss } = useToast();

  const initialFolder = params.get("folderId") ?? "";
  const initialCategory = params.get("categoryId") ?? "";

  const [step, setStep] = useState(1);

  // ---- step 1: source ----
  const [importerId, setImporterId] = useState("csv");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState(null);
  const [delimiterMode, setDelimiterMode] = useState("auto");
  const [headerMode, setHeaderMode] = useState("auto");
  const [mappingOverride, setMappingOverride] = useState({
    front: null,
    back: null,
    tags: null,
    category: null,
  });

  const [quizSubjects, setQuizSubjects] = useState(null); // null = loading
  const [quizCategories, setQuizCategories] = useState(null);
  const [quizSubjectId, setQuizSubjectId] = useState("");
  const [quizCategoryId, setQuizCategoryId] = useState("");
  const [wrongOnly, setWrongOnly] = useState(false);
  const [quizError, setQuizError] = useState(null);

  // PDF / page-image / .apkg source (handled interactively by the importer's
  // View, which renders in step 3).
  const [sourceFiles, setSourceFiles] = useState([]);

  // ---- step 2: target ----
  const [folders, setFolders] = useState(null); // null = loading
  const [cat, setCat] = useState(null); // { folderId, rows }
  const [folderId, setFolderId] = useState(initialFolder);
  const [categoryId, setCategoryId] = useState(initialCategory);
  const [loadError, setLoadError] = useState(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);

  // ---- step 3/4: parsed cards ----
  const [previewCandidates, setPreviewCandidates] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [quizMeta, setQuizMeta] = useState(null);
  const [existingSignatures, setExistingSignatures] = useState([]);
  const [candidates, setCandidates] = useState([]);

  // ---- step 5/6: the run ----
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(progressOf(0, 0));
  const [summary, setSummary] = useState(null);

  const fileInputRef = useRef(null);
  const sourceFileInputRef = useRef(null);

  const importers = useMemo(() => listImporters(), []);
  const activeImporter = importers.find((i) => i.id === importerId) ?? importers[0];
  // An "interactive" importer (PDF, and later .apkg) renders its own View in
  // place of the preview table and produces candidates itself.
  const interactiveSource = Boolean(activeImporter?.interactive && activeImporter?.View);

  // ---------- folders (once) ----------
  useEffect(() => {
    let cancelled = false;
    listFolders()
      .then(async (rows) => {
        if (cancelled) return;
        setFolders(rows);
        if (initialFolder && rows.some((f) => String(f.id) === String(initialFolder))) {
          setFolderId(String(initialFolder));
        } else if (initialCategory) {
          const found = await getCategory(initialCategory).catch(() => null);
          if (!cancelled && found?.folder_id) setFolderId(String(found.folder_id));
        } else if (rows[0]) {
          setFolderId(String(rows[0].id));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err.message);
          setFolders([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [initialCategory, initialFolder]);

  // ---------- categories for the chosen folder ----------
  useEffect(() => {
    if (!folderId) return undefined;
    let cancelled = false;
    listCategories(folderId)
      .then((rows) => {
        if (!cancelled) setCat({ folderId, rows });
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [folderId]);

  const loadingFolders = folders === null;
  const loadingCategories = Boolean(folderId) && (!cat || String(cat.folderId) !== String(folderId));
  const categories = cat && String(cat.folderId) === String(folderId) ? cat.rows : EMPTY_CATEGORIES;
  const targetCategory = categories.find((c) => String(c.id) === String(categoryId)) ?? null;

  // Keep the selected category valid for the folder that is now loaded.
  useEffect(() => {
    if (!categoryId) return;
    if (loadingCategories) return;
    if (!categories.some((c) => String(c.id) === String(categoryId))) setCategoryId("");
  }, [categories, categoryId, loadingCategories]);

  // ---------- quiz source lists ----------
  useEffect(() => {
    if (importerId !== "quiz") return undefined;
    let cancelled = false;
    setQuizSubjects(null);
    quizApi
      .listQuizSubjects()
      .then((rows) => {
        if (cancelled) return;
        setQuizSubjects(rows);
        if (rows[0]) setQuizSubjectId(String(rows[0].id));
      })
      .catch((err) => {
        if (cancelled) return;
        setQuizError(err.message);
        setQuizSubjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, [importerId]);

  useEffect(() => {
    if (!quizSubjectId) {
      setQuizCategories(null);
      return undefined;
    }
    let cancelled = false;
    setQuizCategories(null);
    quizApi
      .listQuizCategories(quizSubjectId)
      .then((rows) => {
        if (cancelled) return;
        setQuizCategories(rows);
        setQuizCategoryId(rows[0] ? String(rows[0].id) : "");
      })
      .catch((err) => {
        if (cancelled) return;
        setQuizError(err.message);
        setQuizCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [quizSubjectId]);

  // ---------- parse the chosen source ----------
  // CSV is synchronous and pure; the quiz bridge has to read the quiz tables.
  const csvResult = useMemo(() => {
    if (importerId !== "csv") return null;
    return buildCandidates(csvText, {
      delimiter: delimiterFor(delimiterMode),
      header: optionFor(headerMode),
      frontColumn: mappingOverride.front ?? undefined,
      backColumn: mappingOverride.back ?? undefined,
      tagsColumn: mappingOverride.tags ?? undefined,
      categoryColumn: mappingOverride.category ?? undefined,
    });
  }, [importerId, csvText, delimiterMode, headerMode, mappingOverride]);

  useEffect(() => {
    if (importerId !== "quiz") return undefined;
    if (!quizCategoryId) {
      setPreviewCandidates([]);
      setPreviewError(null);
      setQuizMeta(null);
      return undefined;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    loadQuizCandidates({ categoryId: quizCategoryId, wrongOnly })
      .then((res) => {
        if (cancelled) return;
        setPreviewCandidates(res.candidates);
        setQuizMeta(res);
      })
      .catch((err) => {
        if (cancelled) return;
        setPreviewError(err.message);
        setPreviewCandidates([]);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [importerId, quizCategoryId, wrongOnly]);

  const csvCandidates = csvResult?.candidates ?? [];
  const inspected = csvResult?.inspected ?? null;
  const activeCandidates = importerId === "quiz" ? previewCandidates : csvCandidates;

  // Duplicate detection only needs the target category, so it is fetched once
  // the wizard reaches the preview step and re-used for the rest of the run.
  useEffect(() => {
    if (step < 3 || !categoryId) return undefined;
    let cancelled = false;
    getDuplicateSignatures(categoryId)
      .then((res) => {
        if (!cancelled) setExistingSignatures(res.signatures ?? []);
      })
      .catch(() => {
        // Duplicate detection is a convenience; a failure must not block the
        // import, it just means nothing gets flagged.
        if (!cancelled) setExistingSignatures([]);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryId, step]);

  // Preview-only duplicate marking. The real, editable list is produced when
  // the user continues to the review step, so re-rendering never clobbers a
  // tick they have changed.
  const previewed = useMemo(
    () => markDuplicates(activeCandidates, existingSignatures),
    [activeCandidates, existingSignatures]
  );

  const stats = summarise(candidates);
  const previewStats = summarise(previewed);

  const columnChoices = useMemo(() => {
    const width = Math.max(
      inspected?.headers?.length ?? 0,
      ...(inspected?.rows ?? []).slice(0, PREVIEW_ROWS).map((row) => row.cells.length),
      0
    );
    const choices = [];
    for (let i = 0; i < width; i += 1) {
      const name = inspected?.headers?.[i];
      choices.push({ value: i, label: `${i + 1}${name ? ` \u00b7 ${name}` : ""}` });
    }
    return choices;
  }, [inspected]);

  const categoryColumnMapped = inspected?.columns?.category >= 0;

  // ---------- step 1 -> 2 ----------
  const canLeaveSource =
    importerId === "csv"
      ? csvText.trim().length > 0
      : interactiveSource
        ? sourceFiles.length > 0
        : Boolean(quizCategoryId);
  // ---------- step 2 -> 3 ----------
  const canLeaveTarget = Boolean(categoryId);

  function chooseImporter(id) {
    if (id !== importerId) setSourceFiles([]);
    setImporterId(id);
    setPreviewError(null);
    setQuizMeta(null);
  }

  async function loadFile(event) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    try {
      const content = await file.text();
      setCsvText(content);
      setFileName(file.name);
      // A new file gets a fresh guess at the mapping.
      setMappingOverride({ front: null, back: null, tags: null, category: null });
    } catch {
      notify("Could not read that file.", "error");
    }
  }

  function setMappedColumn(field, value) {
    setMappingOverride((prev) => ({ ...prev, [field]: value === NO_COLUMN ? null : Number(value) }));
  }

  function loadSourceFiles(event) {
    const files = [...(event.target.files ?? [])];
    event.target.value = ""; // allow re-selecting the same file
    if (!files.length) return;
    setSourceFiles(files);
    setFileName(files.length === 1 ? files[0].name : `${files.length} page images`);
  }

  function continueToReview() {
    setCandidates(markDuplicates(activeCandidates, existingSignatures));
    setStep(4);
  }

  // The interactive PDF view hands back finished candidates (images already
  // uploaded). They join the same review/import pipeline as CSV rows.
  function continueFromInteractive(nextCandidates) {
    setCandidates(markDuplicates(nextCandidates, existingSignatures));
    setStep(4);
  }

  // ---------- step 4: editing ----------
  function patchCandidate(key, updater) {
    setCandidates((list) => list.map((candidate) => (candidate.key === key ? updater(candidate) : candidate)));
  }

  function setAllApproved(approved) {
    setCandidates((list) => list.map((c) => (c.errors.length ? c : setCandidateApproved(c, approved))));
  }

  function excludeDuplicates() {
    setCandidates((list) => list.map((c) => (c.duplicate ? setCandidateApproved(c, false) : c)));
  }

  // ---------- step 5: the run ----------
  // Create any categories named by a mapped CSV category column, so the batches
  // always have a real target id.
  async function resolveGroups(groups) {
    const resolved = [];
    for (const group of groups) {
      if (group.categoryId != null) {
        resolved.push(group);
        continue;
      }
      const created = await createCategory({ name: group.name, folder_id: Number(folderId) });
      setCat((prev) =>
        prev && String(prev.folderId) === String(folderId)
          ? { ...prev, rows: [...prev.rows, created] }
          : prev
      );
      resolved.push({ ...group, categoryId: created.id });
    }
    return resolved;
  }

  async function runImport() {
    const importable = candidates.filter(isImportable);
    if (!importable.length) return;

    setStep(5);
    setRunning(true);
    setSummary(null);
    setProgress(progressOf(0, importable.length));

    const runErrors = [];
    let inserted = 0;
    let job = null;

    try {
      job = await createImportJob({
        source_type: activeImporter.id,
        filename: fileName,
        category_id: Number(categoryId),
        total: importable.length,
      });
    } catch (err) {
      // Losing the job record must not lose the cards: carry on and report it.
      runErrors.push(`Could not open an import job: ${err.message}`);
    }

    try {
      const groups = groupCandidates(importable, {
        targetCategoryId: Number(categoryId),
        categories,
      });
      const resolved = await resolveGroups(groups);
      const batches = toBatches(resolved);

      for (const batch of batches) {
        try {
          const res = await bulkCreateCards(batch.cards, batch.categoryId);
          inserted += res.inserted ?? batch.cards.length;
        } catch (err) {
          // Each batch is its own transaction, so earlier batches already
          // landed. Record the failure and keep going.
          runErrors.push(`Batch of ${batch.size}: ${err.message}`);
        }
        setProgress(progressOf(inserted, importable.length));
        if (job) {
          await updateImportJob(job.id, {
            status: "running",
            created: inserted,
            error_log: runErrors,
          }).catch(() => {});
        }
      }
    } catch (err) {
      runErrors.push(err.message);
    }

    if (job) {
      await updateImportJob(job.id, {
        status: runErrors.length ? "failed" : "done",
        created: inserted,
        error_log: runErrors,
      }).catch(() => {});
    }

    setSummary({
      inserted,
      total: candidates.length,
      skipped: candidates.length - importable.length,
      errors: runErrors,
      jobId: job?.id ?? null,
    });
    setRunning(false);
    setStep(6);
  }

  function startOver() {
    setStep(1);
    setCsvText("");
    setFileName(null);
    setDelimiterMode("auto");
    setHeaderMode("auto");
    setMappingOverride({ front: null, back: null, tags: null, category: null });
    setWrongOnly(false);
    setSourceFiles([]);
    setPreviewCandidates([]);
    setPreviewError(null);
    setQuizMeta(null);
    setCandidates([]);
    setExistingSignatures([]);
    setSummary(null);
    setProgress(progressOf(0, 0));
  }

  const loadingSource = importerId === "quiz" && previewLoading;
  const canContinue =
    step === 1
      ? canLeaveSource
      : step === 2
        ? canLeaveTarget
        : step === 3
          ? activeCandidates.length > 0 && !loadingSource
          : step === 4
            ? stats.importable > 0
            : false;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <Link to="/flash" className="inline-flex items-center gap-1 text-sm font-medium text-ink/50 transition hover:text-ink">
          <Icon name="chevron-left" size={16} />
          Flash Cards
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">
          Import Cards
        </h1>
        <p className="mt-1 text-sm text-ink/55">
          Bring cards in from a spreadsheet, a PDF, page images or an Anki deck, or bridge them
          across from the quiz app.
        </p>
      </div>

      <WizardSteps steps={STEPS} current={step} />

      {loadError && (
        <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </p>
      )}

      {/* ============================ 1. SOURCE ============================ */}
      {step === 1 && (
        <section className="card mt-5 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">Source</h2>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {importers.map((importer) => (
              <button
                key={importer.id}
                type="button"
                onClick={() => chooseImporter(importer.id)}
                aria-pressed={importer.id === importerId}
                className={`rounded-xl border p-4 text-left transition ${
                  importer.id === importerId
                    ? "border-lavender bg-lavender/10 ring-2 ring-lavender/40"
                    : "border-ink/10 bg-white hover:bg-stone-50"
                }`}
              >
                <span className="block font-semibold text-ink">{importer.label}</span>
                <span className="mt-1 block text-xs text-ink/55">
                  {importer.id === "csv"
                    ? "A CSV or TSV file, or rows pasted straight in."
                    : importer.id === "pdf"
                      ? "A PDF, or page images. Crop, pair and highlight-extract in the browser."
                      : importer.id === "apkg"
                        ? "An Anki .apkg export. Unzipped and mapped to fields in the browser."
                        : "Read-only import of questions you already have in the quiz app."}
                </span>
              </button>
            ))}
          </div>

          {importerId === "csv" && (
            <div className="mt-5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/75 transition hover:bg-stone-100"
                >
                  Choose file…
                </button>
                {csvText && (
                  <button
                    type="button"
                    onClick={() => {
                      setCsvText("");
                      setFileName(null);
                      setMappingOverride({ front: null, back: null, tags: null, category: null });
                    }}
                    className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/60 transition hover:bg-stone-100"
                  >
                    Clear
                  </button>
                )}
                {fileName && <span className="text-xs text-ink/50">{fileName}</span>}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                onChange={loadFile}
                className="hidden"
              />

              <textarea
                value={csvText}
                onChange={(e) => {
                  setCsvText(e.target.value);
                  setFileName(null);
                  setMappingOverride({ front: null, back: null, tags: null, category: null });
                }}
                rows={8}
                spellCheck={false}
                placeholder={"Question,Answer,Tags\nWhat is 2+2?,4,math\nCapital of France,Paris,geo"}
                className="field mt-3 w-full resize-y px-3 py-2.5 font-mono text-xs leading-relaxed"
              />
            </div>
          )}

          {importerId === "pdf" && (
            <div className="mt-5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => sourceFileInputRef.current?.click()}
                  className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/75 transition hover:bg-stone-100"
                >
                  Choose PDF or images…
                </button>
                {sourceFiles.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSourceFiles([]);
                      setFileName(null);
                    }}
                    className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/60 transition hover:bg-stone-100"
                  >
                    Clear
                  </button>
                )}
                {sourceFiles.length > 0 && (
                  <span className="text-xs text-ink/50">
                    {sourceFiles.length === 1 ? sourceFiles[0].name : `${sourceFiles.length} images`}
                  </span>
                )}
              </div>

              <input
                ref={sourceFileInputRef}
                type="file"
                multiple
                accept=".pdf,application/pdf,image/png,image/jpeg,image/webp,image/gif,image/avif"
                onChange={loadSourceFiles}
                className="hidden"
              />

              <p className="mt-3 text-xs text-ink/50">
                Pick one PDF, or the page images (PNG/JPG/WebP) that make up a document. Everything is
                rendered in your browser with pdf.js; only the cropped images you keep are uploaded.
              </p>
            </div>
          )}

          {importerId === "apkg" && (
            <div className="mt-5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => sourceFileInputRef.current?.click()}
                  className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/75 transition hover:bg-stone-100"
                >
                  Choose Anki deck…
                </button>
                {sourceFiles.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSourceFiles([]);
                      setFileName(null);
                    }}
                    className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/60 transition hover:bg-stone-100"
                  >
                    Clear
                  </button>
                )}
                {sourceFiles.length > 0 && (
                  <span className="text-xs text-ink/50">{sourceFiles[0].name}</span>
                )}
              </div>

              <input
                ref={sourceFileInputRef}
                type="file"
                accept=".apkg,application/octet-stream"
                onChange={loadSourceFiles}
                className="hidden"
              />

              <p className="mt-3 text-xs text-ink/50">
                Pick an Anki <code className="font-mono">.apkg</code> export. The deck is unzipped and
                read in your browser; only the images you keep are uploaded.
              </p>
            </div>
          )}

          {importerId === "quiz" && (
            <div className="mt-5">
              {quizError && (
                <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {quizError}
                </p>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-ink/70">
                  Subject
                  <select
                    value={quizSubjectId}
                    disabled={quizSubjects === null}
                    onChange={(e) => setQuizSubjectId(e.target.value)}
                    className="field mt-1 w-full px-3 py-2.5 text-sm disabled:opacity-50"
                  >
                    {quizSubjects === null && <option>Loading…</option>}
                    {quizSubjects?.length === 0 && <option value="">No subjects yet</option>}
                    {(quizSubjects ?? []).map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm font-medium text-ink/70">
                  Quiz category
                  <select
                    value={quizCategoryId}
                    disabled={quizCategories === null || !quizSubjectId}
                    onChange={(e) => setQuizCategoryId(e.target.value)}
                    className="field mt-1 w-full px-3 py-2.5 text-sm disabled:opacity-50"
                  >
                    {quizCategories === null && <option>Loading…</option>}
                    {quizCategories?.length === 0 && <option value="">No categories yet</option>}
                    {(quizCategories ?? []).map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name} ({category.question_count ?? 0})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="mt-3 flex items-center gap-2 text-sm text-ink/70">
                <input
                  type="checkbox"
                  checked={wrongOnly}
                  onChange={(e) => setWrongOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-ink/20"
                />
                Only questions I have answered wrongly before
              </label>

              <p className="mt-3 text-xs text-ink/50">
                Read-only: nothing in the quiz app is changed. Each question becomes a basic card with
                the correct answer and explanation on the back.
              </p>
            </div>
          )}
        </section>
      )}

      {/* ============================ 2. TARGET ============================ */}
      {step === 2 && (
        <section className="card mt-5 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">Target</h2>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-ink/70">
                Folder
                <select
                  value={folderId}
                  disabled={loadingFolders}
                  onChange={(e) => setFolderId(e.target.value)}
                  className="field mt-1 w-full px-3 py-2.5 text-sm disabled:opacity-50"
                >
                  {loadingFolders && <option>Loading…</option>}
                  {!loadingFolders && folders.length === 0 && <option value="">No folders yet</option>}
                  {(folders ?? []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setCreatingFolder(true)}
                className="mt-2 text-xs font-semibold text-lavender-soft hover:underline"
              >
                + New folder
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-ink/70">
                Category
                <select
                  value={categoryId}
                  disabled={loadingCategories || !folderId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="field mt-1 w-full px-3 py-2.5 text-sm disabled:opacity-50"
                >
                  <option value="">{loadingCategories ? "Loading…" : "Select a category"}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.card_count ?? 0})
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setCreatingCategory(true)}
                disabled={!folderId}
                className="mt-2 text-xs font-semibold text-lavender-soft hover:underline disabled:opacity-40"
              >
                + New category
              </button>
            </div>
          </div>

          {!loadingFolders && folders.length === 0 && (
            <p className="mt-3 text-sm text-ink/55">
              You need a folder and category first.{" "}
              <Link to="/flash" className="font-semibold text-lavender-soft hover:underline">
                Create one
              </Link>
              .
            </p>
          )}

          {targetCategory && (
            <p className="mt-4 text-sm text-ink/60">
              Cards will go into <span className="font-semibold text-ink">{targetCategory.name}</span>.
            </p>
          )}
        </section>
      )}

      {/* ==================== 3. CONFIGURE (interactive) ==================== */}
      {step === 3 && interactiveSource && (
        <Suspense
          fallback={
            <div className="card mt-5 p-5">
              <p className="text-sm text-ink/55">Loading the importer…</p>
            </div>
          }
        >
          <activeImporter.View
            files={sourceFiles}
            targetCategoryId={categoryId ? Number(categoryId) : null}
            notify={notify}
            onContinue={continueFromInteractive}
          />
        </Suspense>
      )}

      {/* ============================ 3. PREVIEW ============================ */}
      {step === 3 && !interactiveSource && (
        <section className="card mt-5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">Preview</h2>
            <p className="text-sm text-ink/60">
              <span className="font-semibold text-ink">{previewStats.importable}</span> ready
              {previewStats.duplicates > 0 && (
                <span className="text-amber-600"> · {previewStats.duplicates} duplicates</span>
              )}
              {previewStats.invalid > 0 && (
                <span className="text-red-600"> · {previewStats.invalid} incomplete</span>
              )}
            </p>
          </div>

          {importerId === "csv" && inspected && (
            <div className="mt-3 flex flex-wrap gap-4">
              <label className="text-xs font-medium text-ink/60">
                Delimiter
                <select
                  value={delimiterMode}
                  onChange={(e) => setDelimiterMode(e.target.value)}
                  className="field mt-1 block px-2 py-1.5 text-xs"
                >
                  {DELIMITER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                      {o.value === "auto" ? ` (${delimiterLabel(inspected.delimiter)})` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-medium text-ink/60">
                Header
                <select
                  value={headerMode}
                  onChange={(e) => setHeaderMode(e.target.value)}
                  className="field mt-1 block px-2 py-1.5 text-xs"
                >
                  {HEADER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                      {o.value === "auto" && !inspected.guessedHeader ? " (none found)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {importerId === "csv" && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-ink/60">
                Front column
                <select
                  value={inspected?.columns?.front ?? 0}
                  onChange={(e) => setMappedColumn("front", e.target.value)}
                  className="field mt-1 block w-full px-2 py-1.5 text-xs"
                >
                  {columnChoices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs font-medium text-ink/60">
                Back column
                <select
                  value={inspected?.columns?.back ?? 1}
                  onChange={(e) => setMappedColumn("back", e.target.value)}
                  className="field mt-1 block w-full px-2 py-1.5 text-xs"
                >
                  {columnChoices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs font-medium text-ink/60">
                Tags column
                <select
                  value={inspected?.columns?.tags ?? NO_COLUMN}
                  onChange={(e) => setMappedColumn("tags", e.target.value)}
                  className="field mt-1 block w-full px-2 py-1.5 text-xs"
                >
                  <option value={NO_COLUMN}>— none —</option>
                  {columnChoices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs font-medium text-ink/60">
                Category column
                <select
                  value={inspected?.columns?.category ?? NO_COLUMN}
                  onChange={(e) => setMappedColumn("category", e.target.value)}
                  className="field mt-1 block w-full px-2 py-1.5 text-xs"
                >
                  <option value={NO_COLUMN}>— none —</option>
                  {columnChoices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>

              <p className="text-xs text-ink/50 sm:col-span-2">
                {categoryColumnMapped
                  ? "Rows will be grouped by the category column; new category names are created in the target folder."
                  : "Every card will go into the category chosen in step 2."}
              </p>
            </div>
          )}

          {previewError && (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {previewError}
            </p>
          )}

          {loadingSource && <p className="mt-3 text-sm text-ink/55">Reading the quiz app…</p>}

          {previewed.length === 0 && !loadingSource && !previewError && (
            <p className="mt-3 text-sm text-ink/55">No rows detected.</p>
          )}

          {previewed.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/45">
                    <th className="px-2 py-2">{importerId === "csv" ? "Line" : "Question"}</th>
                    <th className="px-2 py-2">Front</th>
                    <th className="px-2 py-2">Back</th>
                    {categoryColumnMapped && <th className="px-2 py-2">Category</th>}
                    <th className="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {previewed.slice(0, PREVIEW_ROWS).map((candidate) => (
                    <tr
                      key={candidate.key}
                      className={`border-b border-ink/5 ${
                        candidate.errors.length ? "bg-red-50/70" : ""
                      }`}
                    >
                      <td className="px-2 py-2 text-xs text-ink/40">
                        {candidate.key.replace(/^row-|^question-/, "")}
                      </td>
                      <td className="max-w-xs truncate px-2 py-2 text-ink">
                        {candidate.front.blocks[0].text || "—"}
                      </td>
                      <td className="max-w-xs truncate px-2 py-2 text-ink/80">
                        {candidate.back.blocks[0].text || "—"}
                      </td>
                      {categoryColumnMapped && (
                        <td className="px-2 py-2 text-xs text-ink/60">{candidate.categoryName ?? "—"}</td>
                      )}
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1">
                          {candidate.errors.length > 0 && (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClass("error")}`}>
                              {candidate.errors[0]}
                            </span>
                          )}
                          {candidate.duplicate && (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClass("duplicate")}`}>
                              {candidate.duplicate === DUPLICATE_EXISTING ? "already in category" : "repeated below"}
                            </span>
                          )}
                          {!candidate.errors.length && !candidate.duplicate && (
                            <span className="text-[10px] text-ink/40">ready</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {previewed.length > PREVIEW_ROWS && (
                <p className="mt-2 text-xs text-ink/45">
                  Showing the first {PREVIEW_ROWS} of {previewed.length} rows.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* ============================ 4. REVIEW ============================ */}
      {step === 4 && (
        <section className="card mt-5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">Review</h2>
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setAllApproved(true)}
                className="rounded-lg border border-ink/15 bg-white px-2.5 py-1 font-semibold text-ink/70 transition hover:bg-stone-100"
              >
                Tick all
              </button>
              <button
                type="button"
                onClick={() => setAllApproved(false)}
                className="rounded-lg border border-ink/15 bg-white px-2.5 py-1 font-semibold text-ink/70 transition hover:bg-stone-100"
              >
                Untick all
              </button>
              {previewStats.duplicates > 0 && (
                <button
                  type="button"
                  onClick={excludeDuplicates}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 font-semibold text-amber-800 transition hover:bg-amber-100"
                >
                  Skip duplicates
                </button>
              )}
            </div>
          </div>

          <p className="mt-2 text-sm text-ink/60">
            <span className="font-semibold text-ink">{stats.importable}</span> of {stats.total} ticked
            {stats.invalid > 0 && <span className="text-red-600"> · {stats.invalid} need fixing</span>}
            {stats.duplicates > 0 && <span className="text-amber-600"> · {stats.duplicates} duplicates</span>}
          </p>

          <ul className="mt-4 space-y-3">
            {candidates.map((candidate) => (
              <li
                key={candidate.key}
                className={`rounded-xl border p-3 ${
                  candidate.errors.length ? "border-red-200 bg-red-50/60" : "border-ink/10 bg-white"
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={candidate.approved && !candidate.errors.length}
                    disabled={candidate.errors.length > 0}
                    onChange={(e) =>
                      patchCandidate(candidate.key, (c) => setCandidateApproved(c, e.target.checked))
                    }
                    className="mt-1 h-4 w-4 rounded border-ink/20"
                    aria-label={`Import ${candidateLabel(candidate)}`}
                  />

                  <div className="min-w-0 flex-1 space-y-2">
                    <ReviewField
                      label="Front"
                      side={candidate.front}
                      onChange={(text) =>
                        patchCandidate(candidate.key, (c) => setCandidateSideText(c, "front", text))
                      }
                      onClear={() =>
                        patchCandidate(candidate.key, (c) => setCandidateText(c, "front", ""))
                      }
                    />
                    <ReviewField
                      label="Back"
                      side={candidate.back}
                      onChange={(text) =>
                        patchCandidate(candidate.key, (c) => setCandidateSideText(c, "back", text))
                      }
                      onClear={() =>
                        patchCandidate(candidate.key, (c) => setCandidateText(c, "back", ""))
                      }
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={candidate.tags.join(", ")}
                        onChange={(e) =>
                          patchCandidate(candidate.key, (c) => setCandidateTags(c, e.target.value))
                        }
                        placeholder="Tags (comma separated)"
                        className="field min-w-0 flex-1 px-2.5 py-1 text-xs"
                      />
                      {categoryColumnMapped && (
                        <input
                          value={candidate.categoryName ?? ""}
                          onChange={(e) =>
                            patchCandidate(candidate.key, (c) => ({
                              ...c,
                              categoryName: e.target.value.trim() || null,
                            }))
                          }
                          placeholder="Category"
                          className="field w-40 px-2.5 py-1 text-xs"
                        />
                      )}
                    </div>

                    {(candidate.errors.length > 0 ||
                      candidate.duplicate ||
                      candidate.warnings.length > 0) && (
                      <div className="flex flex-wrap gap-1">
                        {candidate.errors.map((error) => (
                          <span key={error} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClass("error")}`}>
                            {error}
                          </span>
                        ))}
                        {candidate.duplicate && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClass("duplicate")}`}>
                            {candidate.duplicate === DUPLICATE_EXISTING
                              ? "already in this category"
                              : "repeated in this import"}
                          </span>
                        )}
                        {candidate.warnings.map((warning) => (
                          <span key={warning} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClass("warning")}`}>
                            {warning}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ============================ 5. IMPORT ============================ */}
      {step === 5 && (
        <section className="card mt-5 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">Importing</h2>
          <p className="mt-3 text-sm text-ink/60">
            {running
              ? `Inserting ${progress.done} of ${progress.total} cards…`
              : "Finishing up…"}
          </p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-stone-100">
            <div
              className="h-full rounded-full bg-lavender transition-[width] duration-300"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-ink/45">Batches of {200} cards, recorded as an import job.</p>
        </section>
      )}

      {/* ============================ 6. SUMMARY ============================ */}
      {step === 6 && summary && (
        <section className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <h2 className="font-semibold text-emerald-800">
            {summary.errors.length ? "Import finished with problems" : "Import complete"}
          </h2>

          <p className="mt-1 text-sm text-emerald-800">
            {summary.inserted} {summary.inserted === 1 ? "card" : "cards"} added
            {targetCategory ? (
              <>
                {" "}
                to <span className="font-semibold">{targetCategory.name}</span>
              </>
            ) : null}
            {summary.skipped > 0 ? `, ${summary.skipped} skipped` : ""}.
          </p>

          {summary.errors.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {summary.errors.slice(0, PREVIEW_ERROR_ROWS).map((message, i) => (
                <li key={i}>{message}</li>
              ))}
              {summary.errors.length > PREVIEW_ERROR_ROWS && (
                <li>…and {summary.errors.length - PREVIEW_ERROR_ROWS} more</li>
              )}
            </ul>
          )}

          {summary.jobId && (
            <p className="mt-2 text-xs text-emerald-700/80">Import job #{summary.jobId} was recorded.</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-4">
            {targetCategory && (
              <Link
                to={`/flash/category/${targetCategory.id}`}
                className="text-sm font-semibold text-emerald-800 underline"
              >
                View category
              </Link>
            )}
            <button
              type="button"
              onClick={startOver}
              className="text-sm font-semibold text-emerald-800 underline"
            >
              Import another file
            </button>
          </div>
        </section>
      )}

      {/* ============================ NAVIGATION ============================ */}
      {step < 5 && (
        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1 || running}
            className="rounded-xl border border-ink/15 bg-white px-5 py-2.5 text-sm font-semibold text-ink/60 transition hover:bg-stone-100 disabled:opacity-40"
          >
            Back
          </button>

          {step < 3 && (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canContinue}
              className="rounded-xl bg-lavender px-6 py-2.5 text-sm font-semibold text-on-accent transition hover:bg-lavender-deep disabled:opacity-50"
            >
              Continue
            </button>
          )}

          {step === 3 && !interactiveSource && (
            <button
              type="button"
              onClick={continueToReview}
              disabled={!canContinue}
              className="rounded-xl bg-lavender px-6 py-2.5 text-sm font-semibold text-on-accent transition hover:bg-lavender-deep disabled:opacity-50"
            >
              Review {activeCandidates.length} cards
            </button>
          )}

          {step === 4 && (
            <button
              type="button"
              onClick={runImport}
              disabled={stats.importable === 0}
              className="rounded-xl bg-lavender px-6 py-2.5 text-sm font-semibold text-on-accent transition hover:bg-lavender-deep disabled:opacity-50"
            >
              Import {stats.importable} {stats.importable === 1 ? "card" : "cards"}
            </button>
          )}
        </div>
      )}

      <NewFolderModal
        open={creatingFolder}
        onClose={() => setCreatingFolder(false)}
        onCreated={(folder) => {
          setFolders((prev) => [...(prev ?? []), folder]);
          setFolderId(String(folder.id));
          setCreatingFolder(false);
        }}
      />

      <CategoryModal
        open={creatingCategory}
        folderId={folderId}
        onClose={() => setCreatingCategory(false)}
        onSaved={(category) => {
          setCat((prev) =>
            prev && String(prev.folderId) === String(folderId)
              ? { ...prev, rows: [...prev.rows, category] }
              : prev
          );
          setCategoryId(String(category.id));
          setCreatingCategory(false);
        }}
      />

      <Toast toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
