import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import LoadingSkeleton from "../components/LoadingSkeleton";
import QuestionEditModal from "../components/QuestionEditModal";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";

export default function ManageQuestions() {
  const [searchParams] = useSearchParams();
  const paramSubject = searchParams.get("subject");
  const paramCategory = searchParams.get("category");

  const [subject, setSubject] = useState(null);
  const [category, setCategory] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editQuestion, setEditQuestion] = useState(null);
  const [deleteQuestion, setDeleteQuestion] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const catId = Number(paramCategory);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (!paramCategory || !paramSubject) {
          throw new Error("Subject and category are required in the URL");
        }

        const subId = Number(paramSubject);
        const [subRes, catRes] = await Promise.all([
          fetch(`/api/subjects/${subId}`),
          fetch(`/api/categories/${catId}`),
        ]);

        if (!subRes.ok) throw new Error("Subject not found");
        if (!catRes.ok) throw new Error("Category not found");

        const [subData, catData] = await Promise.all([
          subRes.json(),
          catRes.json(),
        ]);

        const qRes = await fetch(`/api/questions?categoryId=${catId}`);
        if (!qRes.ok) throw new Error("Failed to load questions");
        const qData = await qRes.json();
        for (const q of qData) {
          q.options = (q.options ?? []).sort((a, b) => a.id - b.id);
        }

        if (cancelled) return;
        setSubject(subData);
        setCategory(catData);
        setQuestions(qData);
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
  }, [paramSubject, paramCategory, catId]);

  function handleQuestionSaved(updated) {
    setQuestions((prev) =>
      prev.map((q) => (q.id === updated.id ? { ...updated, options: (updated.options ?? []).sort((a, b) => a.id - b.id) } : q))
    );
    setEditQuestion(null);
  }

  async function handleConfirmDelete() {
    if (!deleteQuestion) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/questions/${deleteQuestion.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to delete question");
      }
      setQuestions((prev) => prev.filter((q) => q.id !== deleteQuestion.id));
      setDeleteQuestion(null);
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleting(false);
    }
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

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink/45">{subject?.name}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
            Manage Questions
          </h1>
          <p className="mt-1 text-sm text-ink/55">
            {category?.name} · {questions.length}{" "}
            {questions.length === 1 ? "question" : "questions"}
          </p>
        </div>
        <Link
          to={`/admin/upload?subject=${paramSubject}&category=${paramCategory}`}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
        >
          ＋ Add Question
        </Link>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : questions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink/15 bg-white/40 p-10 text-center text-sm text-ink/55">
          No questions in this category yet.
        </div>
      ) : (
        <div className="space-y-4">
          {questions.map((q) => (
            <div
              key={q.id}
              className="rounded-2xl border border-ink/10 bg-white p-5 shadow-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium leading-relaxed text-ink">
                    {q.question_text}
                  </p>
                  {q.explanation && (
                    <p className="mt-2 rounded-lg bg-stone-100 p-2 text-xs leading-relaxed text-ink/55">
                      {q.explanation}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditQuestion(q)}
                    title="Edit question"
                    aria-label={`Edit question ${q.id}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/10 bg-white text-sm shadow-sm transition-colors hover:bg-emerald-50"
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteQuestion(q)}
                    title="Delete question"
                    aria-label={`Delete question ${q.id}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/10 bg-white text-sm shadow-sm transition-colors hover:bg-red-50"
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
                            ? "bg-emerald-50 text-emerald-900"
                            : "text-ink/70"
                        }`}
                      >
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                            opt.is_correct
                              ? "bg-emerald-600 text-white"
                              : "bg-stone-100 text-ink/50"
                          }`}
                        >
                          {letter}
                        </span>
                        <span className={opt.is_correct ? "font-medium" : ""}>
                          {opt.option_text}
                        </span>
                        {opt.is_correct && (
                          <span className="text-xs font-semibold text-emerald-600">
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
          starred-question lists. This cannot be undone.
        </p>
      </ConfirmDeleteModal>
    </div>
  );
}