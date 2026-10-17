import { describe, it, expect } from "vitest";
import quizBridgeImporter, { QUIZ_IMPORTER_ID, loadCandidates, questionToCandidate } from "../quizBridge.js";
import { SOURCES } from "../candidate.js";

function question(overrides = {}) {
  return {
    id: 1,
    question_text: "What is the capital of France?",
    explanation: "Paris has been the capital since 987.",
    options: [
      { option_text: "London", is_correct: false },
      { option_text: "Paris", is_correct: true },
      { option_text: "Rome", is_correct: false },
      { option_text: "Berlin", is_correct: false },
    ],
    ...overrides,
  };
}

const fakeApi = ({ questions = [], wrong = [] } = {}) => ({
  listQuizQuestions: async () => questions,
  listWrongQuestionStats: async () => wrong,
});

describe("questionToCandidate", () => {
  it("puts the question on the front", () => {
    expect(questionToCandidate(question()).front).toEqual({
      blocks: [{ type: "text", text: "What is the capital of France?" }],
    });
  });

  it("puts the correct answer and the explanation on the back", () => {
    const back = questionToCandidate(question()).back.blocks[0].text;
    expect(back).toContain("Paris");
    expect(back).toContain("Explanation: Paris has been the capital since 987.");
  });

  it("leaves the explanation off when the question has none", () => {
    const back = questionToCandidate(question({ explanation: null })).back.blocks[0].text;
    expect(back).toBe("Paris");
    expect(back).not.toContain("Explanation");
  });

  it("joins several correct answers", () => {
    const candidate = questionToCandidate(
      question({
        options: [
          { option_text: "Paris", is_correct: true },
          { option_text: "Lyon", is_correct: true },
        ],
      })
    );
    expect(candidate.back.blocks[0].text).toContain("Paris / Lyon");
    expect(candidate.warnings).toContain("2 answers are marked correct");
  });

  it("warns when nothing is marked correct", () => {
    const candidate = questionToCandidate(
      question({ options: [{ option_text: "Paris", is_correct: false }] })
    );
    expect(candidate.warnings).toContain("no correct answer is marked on this question");
  });

  it("surfaces the wrong-answer count as a warning", () => {
    const candidate = questionToCandidate(question(), { wrongCount: 3 });
    expect(candidate.warnings).toContain("answered wrongly 3 times in the quiz");
    expect(questionToCandidate(question(), { wrongCount: 1 }).warnings).toContain(
      "answered wrongly 1 time in the quiz"
    );
  });

  it("records the bridge source and traces back to the question", () => {
    const candidate = questionToCandidate(question({ id: 99 }));
    expect(candidate.source).toBe(SOURCES.quiz);
    expect(candidate.source_ref).toBe("99");
  });

  it("flags a question with no text", () => {
    const candidate = questionToCandidate(question({ question_text: "   " }));
    expect(candidate.errors).toContain("missing front");
    expect(candidate.approved).toBe(false);
  });

  it("never throws on a malformed question", () => {
    const candidate = questionToCandidate({ id: 5 });
    expect(candidate.errors).toContain("missing front");
    expect(candidate.source_ref).toBe("5");
  });
});

describe("loadCandidates", () => {
  it("maps every question in the category", async () => {
    const api = fakeApi({ questions: [question({ id: 1 }), question({ id: 2 })] });
    const result = await loadCandidates({ categoryId: 7 }, { quizApi: api });

    expect(result.total).toBe(2);
    expect(result.kept).toBe(2);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((c) => c.source_ref)).toEqual(["1", "2"]);
  });

  it("keeps only previously-wrong questions when asked", async () => {
    const api = fakeApi({
      questions: [question({ id: 1 }), question({ id: 2 }), question({ id: 3 })],
      wrong: [{ question_id: 3, wrong_count: 2 }],
    });
    const result = await loadCandidates({ categoryId: 7, wrongOnly: true }, { quizApi: api });

    expect(result.total).toBe(3);
    expect(result.kept).toBe(1);
    expect(result.candidates.map((c) => c.source_ref)).toEqual(["3"]);
  });

  it("carries the wrong count onto the kept candidate", async () => {
    const api = fakeApi({
      questions: [question({ id: 1 })],
      wrong: [{ question_id: 1, wrong_count: 4 }],
    });
    const { candidates } = await loadCandidates({ categoryId: 7, wrongOnly: true }, { quizApi: api });
    expect(candidates[0].warnings).toContain("answered wrongly 4 times in the quiz");
  });

  it("matches wrong stats by numeric id", async () => {
    const api = fakeApi({
      questions: [question({ id: 1 })],
      wrong: [{ question_id: "1", wrong_count: "2" }],
    });
    const { kept } = await loadCandidates({ categoryId: 7, wrongOnly: true }, { quizApi: api });
    expect(kept).toBe(1);
  });

  it("rejects a missing category", async () => {
    await expect(loadCandidates({}, { quizApi: fakeApi() })).rejects.toThrow(/quiz category/i);
  });
});

describe("the importer descriptor", () => {
  it("exposes the registry shape", () => {
    expect(quizBridgeImporter.id).toBe(QUIZ_IMPORTER_ID);
    expect(typeof quizBridgeImporter.label).toBe("string");
    expect(typeof quizBridgeImporter.accepts).toBe("function");
    expect(typeof quizBridgeImporter.parse).toBe("function");
  });

  it("accepts a category description, not a file", () => {
    expect(quizBridgeImporter.accepts({ categoryId: 3 })).toBe(true);
    expect(quizBridgeImporter.accepts({})).toBe(false);
    expect(quizBridgeImporter.accepts(null)).toBe(false);
  });

  it("parse returns just the candidates", async () => {
    const api = fakeApi({ questions: [question({ id: 8 })] });
    const candidates = await quizBridgeImporter.parse({ categoryId: 7 }, { quizApi: api });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].source_ref).toBe("8");
  });
});
