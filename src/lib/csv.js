export function splitCsvLine(line) {
  const cells = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

export function parseQuestionsCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const rows = [];
  const errors = [];

  lines.forEach((line, idx) => {
    const rowNum = idx + 1;
    const cells = splitCsvLine(line);

    if (idx === 0 && cells[0] && /^question$/i.test(cells[0])) {
      return;
    }

    if (cells.length < 6) {
      errors.push(
        `Row ${rowNum}: expected at least 6 columns, got ${cells.length}`
      );
      return;
    }

    const [question = "", o1 = "", o2 = "", o3 = "", o4 = "", c, ...rest] = cells;
    const explanation = rest.join(",").trim();
    const correct = Number(c);

    if (!question) {
      errors.push(`Row ${rowNum}: question is empty`);
      return;
    }
    if (!o1 || !o2 || !o3 || !o4) {
      errors.push(`Row ${rowNum}: all four options are required`);
      return;
    }
    if (!Number.isInteger(correct) || correct < 1 || correct > 4) {
      errors.push(`Row ${rowNum}: correct_option must be a number from 1-4`);
      return;
    }

    rows.push({
      question_text: question,
      options: [o1, o2, o3, o4],
      correct_option: correct,
      explanation,
    });
  });

  return { rows, errors };
}