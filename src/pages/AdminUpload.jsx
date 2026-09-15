import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import LoadingSkeleton from "../components/LoadingSkeleton";
import AddSubjectModal from "../components/AddSubjectModal";
import AddCategoryModal from "../components/AddCategoryModal";
import Toast from "../components/Toast";
import { parseQuestionsCsv } from "../lib/csv";

const EMPTY_FORM = {
  question_text: "",
  options: ["", "", "", ""],
  correct: 0,
  explanation: "",
};

const NEW_OPTION_VALUE = "__new__";

const fieldClass =
  "mt-1 block w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-stone-100";

const labelClass = "block text-sm font-medium text-ink/70";

export default function AdminUpload() {
  const [tab, setTab] = useState("single");
  const [searchParams] = useSearchParams();
  const paramSubject = searchParams.get("subject");
  const paramCategory = searchParams.get("category");

  const [subjects, setSubjects] = useState([]);
  const [categories, setCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [subjectId, setSubjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const [subjectModalOpen, setSubjectModalOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);

  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const [csvRows, setCsvRows] = useState([]);
  const [csvErrors, setCsvErrors] = useState([]);
  const [csvFileName, setCsvFileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [toasts, setToasts] = useState([]);
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/subjects");
        if (!res.ok) throw new Error("Failed to load subjects");
        const data = await res.json();
        if (cancelled) return;

        let scopedSubject = "";
        if (paramSubject) {
          const candidate = Number(paramSubject);
          if (data.some((s) => s.id === candidate)) {
            scopedSubject = candidate;
          }
        }
        setSubjects(data);
        setSubjectId(scopedSubject);

        if (scopedSubject !== "" && paramCategory) {
          const catId = Number(paramCategory);
          const catRes = await fetch(`/api/categories?subjectId=${scopedSubject}`);
          if (!catRes.ok) throw new Error("Failed to load categories");
          const cats = await catRes.json();
          if (cancelled) return;
          setCategories(cats);
          if (cats.some((c) => c.id === catId)) {
            setCategoryId(catId);
            setTab("single");
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [paramSubject, paramCategory]);

  function addToast(message, type = "success") {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      3500
    );
  }

  async function loadCategories(subId) {
    setCategoriesLoading(true);
    try {
      const res = await fetch(`/api/categories?subjectId=${subId}`);
      if (!res.ok) throw new Error("Failed to load categories");
      const data = await res.json();
      setCategories(data);
    } catch (err) {
      setError(err.message);
      setCategories([]);
    } finally {
      setCategoriesLoading(false);
    }
  }

  function handleSubjectChange(e) {
    const value = e.target.value;
    if (value === NEW_OPTION_VALUE) {
      setSubjectModalOpen(true);
      return;
    }
    const id = value ? Number(value) : "";
    setSubjectId(id);
    setCategoryId("");
    setCategories([]);
    if (id !== "") loadCategories(id);
  }

  function handleCategoryChange(e) {
    const value = e.target.value;
    if (value === NEW_OPTION_VALUE) {
      setCategoryModalOpen(true);
      return;
    }
    setCategoryId(value ? Number(value) : "");
  }

  function handleSubjectCreated(created) {
    setSubjects((prev) => [created, ...prev]);
    setSubjectId(created.id);
    setCategoryId("");
    setCategories([]);
    loadCategories(created.id);
  }

  function handleCategoryCreated(created) {
    setCategories((prev) => [{ ...created, question_count: 0 }, ...prev]);
    setCategoryId(created.id);
  }

  function validateSingleForm() {
    if (!form.question_text.trim()) return "Question text is required.";

    const letters = ["A", "B", "C", "D"];
    const trimmed = form.options.map((o) => o.trim());
    const emptyIdx = trimmed.findIndex((o) => !o);
    if (emptyIdx !== -1) return `Option ${letters[emptyIdx]} text is required.`;

    const markedCorrect =
      form.correct >= 0 && form.correct < form.options.length ? 1 : 0;
    if (markedCorrect !== 1) return "Exactly one option must be marked correct.";

    return null;
  }

  async function handleSubmitSingle(e) {
    e.preventDefault();
    if (categoryId === "") {
      addToast("Select a category first", "error");
      return;
    }

    const validationError = validateSingleForm();
    if (validationError) {
      addToast(validationError, "error");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category_id: Number(categoryId),
          question_text: form.question_text,
          explanation: form.explanation || undefined,
          options: form.options.map((text, i) => ({
            option_text: text,
            is_correct: i === form.correct,
          })),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to save question");
      }

      setForm(EMPTY_FORM);
      addToast("Question saved");
    } catch (err) {
      addToast(err.message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const { rows, errors } = parseQuestionsCsv(String(reader.result ?? ""));
      setCsvRows(rows);
      setCsvErrors(errors);
      setCsvFileName(file.name);
      setUploadProgress(null);
    };
    reader.readAsText(file);
  }

  async function handleCsvUpload() {
    if (categoryId === "") {
      addToast("Select a category first", "error");
      return;
    }
    if (!csvRows.length) return;

    setUploading(true);
    setUploadProgress({ done: 0, total: csvRows.length, failed: 0 });

    let failed = 0;
    for (let i = 0; i < csvRows.length; i++) {
      const row = csvRows[i];
      try {
        const res = await fetch("/api/questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category_id: Number(categoryId),
            question_text: row.question_text,
            explanation: row.explanation || undefined,
            options: row.options.map((text, j) => ({
              option_text: text,
              is_correct: j === row.correct_option - 1,
            })),
          }),
        });
        if (!res.ok) failed++;
      } catch {
        failed++;
      }
      setUploadProgress({
        done: i + 1,
        total: csvRows.length,
        failed,
      });
    }

    setUploading(false);
    addToast(
      `Uploaded ${csvRows.length - failed}/${csvRows.length} questions` +
        (failed > 0 ? ` (${failed} failed)` : "")
    );
    setCsvFileName("");
    setCsvRows([]);
    setCsvErrors([]);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink/50 transition-colors hover:text-ink"
      >
        ← Back to Dashboard
      </Link>

      <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">
          Upload Questions
        </h1>
        <div className="inline-flex rounded-xl border border-ink/10 bg-white p-1 shadow-sm">
          <button
            onClick={() => setTab("single")}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === "single"
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-ink/55 hover:text-ink"
            }`}
          >
            Add One
          </button>
          <button
            onClick={() => setTab("csv")}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === "csv"
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-ink/55 hover:text-ink"
            }`}
          >
            Bulk CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {paramCategory && (
        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Adding questions to{" "}
          <span className="font-semibold">
            {subjects.find((s) => s.id === subjectId)?.name ?? "…"}
          </span>{" "}
          →{" "}
          <span className="font-semibold">
            {categories.find((c) => c.id === categoryId)?.name ?? "…"}
          </span>
        </div>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : (
        <div className="space-y-6">
          <div className="rounded-2xl border border-ink/10 bg-white p-6 shadow-card">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="subject-select" className={labelClass}>
                  Subject
                </label>
                <select
                  id="subject-select"
                  value={subjectId === "" ? "" : subjectId}
                  onChange={handleSubjectChange}
                  className={fieldClass}
                >
                  <option value="">Select a subject…</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                  <option value={NEW_OPTION_VALUE}>＋ Add new subject…</option>
                </select>
              </div>

              <div>
                <label htmlFor="category-select" className={labelClass}>
                  Category
                </label>
                <select
                  id="category-select"
                  value={categoryId === "" ? "" : categoryId}
                  onChange={handleCategoryChange}
                  disabled={subjectId === "" || categoriesLoading}
                  className={fieldClass}
                >
                  <option value="">
                    {categoriesLoading
                      ? "Loading…"
                      : subjectId === ""
                        ? "Select a subject first"
                        : "Select a category…"}
                  </option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value={NEW_OPTION_VALUE}>＋ Add new category…</option>
                </select>
              </div>
            </div>
          </div>

          {tab === "single" ? (
            <form
              onSubmit={handleSubmitSingle}
              className="rounded-2xl border border-ink/10 bg-white p-6 shadow-card"
            >
              <h2 className="mb-4 text-lg font-semibold text-ink">
                Add a Question
              </h2>

              <label htmlFor="q-text" className={labelClass}>
                Question *
              </label>
              <textarea
                id="q-text"
                rows={3}
                required
                value={form.question_text}
                onChange={(e) =>
                  setForm({ ...form, question_text: e.target.value })
                }
                className={fieldClass}
                placeholder="Type the question…"
              />

              <p className="mb-2 mt-5 text-sm font-medium text-ink/70">
                Options
              </p>
              <div className="space-y-2">
                {["A", "B", "C", "D"].map((letter, i) => (
                  <div key={letter} className="flex items-center gap-3">
                    <label className="flex w-6 shrink-0 cursor-pointer items-center justify-center">
                      <input
                        type="radio"
                        name="correct-option"
                        checked={form.correct === i}
                        onChange={() => setForm({ ...form, correct: i })}
                        className="h-4 w-4 accent-emerald-600"
                      />
                    </label>
                    <span className="w-5 text-sm font-semibold text-ink/50">
                      {letter}
                    </span>
                    <input
                      type="text"
                      required
                      value={form.options[i]}
                      onChange={(e) => {
                        const options = [...form.options];
                        options[i] = e.target.value;
                        setForm({ ...form, options });
                      }}
                      className={fieldClass}
                      placeholder={`Option ${letter} text…`}
                    />
                  </div>
                ))}
                <p className="text-xs text-ink/40">
                  Select the radio next to the correct option.
                </p>
              </div>

              <label htmlFor="q-explanation" className={`mt-5 block ${labelClass}`}>
                Explanation
              </label>
              <textarea
                id="q-explanation"
                rows={2}
                value={form.explanation}
                onChange={(e) =>
                  setForm({ ...form, explanation: e.target.value })
                }
                className={fieldClass}
                placeholder="Why is the answer correct? (shown on the results screen)"
              />

              <div className="mt-6 flex items-center gap-4">
                <button
                  type="submit"
                  disabled={submitting || categoryId === ""}
                  className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {submitting ? "Saving…" : "Save Question"}
                </button>
                {categoryId === "" && (
                  <span className="text-sm text-ink/40">
                    Pick a subject & category above first.
                  </span>
                )}
              </div>
            </form>
          ) : (
            <div className="rounded-2xl border border-ink/10 bg-white p-6 shadow-card">
              <h2 className="mb-1 text-lg font-semibold text-ink">
                Bulk Upload via CSV
              </h2>
              <p className="mb-4 text-sm text-ink/55">
                Columns:{" "}
                <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">
                  question, option1, option2, option3, option4,
                  correct_option, explanation
                </code>{" "}
                —{" "}
                <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">
                  correct_option
                </code>{" "}
                is 1–4. An optional header row is skipped automatically. Quote
                fields that contain commas.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="block w-full text-sm text-ink/55 file:mr-4 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-emerald-700 hover:file:bg-emerald-100"
              />

              {csvFileName && (
                <p className="mt-3 text-sm text-ink/55">
                  Loaded <span className="font-medium text-ink">{csvFileName}</span>{" "}
                  — {csvRows.length} valid question
                  {csvRows.length === 1 ? "" : "s"}
                  {csvErrors.length > 0 &&
                    `, ${csvErrors.length} skipped row${csvErrors.length === 1 ? "" : "s"}`}
                </p>
              )}

              {csvErrors.length > 0 && (
                <div className="mt-3 max-h-32 overflow-y-auto rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                  {csvErrors.map((e, i) => (
                    <p key={i}>{e}</p>
                  ))}
                </div>
              )}

              {uploadProgress && (
                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-xs font-medium text-ink/55">
                    <span>
                      Uploading {uploadProgress.done}/{uploadProgress.total}
                      {uploadProgress.failed > 0 &&
                        ` · ${uploadProgress.failed} failed`}
                    </span>
                    <span>
                      {Math.round(
                        (uploadProgress.done / uploadProgress.total) * 100
                      )}
                      %
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-ink/10">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-200"
                      style={{
                        width: `${(uploadProgress.done / uploadProgress.total) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {csvFileName && (
                <button
                  onClick={handleCsvUpload}
                  disabled={uploading || csvRows.length === 0 || categoryId === ""}
                  className="mt-4 rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {uploading
                    ? "Uploading…"
                    : csvRows.length > 0
                      ? `Upload ${csvRows.length} question${csvRows.length === 1 ? "" : "s"}`
                      : "Upload"}
                </button>
              )}
              {categoryId === "" && csvFileName && (
                <span className="ml-3 text-sm text-ink/40">
                  Pick a subject & category above first.
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <AddSubjectModal
        open={subjectModalOpen}
        onClose={() => setSubjectModalOpen(false)}
        onCreated={handleSubjectCreated}
      />
      <AddCategoryModal
        open={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        onCreated={handleCategoryCreated}
        subjectId={subjectId}
      />
      <Toast
        toasts={toasts}
        onDismiss={(id) => setToasts((p) => p.filter((t) => t.id !== id))}
      />
    </div>
  );
}