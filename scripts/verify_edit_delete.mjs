import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

process.loadEnvFile(".env");

const h = (p) => import(p).then((m) => m.default);

const [subjectsHandler, subjectByIdHandler, categoriesHandler, categoryByIdHandler,
  questionsHandler, questionByIdHandler, starHandler, starredQuestionsHandler,
  attemptsHandler, answersHandler, wrongQuestionsHandler] = await Promise.all([
  h("../api/subjects.js"),
  h("../api/subjects/[id].js"),
  h("../api/categories.js"),
  h("../api/categories/[id]/index.js"),
  h("../api/questions.js"),
  h("../api/questions/[id]/index.js"),
  h("../api/questions/[id]/star.js"),
  h("../api/categories/[id]/starred-questions.js"),
  h("../api/attempts.js"),
  h("../api/attempts/[id]/answers.js"),
  h("../api/categories/[id]/wrong-questions.js"),
]);

function makeRes() {
  const r = {
    statusCode: 0,
    body: null,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return {
        json: (p) => { this.body = p; },
        end: () => {},
      };
    },
    json(p) { this.statusCode = 200; this.body = p; },
    end() {},
  };
  return r;
}

async function call(handler, method, query, body) {
  const res = makeRes();
  await handler({ method, query, body, url: "" }, res);
  if (res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode}: ${JSON.stringify(res.body)}`);
  return res.body;
}

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}

let subjectId, categoryId, questionId, attemptId;

try {
  console.log("Creating scratch subject/category/question...");
  const sub = await call(subjectsHandler, "POST", {}, { name: "ZZ_Cleanup_Test", description: "temp" });
  subjectId = sub.id;
  const cat = await call(categoriesHandler, "POST", {}, { subject_id: subjectId, name: "ZZ_Cleanup_Cat", description: "temp" });
  categoryId = cat.id;
  const q = await call(questionsHandler, "POST", {}, {
    category_id: categoryId, question_text: "original question", explanation: "orig exp",
    options: [
      { option_text: "A1", is_correct: true }, { option_text: "B1", is_correct: false },
      { option_text: "C1", is_correct: false }, { option_text: "D1", is_correct: false },
    ],
  });
  questionId = q.id;
  console.log(`  IDs: subject=${subjectId} category=${categoryId} question=${questionId}\n`);

  console.log("FLOW (a): rename subject & category, confirm reflected everywhere");
  await call(subjectByIdHandler, "PATCH", { id: subjectId }, { name: "ZZ_Cleanup_Test_Renamed", description: "updated desc" });
  const subGet = await call(subjectByIdHandler, "GET", { id: subjectId }, {});
  check("subject GET returns new name", subGet.name === "ZZ_Cleanup_Test_Renamed");
  const subsList = await call(subjectsHandler, "GET", {}, {});
  check("subject appears in dashboard list as renamed", subsList.some((s) => s.id === subjectId && s.name === "ZZ_Cleanup_Test_Renamed"));

  await call(categoryByIdHandler, "PATCH", { id: categoryId }, { name: "ZZ_Cleanup_Cat_Renamed", description: "cat desc" });
  const catGet = await call(categoryByIdHandler, "GET", { id: categoryId }, {});
  check("category GET returns new name", catGet.name === "ZZ_Cleanup_Cat_Renamed");
  const catsList = await call(categoriesHandler, "GET", { subjectId }, {});
  check("category appears in subject page list as renamed", catsList.some((c) => c.id === categoryId && c.name === "ZZ_Cleanup_Cat_Renamed"));
  console.log();

  console.log("FLOW (d): star the question first");
  await call(starHandler, "POST", { id: questionId }, {});
  let starred = await call(starredQuestionsHandler, "GET", { id: categoryId }, {});
  check("starred list shows 1 starred question", starred.count === 1 && starred.starred_questions.some((s) => s.question_id === questionId));
  console.log();

  console.log("FLOW (b): edit question (text/options/correct/explanation) then re-fetch into quiz");
  await call(questionByIdHandler, "PATCH", { id: questionId }, {
    question_text: "edited question", explanation: "new exp",
    options: [
      { option_text: "NewA", is_correct: false }, { option_text: "NewB", is_correct: false },
      { option_text: "NewC", is_correct: false }, { option_text: "NewD", is_correct: true },
    ],
  });
  const quizQuestions = await call(questionsHandler, "GET", { categoryId }, {});
  const fetched = quizQuestions.find((x) => x.id === questionId);
  check("quiz question text updated", fetched?.question_text === "edited question");
  check("explanation updated", fetched?.explanation === "new exp");
  const opts = [...(fetched?.options ?? [])].sort((a, b) => a.id - b.id);
  check("option text updated", opts.map((o) => o.option_text).join("|") === "NewA|NewB|NewC|NewD");
  check("correct option now D", opts[3].is_correct === true && opts.slice(0, 3).every((o) => o.is_correct === false));
  const qGet = await call(questionByIdHandler, "GET", { id: questionId }, {});
  check("single question GET reflects edits", qGet.question_text === "edited question" && [...qGet.options].sort((a,b)=>a.id-b.id)[3].is_correct === true);
  check("still starred after editing", (await call(starredQuestionsHandler, "GET", { id: categoryId }, {})).count === 1);
  console.log();

  console.log("FLOW (d cont.): simulate wrong answer so it appears in practice mode");
  const attempt = await call(attemptsHandler, "POST", {}, { category_id: categoryId, mode: "full" });
  attemptId = attempt.id;
  const wrongOption = [...opts].find((o) => !o.is_correct).id;
  await call(answersHandler, "POST", { id: attemptId }, { question_id: questionId, selected_option_id: wrongOption });
  let wrong = await call(wrongQuestionsHandler, "GET", { id: categoryId }, {});
  check("question appears in practice/wrong list", wrong.some((w) => w.question_id === questionId));
  console.log();

  console.log("FLOW (c): delete the question, verify gone from quiz/wrong/starred");
  await call(questionByIdHandler, "DELETE", { id: questionId }, {});
  const quizAfterDelete = await call(questionsHandler, "GET", { categoryId }, {});
  check("question gone from category quiz", !quizAfterDelete.some((x) => x.id === questionId));
  wrong = await call(wrongQuestionsHandler, "GET", { id: categoryId }, {});
  check("question gone from wrong list", !wrong.some((w) => w.question_id === questionId));
  starred = await call(starredQuestionsHandler, "GET", { id: categoryId }, {});
  check("question gone from starred list", !(starred.starred_questions ?? []).some((s) => s.question_id === questionId));
  console.log();

  console.log("FLOW (e): delete the category, verify app-level data gone cleanly");
  const delCat = await call(categoryByIdHandler, "DELETE", { id: categoryId }, {});
  check("category delete reports 0 questions remaining", delCat.deleted.questions === 0);
  const catsAfter = await call(categoriesHandler, "GET", { subjectId }, {});
  check("category gone from subject page", !catsAfter.some((c) => c.id === categoryId));
  check("no crash on GET subject page", (await call(subjectByIdHandler, "GET", { id: subjectId }, {})).id === subjectId);
  console.log();

  console.log("FLOW: delete the subject, verify cascade counts");
  const delSub = await call(subjectByIdHandler, "DELETE", { id: subjectId }, {});
  check("subject delete ran", delSub.id === subjectId);
  const subsAfter = await call(subjectsHandler, "GET", {}, {});
  check("subject gone from dashboard", !subsAfter.some((s) => s.id === subjectId));
} catch (err) {
  fail++;
  console.error("ERROR DURING TEST:", err.message);
  console.error(err.stack);
} finally {
  if (subjectId) {
    try { await call(subjectByIdHandler, "DELETE", { id: subjectId }, {}); console.log(" (cleanup: deleted scratch subject)"); }
    catch (e) { console.error("cleanup failed:", e.message); }
  }
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}