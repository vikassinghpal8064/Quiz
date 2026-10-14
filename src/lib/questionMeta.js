// Client helpers for the flag / difficulty / admin-question endpoints.
//
// Kept in one place so the quiz-taking, results and manage-questions screens
// share the exact same request and error handling. All calls rely on the
// same-origin session cookie the rest of the app uses.
//
// Requests go through cachedFetch so repeated reads (e.g. the meta list) are
// de-duplicated and reused briefly; writes clear that cache automatically.
import { cachedFetch } from "./apiCache";

export const FLAG_REASONS = [
  { value: "wrong_answer_key", label: "Wrong answer key" },
  { value: "typo", label: "Typo" },
  { value: "unclear_question", label: "Unclear question" },
  { value: "wrong_explanation", label: "Wrong explanation" },
  { value: "other", label: "Other" },
];

export const DIFFICULTIES = ["easy", "medium", "hard"];

export function reasonLabel(value) {
  return FLAG_REASONS.find((r) => r.value === value)?.label ?? value;
}

async function readError(res, fallback) {
  const body = await res.json().catch(() => null);
  return body?.error ?? fallback;
}

// Returns { [questionId]: { flagged, flag, difficulty } }.
export async function fetchQuestionMeta(questionIds) {
  const ids = [...new Set((questionIds ?? []).map(Number).filter(Boolean))];
  if (!ids.length) return {};
  const res = await cachedFetch(`/api/questions/meta?questionIds=${ids.join(",")}`);
  if (!res.ok) throw new Error(await readError(res, "Failed to load question meta"));
  return res.json();
}

export async function fileFlag(questionId, reason, comment) {
  const res = await cachedFetch(`/api/questions/${questionId}/flag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason, comment }),
  });
  if (!res.ok) throw new Error(await readError(res, "Failed to save flag"));
  return res.json();
}

export async function withdrawFlag(questionId) {
  const res = await cachedFetch(`/api/questions/${questionId}/flag`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readError(res, "Failed to withdraw flag"));
  return res.json();
}

export async function setDifficulty(questionId, difficulty) {
  const res = await cachedFetch(`/api/questions/${questionId}/difficulty`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ difficulty }),
  });
  if (!res.ok) throw new Error(await readError(res, "Failed to save difficulty"));
  return res.json();
}

export async function clearDifficulty(questionId) {
  const res = await cachedFetch(`/api/questions/${questionId}/difficulty`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readError(res, "Failed to clear difficulty"));
  return res.json();
}

// ---------- admin ----------

export async function fetchAdminQuestions({ categoryId, starred, flagged, difficulty } = {}) {
  const params = new URLSearchParams();
  if (categoryId != null) params.set("categoryId", String(categoryId));
  if (starred) params.set("starred", "true");
  if (flagged) params.set("flagged", "true");
  if (difficulty?.length) params.set("difficulty", difficulty.join(","));

  const res = await cachedFetch(`/api/admin/questions?${params.toString()}`);
  if (!res.ok) throw new Error(await readError(res, "Failed to load questions"));
  return res.json();
}

export async function fetchQuestionFlags(questionId) {
  const res = await cachedFetch(`/api/admin/questions/${questionId}/flags`);
  if (!res.ok) throw new Error(await readError(res, "Failed to load flags"));
  return res.json();
}

export async function updateFlagStatus(flagId, status) {
  const res = await cachedFetch(`/api/admin/flags/${flagId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(await readError(res, "Failed to update flag"));
  return res.json();
}

export async function moveQuestions(questionIds, targetCategoryId) {
  const res = await cachedFetch("/api/admin/questions/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question_ids: questionIds,
      target_category_id: targetCategoryId,
    }),
  });
  if (!res.ok) throw new Error(await readError(res, "Failed to move questions"));
  return res.json();
}
