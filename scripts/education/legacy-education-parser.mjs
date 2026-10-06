// Splits a Resume's free-text "legacy education" into structured education entries
// (institution, degree, field of study, start/end date) for a one-time, human-reviewed conversion.
// It never guesses: anything it cannot place is reported as a warning for the reviewer.

const MONTH_YEAR = String.raw`(?:(0?[1-9]|1[0-2])\s*\/\s*)?((?:19|20)\d{2})`;
const RANGE = new RegExp(String.raw`${MONTH_YEAR}(?:\s*[-–—]\s*(?:${MONTH_YEAR}|(present|current)))?`, "i");
const INSTITUTION = /\b(university|college|institute|school|academy|polytechnic|conservatory)\b/i;
const DEGREE = /^(?:bachelor|master|associate|doctor|doctorate|ph\.?\s?d|mba|b\.?\s?s\.?c?|m\.?\s?s\.?c?|b\.?\s?a\.?|m\.?\s?a\.?|b\.?\s?tech|m\.?\s?tech|b\.?\s?e\.?|m\.?\s?e\.?|diploma|certificate|high school)\b/i;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").replace(/^[\s,;]+|[\s,;]+$/g, "").trim();
const normalizeApostrophes = (value) => String(value ?? "").replace(/\s*[ʼ’`]\s*s\b/g, "'s").replace(/[ʼ’`]/g, "'");

function dateParts(month, year) {
  if (!year) return null;
  return month ? { year: Number(year), month: Number(month) } : { year: Number(year) };
}

// Finds the date range in a line. Returns the dates and the line with the range removed.
function extractRange(line) {
  const match = line.match(RANGE);
  if (!match) return null;
  const [text, startMonth, startYear, endMonth, endYear, open] = match;
  const hasEnd = Boolean(endYear || open);
  return {
    // A lone date ("08/2024") is when the program ended.
    start: hasEnd ? dateParts(startMonth, startYear) : null,
    end: hasEnd ? (open ? null : dateParts(endMonth, endYear)) : dateParts(startMonth, startYear),
    current: Boolean(open),
    rest: clean(line.replace(text, " ")),
    leading: line.trimStart().startsWith(text.trimStart()),
  };
}

// Groups lines into entries; a date range closes the entry it belongs to.
function splitEntries(text) {
  const entries = [];
  let lines = [];
  for (const raw of normalizeApostrophes(text).split(/\r?\n/)) {
    const line = clean(raw);
    if (!line) continue;
    const range = extractRange(line);
    if (!range) { lines.push(line); continue; }
    if (range.rest) lines.push(range.rest);
    entries.push({ lines, range });
    lines = [];
  }
  if (lines.length) entries.push({ lines, range: null });
  return entries;
}

const isInstitution = (segment) => INSTITUTION.test(segment) && !DEGREE.test(segment);
const isDegree = (segment) => DEGREE.test(segment) || /\b(bachelor|master)'?s?\b/i.test(segment);

// "Bachelor of Science (BS) degree in Software Engineering" → degree + field of study.
function splitDegree(segment) {
  const inMatch = segment.match(/^(.*?\b(?:bachelor|master|associate|doctor|degree|diploma|mba)\b.*?)\s+in\s+(.+)$/i);
  // "(BS) degree in X" drops the filler word; "Bachelor's Degree in X" keeps it.
  if (inMatch) return { degree: clean(inMatch[1].replace(/\)\s+degree$/i, ")")), field: clean(inMatch[2]) };
  const comma = segment.indexOf(", ");
  if (comma > 0) return { degree: clean(segment.slice(0, comma)), field: clean(segment.slice(comma + 2)) };
  return { degree: clean(segment), field: "" };
}

function parseEntry({ lines, range }) {
  const warnings = [];
  // " , " separates degree and school in single-line entries; a comma inside a school name has no space before it.
  const segments = lines.flatMap((line) => line.split(/\s+,\s*/)).map(clean).filter(Boolean);
  const classified = [];
  for (const segment of segments) {
    const kind = isInstitution(segment) ? "institution" : isDegree(segment) ? "degree" : "other";
    const previous = classified.at(-1);
    // Wrapped lines ("…Digital Arts" / "and Sciences") continue the previous degree.
    if (previous && kind === "other" && (previous.kind === "degree" || /^[a-z&]/.test(segment))) { previous.text = `${previous.text} ${segment}`; continue; }
    classified.push({ kind, text: segment });
  }
  const institutions = classified.filter((item) => item.kind === "institution").map((item) => item.text);
  const degrees = classified.filter((item) => item.kind === "degree").map((item) => item.text);
  const others = classified.filter((item) => item.kind === "other").map((item) => item.text);
  const { degree, field } = degrees.length ? splitDegree(degrees.join(", ")) : { degree: "", field: others.join(", ") };
  if (!institutions.length) warnings.push("No school name found.");
  if (institutions.length > 1) warnings.push(`More than one school name: ${institutions.join(" | ")}.`);
  if (!degree) warnings.push(field ? "No degree name found; the text was kept as the field of study." : "No degree found.");
  if (degrees.length && others.length) warnings.push(`Text not placed: ${others.join(" | ")}.`);
  if (!range) warnings.push("No dates found.");
  if (range?.current) warnings.push("Still studying (no end date).");
  if (range && !range.start) warnings.push("Only an end date was found.");
  return {
    entry: {
      institution: institutions[0] || "",
      degree,
      field_of_study: field,
      location: "",
      start_date: range?.start || null,
      end_date: range?.end || null,
      gpa: "",
      details: "",
    },
    warnings,
  };
}

export function parseLegacyEducation(text) {
  return splitEntries(text).map(parseEntry).filter(({ entry }) => entry.institution || entry.degree || entry.field_of_study);
}
