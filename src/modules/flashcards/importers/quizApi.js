// Read-only client helpers for the quiz side of the "Quiz app bridge".
//
// The bridge imports questions that already live in the quiz tables (subjects,
// categories, questions, options, attempt_answers). It never writes to them, so
// these are all GETs against the existing quiz endpoints - the flash module
// adds no new quiz surface.
//
// Reads go through cachedFetch like every other screen, so backing out and
// re-entering the wizard does not re-hit the database for a list it just loaded.
import { cachedFetch } from "../../../lib/apiCache";

async function readError(res, fallback) {
  const body = await res.json().catch(() => null);
  return body?.error ?? fallback;
}

async function getJson(url, fallback) {
  const res = await cachedFetch(url);
  if (!res.ok) throw new Error(await readError(res, fallback));
  return res.json();
}

export const listQuizSubjects = () =>
  getJson("/api/subjects", "Failed to load subjects");

// A subject's categories, each already carrying a question_count.
export const listQuizCategories = (subjectId) =>
  getJson(`/api/categories?subjectId=${encodeURIComponent(subjectId)}`, "Failed to load categories");

// A category's questions with their options (and therefore the correct answer
// and the explanation) attached.
export const listQuizQuestions = (categoryId) =>
  getJson(`/api/questions?categoryId=${encodeURIComponent(categoryId)}`, "Failed to load questions");

// The subset of a category's questions this user has answered wrongly, with the
// counts. Used by the "only previously-wrong questions" option.
export const listWrongQuestionStats = (categoryId) =>
  getJson(
    `/api/categories/${encodeURIComponent(categoryId)}/wrong-questions`,
    "Failed to load previously-wrong questions"
  );
