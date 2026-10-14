import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import LoadingSkeleton from "../components/LoadingSkeleton";
import QuestionEditModal from "../components/QuestionEditModal";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import FlagDetailsModal from "../components/FlagDetailsModal";
import MoveQuestionsModal from "../components/MoveQuestionsModal";
import { fetchAdminQuestions, DIFFICULTIES } from "../lib/questionMeta";
import { cachedFetch } from "../lib/apiCache";

const DIFFICULTY_BADGE = {
  easy: "bg-sage text-on-accent",
  medium: "bg-butter text-on-accent",
  hard: "bg-pink text-on-accent",
};

const DIFFICULTY_FILTER_ON = {
  easy: "border-emerald-500 bg-emerald-50 text-emerald-800",
  medium: "border-amber-500 bg-amber-50 text-amber-900",
  hard: "border-red-500 bg-red-50 text-red-700",
};

export default function ManageQuestions() {
  const [searchParams] = useSearchParams();
  const paramSubject = searchParams.get("subject");
  const paramCategory = searchParams.get("category");

  const [subject, setSubject] = useState(null);
  const [category, setCategory] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Filters (combinable). Difficulty values are OR-ed; the three groups are
  // AND-ed, exactly like GET /api/admin/questions.
  const [starredFilter, setStarredFilter] = useState(false);
  const [flaggedFilter, setFlaggedFilter] = useState(false);
  const [difficultyFilter, setDifficultyFilter] = useState(() => new Set());
  const [refreshKey, setRefreshKey] = useState(0);

  const [editQuestion, setEditQuestion] = useState(null);
  const [deleteQuestion, setDeleteQuestion] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const [flagQuestionId, setFlagQuestionId] = useState(null);
  const [selection, setSelection] = useState(() => new Set());
  const [moveIds, setMoveIds] = useState(null);

  const catId = Number(paramCategory);
  const difficultyList = [...difficultyFilter].sort();
  const difficultyKey = difficultyList.join(",");
  const filtersActive = starredFilter || flaggedFilter || difficultyFilter.size > 0;

  // Subject + category header.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (!paramCategory || !paramSubject) {
          throw new Error("Subject and category are required in the URL");
        }
        const subId = Number(paramSubject);
        const [subRes, catRes] = await Promise.all([
          cachedFetch(`/api/subjects/${subId}`),
          cachedFetch(`/api/categories/${catId}`),
        ]);
        if (!subRes.ok) throw new Error("Subject not found");
        if (!catRes.ok) throw new Error("Category not found");
        const [subData, catData] = await Promise.all([subRes.json(), catRes.json()]);
        if (cancelled) return;
        setSubject(subData);
        setCategory(catData);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [paramSubject, paramCategory, catId]);

  // Question list - refetched whenever a filter or an edit/move/delete changes.
  useEffect(() => {
    let cancelled = false;
    async function loadQuestions() {
      setLoading(true);
      setError(null);
      try {
        const rows = await fetchAdminQuestions({
          categoryId: catId,
          starred: starredFilter,
          flagged: flaggedFilter,
          difficulty: difficultyList,
        });
        for (const q of rows) {
          q.options = (q.options ?? []).sort((a, b) => a.id - b.id);
        }
        if (!cancelled) setQuestions(rows);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (paramCategory && paramSubject) loadQuestions();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catId, paramSubject, paramCategory, starredFilter, flaggedFilter, difficultyKey, refreshKey]);

  const reload = () => setRefreshKey((k) => k + 1);

  function clearFilters() {
    setStarredFilter(false);
    setFlaggedFilter(false);
    setDifficultyFilter(new Set());
  }

  function toggleDifficulty(level) {
    setDifficultyFilter((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  function toggleSelected(id) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleQuestionSaved(updated) {
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === updated.id
          ? {
              ...q,
              ...updated,
              options: (updated.options ?? []).sort((a, b) => a.id - b.id),
            }
          : q
      )
    );
    setEditQuestion(null);
  }

  async function handleConfirmDelete() {
    if (!deleteQuestion) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await cachedFetch(`/api/questions/${deleteQuestion.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to delete question");
      }
      setQuestions((prev) => prev.filter((q) => q.id !== deleteQuestion.id));
      setSelection((prev) => {
        const next = new Set(prev);
        next.delete(deleteQuestion.id);
        return next;
      });
      setDeleteQuestion(null);
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  function handleMoved(result, target) {
    const moved = result?.question_ids ?? [];
    setSelection((prev) => {
      const next = new Set(prev);
      for (const id of moved) next.delete(id);
      return next;
    });
    setMoveIds(null);
    setNotice(
      `Moved ${result?.moved ?? moved.length} ${
        (result?.moved ?? moved.length) === 1 ? "question" : "questions"
      } to ${target?.name ?? "the new category"}.`
    );
    reload();
  }

  const correctLetter = (q) => {
    const idx = (q.options ?? []).findIndex((o) => o.is_correct);
    return ["A", "B", "C", "D"][idx] ?? "?";
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <Link
        to={`/category/${catId}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink/50 transition-colors hover:text-ink"
      >
        ← Back to {category?.name ?? "Category"}
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink/45">{subject?.name}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
            Manage Questions
          </h1>
          <p className="mt-1 text-sm text-ink/55">
            {category?.name} · {questions.length}{" "}
            {questions.length === 1 ? "question" : "questions"}
            {filtersActive && " shown"}
          </p>
        </div>
        <Link
          to={`/admin/upload?subject=${paramSubject}&category=${paramCategory}`}
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
        >
          ＋ Add Question
        </Link>
      </div>

      {notice && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-xs font-semibold text-emerald-700 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Filter bar */}
      <div className="mb-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink/40">
            Filter
          </span>

          <button
            type="button"
            onClick={() => setStarredFilter((v) => !v)}
            aria-pressed={starredFilter}
            className={`filter-pill rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              starredFilter
                ? "border-amber-500 bg-amber-50 text-amber-800"
                : "border-ink/10 bg-white text-ink/60 hover:border-amber-300"
            }`}
          >
            ★ Starred
          </button>

          <button
            type="button"
            onClick={() => setFlaggedFilter((v) => !v)}
            aria-pressed={flaggedFilter}
            className={`filter-pill rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              flaggedFilter
                ? "border-red-500 bg-red-50 text-red-700"
                : "border-ink/10 bg-white text-ink/60 hover:border-red-300"
            }`}
          >
            ⚑ Flagged
          </button>

          {DIFFICULTIES.map((level) => {
            const on = difficultyFilter.has(level);
            return (
              <button
                key={level}
                type="button"
                onClick={() => toggleDifficulty(level)}
                aria-pressed={on}
                className={`filter-pill rounded-full border px-3 py-1 text-xs font-semibold capitalize transition-colors ${
                  on
                    ? DIFFICULTY_FILTER_ON[level]
                    : "border-ink/10 bg-white text-ink/60 hover:border-ink/25"
                }`}
              >
                {level}
              </button>
            );
          })}

          {filtersActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto rounded-full px-3 py-1 text-xs font-semibold text-ink/50 underline-offset-2 hover:text-ink hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>

        <p className="mt-2 text-xs text-ink/45">
          Starred / Easy / Medium / Hard reflect <span className="font-semibold">your own</span>{" "}
          tags. Flagged covers reports from <span className="font-semibold">all users</span>.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-ink/5 pt-3">
          <span className="text-xs font-medium text-ink/50">
            {questions.length} {questions.length === 1 ? "result" : "results"}
          </span>
          <button
            type="button"
            disabled={selection.size === 0}
            onClick={() => setMoveIds([...selection])}
            className="ml-auto rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-ink/80 disabled:opacity-40"
          >
            Move selected ({selection.size})
          </button>
          {selection.size > 0 && (
            <button
              type="button"
              onClick={() => setSelection(new Set())}
              className="text-xs font-semibold text-ink/50 hover:text-ink"
            >
              Clear selection
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : questions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink/15 bg-white/40 p-10 text-center text-sm text-ink/55">
          {filtersActive
            ? "No questions match these filters."
            : "No questions in this category yet."}
        </div>
      ) : (
        <div className="space-y-4">
          {questions.map((q) => (
            <div
              key={q.id}
              className="rounded-2xl border border-ink/10 bg-white p-5 shadow-card"
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selection.has(q.id)}
                  onChange={() => toggleSelected(q.id)}
                  aria-label={`Select question ${q.id}`}
                  className="mt-1 h-4 w-4 shrink-0 rounded border-ink/25 accent-emerald-600"
                />

                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-relaxed text-ink">
                    {q.question_text}
                  </p>
                  {q.explanation && (
                    <p className="mt-2 rounded-lg bg-stone-100 p-2 text-xs leading-relaxed text-ink/55">
                      {q.explanation}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {q.is_starred && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        ★ Starred
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setFlagQuestionId(q.id)}
                      disabled={q.flag_count === 0}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                        q.flag_count > 0
                          ? "bg-red-100 text-red-700 hover:bg-red-200"
                          : "cursor-default bg-stone-100 text-ink/40"
                      }`}
                      title={
                        q.flag_count > 0
                          ? "View flags and resolve or dismiss them"
                          : "No open flags"
                      }
                    >
                      ⚑ {q.flag_count} {q.flag_count === 1 ? "flag" : "flags"}
                    </button>
                    {q.my_difficulty && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                          DIFFICULTY_BADGE[q.my_difficulty] ?? "bg-stone-100 text-ink/60"
                        }`}
                      >
                        {q.my_difficulty}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setMoveIds([q.id])}
                    title="Move question"
                    aria-label={`Move question ${q.id}`}
                    className="icon-circle text-sm hover:bg-ink/5"
                  >
                    ⇄
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditQuestion(q)}
                    title="Edit question"
                    aria-label={`Edit question ${q.id}`}
                    className="icon-circle text-sm hover:bg-emerald-50 hover:text-emerald-700"
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteQuestion(q)}
                    title="Delete question"
                    aria-label={`Delete question ${q.id}`}
                    className="icon-circle text-sm hover:bg-red-50 hover:text-red-700"
                  >
                    🗑️
                  </button>
                </div>
              </div>

              <ul className="mt-3 space-y-1">
                {(q.options ?? []).map((opt, i) => {
                  const letter = ["A", "B", "C", "D"][i] ?? "?";
                  return (
                    <li key={opt.id}>
                      <button
                        type="button"
                        onClick={() => setEditQuestion(q)}
                        className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition-colors hover:bg-stone-50 ${
                          opt.is_correct
                            ? "bg-sage/20 text-ink"
                            : "text-ink/70"
                        }`}
                      >
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                            opt.is_correct
                              ? "bg-sage text-on-accent"
                              : "bg-stone-100 text-ink/50"
                          }`}
                        >
                          {letter}
                        </span>
                        <span className={opt.is_correct ? "font-medium" : ""}>
                          {opt.option_text}
                        </span>
                        {opt.is_correct && (
                          <span className="text-xs font-semibold text-correct">
                            correct ({correctLetter(q)})
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-3 flex justify-end">
                <span className="text-xs font-medium text-ink/40">
                  Question #{q.id}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <QuestionEditModal
        question={editQuestion}
        onClose={() => setEditQuestion(null)}
        onSaved={handleQuestionSaved}
      />
      <ConfirmDeleteModal
        open={deleteQuestion !== null}
        title="Delete Question"
        onClose={() => setDeleteQuestion(null)}
        onConfirm={handleConfirmDelete}
        busy={deleting}
        error={deleteError}
      >
        <p>
          This question and its answer history will be{" "}
          <span className="font-semibold text-red-700">permanently deleted</span>.
        </p>
        <p className="mt-2">
          It will be removed from future quizzes, wrong-question lists, and any
          starred-question lists. This also removes any flags and difficulty tags
          on it. This cannot be undone.
        </p>
      </ConfirmDeleteModal>

      <FlagDetailsModal
        open={flagQuestionId !== null}
        questionId={flagQuestionId}
        onClose={() => setFlagQuestionId(null)}
        onChanged={reload}
      />

      <MoveQuestionsModal
        open={moveIds !== null}
        questionIds={moveIds ?? []}
        sourceCategoryId={catId}
        sourceCategoryName={category?.name}
        sourceSubjectId={paramSubject}
        onClose={() => setMoveIds(null)}
        onMoved={handleMoved}
      />
    </div>
  );
}
