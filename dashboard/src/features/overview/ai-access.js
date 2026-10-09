// Per-person AI Autofill access and usage (Admins). Everyone starts at Off; an Admin gives Match or Draft.

export const AI_LEVELS = Object.freeze([
  { value: "OFF", label: "Off", description: "No AI. Learned wordings (no AI cost) still answer." },
  { value: "MATCH", label: "Match questions", description: "AI matches new question wordings to standard answers." },
  { value: "DRAFT", label: "Match + draft answers", description: "Also drafts answers to open-ended questions for review." },
]);

const LEVELS = new Set(AI_LEVELS.map((level) => level.value));
const COUNTS = ["autofillRuns", "aiRuns", "pages", "questionsAsked", "questionsFromTable", "modelCalls", "questionsSent", "questionsMatched", "draftedAnswers", "costMicroUsd"];

export const aiLevelLabel = (level) => AI_LEVELS.find((item) => item.value === level)?.label || "Off";

/** Rows for the access table, with numbers coerced and unknown levels shown as Off; plus period totals. */
export function applierAiRows(report) {
  const rows = (Array.isArray(report?.appliers) ? report.appliers : []).filter((row) => row?.userId).map((row) => ({
    userId: String(row.userId), name: String(row.name || row.email || "Unknown"), email: String(row.email || ""), active: row.active !== false,
    level: LEVELS.has(row.level) ? row.level : "OFF", grantedAt: row.grantedAt || null, grantedByName: row.grantedByName || null,
    ...Object.fromEntries(COUNTS.map((field) => [field, Number(row[field]) || 0])),
  }));
  const totals = Object.fromEntries(COUNTS.map((field) => [field, rows.reduce((sum, row) => sum + row[field], 0)]));
  const withAccess = rows.filter((row) => row.level !== "OFF").length;
  return { rows, totals, withAccess };
}

/** The rows with one person's level changed (used for an immediate update while the change is saved). */
export function withLevel(rows, userId, level) {
  return rows.map((row) => row.userId === userId ? { ...row, level } : row);
}
