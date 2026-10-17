// The "Quiz app bridge" importer: turn questions that already exist in the quiz
// tables into basic flash cards.
//
// This is a READ-ONLY view of the quiz data. Nothing in the quiz tables is
// written, altered or removed; the bridge only reads subjects / categories /
// questions / options (and, for the "previously wrong" filter, this user's
// attempt_answers) and produces candidates the wizard can edit and approve.
//
// Conversion, one card per question:
//   front = the question text
//   back  = the correct option's text, then the explanation when there is one
//
// `questionToCandidate` is pure and exported on its own so it can be tested
// without a network. `parse` is the async registry entry point: it reads the
// chosen quiz category through quizApi and maps every question through it.

import { SOURCES, makeCandidate } from "./candidate.js";
import * as quizApi from "./quizApi.js";

export const QUIZ_IMPORTER_ID = "quiz";

// A question -> a basic card. Never throws: a malformed question becomes a
// candidate carrying warnings so the user can see and fix it in the review
// step instead of losing the whole import.
export function questionToCandidate(question, { wrongCount } = {}) {
  const id = question?.id;
  const text = String(question?.question_text ?? "").trim();
  const options = Array.isArray(question?.options) ? question.options : [];
  const correct = options.filter((option) => option?.is_correct);
  const explanation = String(question?.explanation ?? "").trim();

  const warnings = [];
  if (correct.length === 0) {
    warnings.push("no correct answer is marked on this question");
  } else if (correct.length > 1) {
    warnings.push(`${correct.length} answers are marked correct`);
  }
  if (wrongCount > 0) {
    warnings.push(`answered wrongly ${wrongCount} ${wrongCount === 1 ? "time" : "times"} in the quiz`);
  }

  const back = [];
  if (correct.length) {
    back.push(correct.map((option) => String(option?.option_text ?? "").trim()).join(" / "));
  }
  if (explanation) back.push(`Explanation: ${explanation}`);

  return makeCandidate({
    key: id == null ? "question-unknown" : `question-${id}`,
    front: text,
    back: back.join("\n\n"),
    tags: [],
    source: SOURCES.quiz,
    sourceRef: id == null ? null : String(id),
    warnings,
  });
}

// input: { categoryId, wrongOnly }
// ctx:   { quizApi } - injectable so the mapping can be tested without fetch.
export async function loadCandidates(input = {}, ctx = {}) {
  const api = ctx.quizApi ?? quizApi;
  const categoryId = Number(input.categoryId);
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    throw new Error("Choose a quiz category to import from.");
  }

  const questions = await api.listQuizQuestions(categoryId);
  const wrongOnly = Boolean(input.wrongOnly);

  let wrongStats = new Map();
  if (wrongOnly) {
    const stats = await api.listWrongQuestionStats(categoryId);
    wrongStats = new Map(
      (stats ?? []).map((row) => [Number(row.question_id), Number(row.wrong_count) ?? 0])
    );
  }

  const kept = wrongOnly ? questions.filter((q) => wrongStats.has(Number(q.id))) : questions;
  const candidates = kept.map((question) =>
    questionToCandidate(question, { wrongCount: wrongStats.get(Number(question.id)) ?? 0 })
  );

  return { candidates, total: questions.length, kept: kept.length };
}

const quizBridgeImporter = {
  id: QUIZ_IMPORTER_ID,
  label: "Quiz app bridge",

  // The "file" here is a description of what to read, not a File object.
  accepts(input) {
    return Boolean(input) && typeof input === "object" && input.categoryId != null;
  },

  // Contract entry point. Returns candidates[]; `parseWithMeta` (below) also
  // hands back the totals the wizard shows in its summary line.
  async parse(input, ctx = {}) {
    const { candidates } = await loadCandidates(input, ctx);
    return candidates;
  },

  loadCandidates,
};

export default quizBridgeImporter;
