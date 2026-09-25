// Resume headline under the candidate's name: the target job's title, cleaned of posting noise
// and capped at the Resume's recorded seniority. Returns null when no truthful, readable
// headline can be derived; the caller then falls back to a manager-set headline or none.
// Employment titles are never touched; this is a positioning label only.

const IC_RANK: Record<string, number> = { INTERN: 0, ENTRY: 1, JUNIOR: 2, MID: 3, SENIOR: 4, LEAD: 5, PRINCIPAL: 6 };
const MANAGEMENT_SENIORITIES = new Set(["MANAGER", "DIRECTOR", "EXECUTIVE"]);
const LEVEL_WORDS: Array<[RegExp, number]> = [
  [/\b(?:distinguished|principal|staff)\b\+?/gi, 6],
  [/\blead\b/gi, 5],
  [/\bsenior\b/gi, 4],
  [/\b(?:junior|associate|entry[- ]level)\b/gi, 2],
  [/\bintern(?:ship)?\b/gi, 0],
];
const CAPPED_WORD: Record<number, string> = { 4: "Senior", 5: "Lead", 6: "Principal" };
const MANAGEMENT = /\b(?:manager|director|head of|vice president|vp|chief|cto|cio|cdo)\b/i;
const ROLE_NOUN = /\b(?:engineer|developer|scientist|analyst|architect|administrator|consultant|specialist|programmer|designer|sre|dba|devops|modeler|statistician|researcher)s?\b/i;
const NOISE = /\b(?:remote|hybrid|on-?site|onsite|contract(?:or)?|contract-to-hire|full[- ]time|part[- ]time|temporary|w2|c2c|1099|usa?|united states|urgent|immediate(?:ly)?|hiring|opening|position|role|job|req(?:uisition)?|apply)\b/i;

const collapse = (value: string) => value.replace(/\s+/g, " ").trim();
const words = (value: string) => new Set(value.toLowerCase().match(/[a-z0-9]+/g) || []);

// A short suffix after a comma or dash is usually a specialization ("Backend", "APIs"),
// but it can also be the hiring company, a location, or a pay rate; keep only clean ones.
function keepSuffix(suffix: string, company: string) {
  const value = collapse(suffix);
  if (!value || value.split(" ").length > 3 || NOISE.test(value) || /[\d$]/.test(value) || MANAGEMENT.test(value)) return false;
  const companyWords = words(company), suffixWords = [...words(value)];
  return !(companyWords.size && suffixWords.some(word => companyWords.has(word) && word.length > 2));
}

export function cleanJobTitle(raw: unknown, company: unknown = ""): string {
  let title = collapse(String(raw ?? "")).replace(/\([^)]*\)|\[[^\]]*\]/g, " ");        // (Remote), [Contract], (Senior/Staff)
  title = title.split(/\s*\|\s*|\s·\s/)[0];                                                // " | Root Insurance", " · Full time"
  const [head, ...dashed] = title.split(/\s[-–—]\s|\s[–—]|[–—]\s/);                      // " - Frontend", " – Data & Analytics"
  const [base, ...commaed] = head.split(",");
  const suffix = collapse(commaed.join(",")) || collapse(dashed[0] || "");
  title = keepSuffix(suffix, String(company ?? "")) ? `${collapse(base)}, ${suffix}` : collapse(base);
  title = title.replace(/(?:#|\bno\.?\s*)?\b[A-Z]{0,4}-?\d{3,}\b/gi, " ")                   // requisition IDs
    .replace(/\b(?:level|lvl|grade|band)\s*\d+\b|\b(?:l|ic|p|e)\d\b/gi, " ")                 // L5, IC4, Level 3
    .replace(/\s(?:I{1,3}|IV|V)(?=\s*(?:,|$))/g, " ")                                      // Engineer II
    .replace(/\bsr\b\.?/gi, "Senior").replace(/\bjr\b\.?/gi, "Junior");
  return collapse(title.replace(/\s+,/g, ",").replace(/,\s*$/, ""));
}

export function tailoredHeadline(jobTitle: unknown, resumeSeniority: unknown, company: unknown = ""): string | null {
  const seniority = String(resumeSeniority ?? "UNSPECIFIED").toUpperCase();
  // "Founding" describes the hiring company's history, not the candidate.
  let title = cleanJobTitle(jobTitle, company).replace(/\bfounding\b/gi, " ");
  // A plural role ("Data Engineers Databricks") is a posting headline, not a person's title.
  if (/\b(?:engineers|developers|scientists|analysts|architects)\b/i.test(title)) return null;
  if (!title || !ROLE_NOUN.test(title) || NOISE.test(title)) return null;
  if (MANAGEMENT.test(title)) return MANAGEMENT_SENIORITIES.has(seniority) && title.length <= 60 ? title : null;
  const found = LEVEL_WORDS.filter(([pattern]) => { pattern.lastIndex = 0; return pattern.test(title); });
  const highest = found.length ? Math.max(...found.map(([, rank]) => rank)) : -1, cap = IC_RANK[seniority];
  // Never claim a level above the Resume's. Unknown seniority keeps no level word at all.
  const capTo = cap === undefined ? (MANAGEMENT_SENIORITIES.has(seniority) ? highest : -1) : Math.min(highest, cap);
  if (found.length && capTo !== highest) {
    for (const [pattern] of found) title = title.replace(pattern, " ");
    title = `${CAPPED_WORD[capTo] ?? ""} ${title}`;
  }
  title = collapse(title.replace(/^[,\s]+/, "").replace(/\s+,/g, ","));
  if (!ROLE_NOUN.test(title) || title.length > 60 || title.split(" ").length > 8) return null;
  return title;
}
