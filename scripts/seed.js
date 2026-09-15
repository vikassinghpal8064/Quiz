import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  console.error("No .env file found. Copy .env.example to .env and set DATABASE_URL first.");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const SEED = [
  {
    name: "Biology",
    icon_name: "🧬",
    description: "The science of life — cells, organisms, and the human body.",
    categories: [
      {
        name: "Cells & Genetics",
        description: "Organelles, DNA, and how cells work.",
        questions: [
          {
            q: "What organelle is known as the powerhouse of the cell?",
            explanation: "Mitochondria produce most of the cell's ATP through cellular respiration.",
            options: ["Nucleus", "Mitochondria", "Ribosome", "Golgi apparatus"],
            correct: 1,
          },
          {
            q: "Which molecule carries genetic information?",
            explanation: "DNA (deoxyribonucleic acid) stores the genetic blueprint of an organism.",
            options: ["RNA", "Protein", "DNA", "ATP"],
            correct: 2,
          },
          {
            q: "The process by which cells divide into two identical daughter cells is called…",
            explanation: "Mitosis produces two genetically identical cells.",
            options: ["Meiosis", "Fertilization", "Osmosis", "Mitosis"],
            correct: 3,
          },
        ],
      },
      {
        name: "Human Body",
        description: "Organs, systems, and how the body works.",
        questions: [
          {
            q: "What is the largest organ of the human body?",
            explanation: "The skin is the body's largest organ.",
            options: ["Liver", "Skin", "Brain", "Lungs"],
            correct: 1,
          },
          {
            q: "How many chambers does the human heart have?",
            explanation: "Two atria and two ventricles = four chambers.",
            options: ["2", "3", "4", "5"],
            correct: 2,
          },
          {
            q: "Which organ filters waste from the blood to produce urine?",
            explanation: "The kidneys filter blood and produce urine.",
            options: ["Kidneys", "Spleen", "Pancreas", "Gallbladder"],
            correct: 0,
          },
        ],
      },
    ],
  },
  {
    name: "Computer Science",
    icon_name: "💻",
    description: "Programming, databases, and how software really works.",
    categories: [
      {
        name: "JavaScript",
        description: "The language of the web.",
        questions: [
          {
            q: "Which keyword declares a constant variable in JavaScript?",
            explanation: "const declares a variable that can't be reassigned.",
            options: ["var", "let", "const", "static"],
            correct: 2,
          },
          {
            q: "What does `typeof null` return in JavaScript?",
            explanation: "A long-standing quirk — typeof null returns 'object'.",
            options: ["'null'", "'object'", "'undefined'", "'number'"],
            correct: 1,
          },
          {
            q: "Which method adds an element to the end of an array?",
            explanation: "arr.push(x) appends x to the end of the array.",
            options: ["push", "unshift", "concat", "pop"],
            correct: 0,
          },
          {
            q: "What does the `===` operator check?",
            explanation: "Strict equality — compares both value and type without coercion.",
            options: ["Value only", "Type only", "Value and type", "Reference identity"],
            correct: 2,
          },
        ],
      },
      {
        name: "SQL & Databases",
        description: "Querying and modeling relational data.",
        questions: [
          {
            q: "Which SQL clause filters rows by a condition?",
            explanation: "WHERE filters rows before grouping or selecting.",
            options: ["HAVING", "WHERE", "GROUP BY", "ORDER BY"],
            correct: 1,
          },
          {
            q: "A PRIMARY KEY in a table must be…",
            explanation: "A primary key is unique and not null for every row.",
            options: ["Unique but nullable", "Always an integer", "Unique and not null", "A foreign key"],
            correct: 2,
          },
          {
            q: "Which keyword sorts query results?",
            explanation: "ORDER BY sorts rows in ascending or descending order.",
            options: ["SORT", "ORDER BY", "GROUP BY", "FILTER BY"],
            correct: 1,
          },
        ],
      },
    ],
  },
  {
    name: "Geography",
    icon_name: "🌍",
    description: "Countries, capitals, and the world around us.",
    categories: [
      {
        name: "Capitals of the World",
        description: "Match the country to its capital city.",
        questions: [
          {
            q: "What is the capital of Japan?",
            explanation: "Tokyo is Japan's capital.",
            options: ["Osaka", "Kyoto", "Tokyo", "Hiroshima"],
            correct: 2,
          },
          {
            q: "What is the capital of Australia?",
            explanation: "Canberra is the capital — not Sydney.",
            options: ["Sydney", "Canberra", "Melbourne", "Perth"],
            correct: 1,
          },
          {
            q: "What is the capital of Canada?",
            explanation: "Ottawa is Canada's capital.",
            options: ["Toronto", "Vancouver", "Montreal", "Ottawa"],
            correct: 3,
          },
        ],
      },
    ],
  },
];

function splitSqlStatements(text) {
  const statements = [];
  let current = "";
  let inDollar = false;
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (!inDollar && !inQuote && ch === "$" && text.startsWith("$$", i)) {
      inDollar = true;
      current += "$$";
      i += 1;
      continue;
    }
    if (inDollar && ch === "$" && text.startsWith("$$", i)) {
      inDollar = false;
      current += "$$";
      i += 1;
      continue;
    }
    if (!inDollar && ch === "'") {
      inQuote = !inQuote;
      current += ch;
      continue;
    }
    if (!inDollar && !inQuote && ch === ";") {
      statements.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) statements.push(current);
  return statements;
}

// Destructive: wipe the six app tables for a clean, repeatable seed.
async function resetSchema() {
  const schema = readFileSync(path.join(root, "schema.sql"), "utf8");
  const statements = [
    ...splitSqlStatements(`
      DROP TABLE IF EXISTS attempt_answers CASCADE;
      DROP TABLE IF EXISTS quiz_attempts CASCADE;
      DROP TABLE IF EXISTS options CASCADE;
      DROP TABLE IF EXISTS questions CASCADE;
      DROP TABLE IF EXISTS categories CASCADE;
      DROP TABLE IF EXISTS subjects CASCADE;
    `),
    ...splitSqlStatements(schema),
  ];
  for (const statement of statements) {
    const text = statement.trim();
    if (text) await sql`${sql.unsafe(text)}`;
  }
}

async function seedContent() {
  const questionsByCategory = new Map();
  const categoryIdByName = new Map();

  for (const subject of SEED) {
    const [srow] = await sql`
      INSERT INTO subjects (name, description, icon_name)
      VALUES (${subject.name}, ${subject.description ?? null}, ${subject.icon_name ?? null})
      RETURNING id, name
    `;

    for (const category of subject.categories) {
      const [crow] = await sql`
        INSERT INTO categories (subject_id, name, description)
        VALUES (${srow.id}, ${category.name}, ${category.description ?? null})
        RETURNING id, name
      `;
      categoryIdByName.set(category.name, crow.id);

      const questionIds = [];
      for (const question of category.questions) {
        const [qrow] = await sql`
          INSERT INTO questions (category_id, question_text, explanation)
          VALUES (${crow.id}, ${question.q}, ${question.explanation ?? null})
          RETURNING id
        `;

        const insertedOptions = await sql.query(
          `INSERT INTO options (question_id, option_text, is_correct)
           VALUES ${question.options
             .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
             .join(", ")}
           RETURNING id`,
          question.options.flatMap((text, i) => [
            qrow.id,
            text,
            i === question.correct,
          ])
        );
        questionIds.push({
          id: qrow.id,
          optionIds: insertedOptions.map((o) => o.id),
          correctOptionId: insertedOptions[question.correct].id,
        });
      }

      questionsByCategory.set(category.name, questionIds);
      console.log(`✓ ${subject.name} / ${category.name} — ${category.questions.length} questions`);
    }
  }

  return { questionsByCategory, categoryIdByName };
}

// Demo attempts so QuizIntro shows stats/trends and practice mode has questions.
async function seedAttempts({ questionsByCategory, categoryIdByName }) {
  const attempts = [
    {
      categoryName: "JavaScript",
      mode: "full",
      answers: [
        { q: 0, correct: false },
        { q: 1, correct: false },
        { q: 2, correct: true },
        { q: 3, correct: true },
      ],
    },
    {
      categoryName: "JavaScript",
      mode: "full",
      answers: [
        { q: 0, correct: true },
        { q: 1, correct: false },
        { q: 2, correct: true },
        { q: 3, correct: false },
      ],
    },
    {
      categoryName: "Capitals of the World",
      mode: "wrong_only",
      answers: [
        { q: 0, correct: true },
        { q: 1, correct: false },
      ],
    },
  ];

  for (const attempt of attempts) {
    const category = questionsByCategory.get(attempt.categoryName);
    const correct = attempt.answers.filter((a) => a.correct).length;
    const [row] = await sql`
      INSERT INTO quiz_attempts (category_id, mode, finished_at, score, total_questions)
      VALUES (
        ${categoryIdByName.get(attempt.categoryName)},
        ${attempt.mode},
        now(),
        ${correct},
        ${attempt.answers.length}
      )
      RETURNING id
    `;

    for (const a of attempt.answers) {
      const q = category[a.q];
      const selected =
        a.correct ? q.correctOptionId : q.optionIds.find((id) => id !== q.correctOptionId);
      await sql`
        INSERT INTO attempt_answers (attempt_id, question_id, selected_option_id, is_correct)
        VALUES (${row.id}, ${q.id}, ${selected}, ${a.correct})
      `;
    }
  }
  console.log("✓ Seeded 3 demo attempts (includes a 'wrongly answered' question for practice mode)");
}

async function main() {
  console.log("Resetting schema (drops subjects, categories, questions, options, quiz_attempts, attempt_answers)…");
  await resetSchema();
  const seeded = await seedContent();
  await seedAttempts(seeded);
  console.log("Seed complete. Run `npm run dev` and open http://localhost:5173");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});