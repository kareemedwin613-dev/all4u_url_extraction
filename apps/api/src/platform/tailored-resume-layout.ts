import { tailoredHeadline } from "./tailored-headline.js";
import { MAX_TAILORED_SKILLS, resolveTailoredSkillGroups, type TailoredSkillGroup } from "./tailored-skill-groups.js";

// Keep the complete ranked section, not a silent top-30 subset of the saved preview.
// The PDF renderers paginate nonempty groups; the same 80-skill limit applies end to end.
export const RENDERED_SKILL_LIMIT = MAX_TAILORED_SKILLS;
export const ENVIRONMENT_LIMIT = 10;

const clean = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ");
const key = (value: unknown) => clean(value).toLocaleLowerCase();
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function resolveResumeHeadline(input: Record<string, any>): string | null {
  return tailoredHeadline(input?.targetJob?.title, input?.resumeSeniority, input?.targetJob?.company) || clean(input?.resumeHeadline) || null;
}

// Top skills only, grouped. A group's weight is the summed relevance of its skills, so one
// highly ranked tool ("Excel") does not outrank a group of core skills; the catch-all goes last.
export function renderedSkillGroups(skillsValue: unknown, groupsValue: unknown, limit = RENDERED_SKILL_LIMIT): TailoredSkillGroup[] {
  const seen = new Set<string>(), top: string[] = [];
  for (const raw of Array.isArray(skillsValue) ? skillsValue : []) {
    const skill = clean(raw), skillKey = key(skill);
    if (!skill || seen.has(skillKey)) continue;
    seen.add(skillKey); top.push(skill);
    if (top.length === limit) break;
  }
  const rank = new Map(top.map((skill, index) => [key(skill), index]));
  const weight = (group: TailoredSkillGroup) => group.name === "Additional Skills" ? -1 : group.skills.reduce((sum, skill) => sum + top.length - (rank.get(key(skill)) ?? top.length), 0);
  return resolveTailoredSkillGroups(top, groupsValue).map(group => ({ ...group, skills: group.skills.filter(skill => rank.has(key(skill))) }))
    .filter(group => group.skills.length).sort((left, right) => weight(right) - weight(left));
}

// Short terms (C, R, Go) match too much ordinary prose to count as evidence.
function mentions(text: string, skill: string) {
  const term = clean(skill);
  return term.length >= 3 && new RegExp(`(?<![A-Za-z0-9])${term.split(" ").map(escapeRegExp).join("\\s+")}(?![A-Za-z0-9])`, "i").test(text);
}

// One rendered Education entry: bold primary line (degree, or school when no degree is known)
// with the date range right-aligned, and the school on the line below.
export type ResumeEducationEntry = { degree: string; institution: string; range: string; details: string };

const YEAR = String.raw`(?:\d{1,2}\/)?(?:19|20)\d{2}`;
const DATE_RANGE = new RegExp(String.raw`\(?(${YEAR})(?:\s*[–—-]\s*(${YEAR}|present|current|now))?\)?`, "i");
const TRAILING_DATE = new RegExp(String.raw`[\s,]*${DATE_RANGE.source}\s*$`, "i");
const LEADING_DATE = new RegExp(String.raw`^\s*${DATE_RANGE.source}[\s,:-]*`, "i");
const SCHOOL = /\b(universit\w*|college|institute|school|academy|polytechnic)\b/i;
// Undotted abbreviations are excluded: "MA", "MS", and "IN" are also state codes in locations.
const DEGREE = /\b(bachelor\w*|master\w*|associate\w*|doctor\w*|ph\.?\s?d|mba|diploma|degree)\b|\b[bm]\.\s?(sc?|a|tech|e|eng)\b\.?/i;

function splitDate(line: string): { text: string; range: string } {
  const format = (match: RegExpMatchArray) => [match[1], match[2] && (/^\d/.test(match[2]) ? match[2] : "Present")].filter(Boolean).join(" – ");
  const trailing = line.match(TRAILING_DATE);
  if (trailing) return { text: clean(line.slice(0, trailing.index)).replace(/[\s,(–—-]+$/, ""), range: format(trailing) };
  const leading = line.match(LEADING_DATE);
  if (leading) return { text: clean(line.slice(leading[0].length)), range: format(leading) };
  return { text: clean(line), range: "" };
}

// A line naming both a degree and a school ("B.S., Computer Science, Example University, Boston, MA")
// splits at commas and spaced dashes; parts after the school are its location and are dropped.
function degreeAndSchool(text: string): { degree?: string; institution?: string } {
  if (!SCHOOL.test(text)) return { degree: text };
  if (!DEGREE.test(text)) return { institution: text };
  const parts = text.split(/\s*,\s*|\s+[–—-]\s+/).map(clean).filter(Boolean), school = parts.findIndex(part => SCHOOL.test(part));
  const before = parts.slice(0, school), after = parts.slice(school + 1).filter(part => DEGREE.test(part));
  return { degree: [...before, ...after].join(", "), institution: parts[school] };
}

// Plain-text education (the only form current Resumes store) becomes entries: a school or degree
// that is already filled, or any new text after a complete entry, starts the next entry. When the
// school came first and no date has closed the entry, a second degree line continues the first
// (school, degree, degree, date); degree-first entries (degree, school, degree, school) still split.
function parseLegacyEducation(value: unknown): ResumeEducationEntry[] {
  const entries: ResumeEducationEntry[] = [];
  let current: ResumeEducationEntry = { degree: "", institution: "", range: "", details: "" }, schoolFirst = false;
  const push = () => { if (current.degree || current.institution || current.range) entries.push(current); current = { degree: "", institution: "", range: "", details: "" }; schoolFirst = false; };
  for (const line of String(value ?? "").split(/\r?\n/).map(clean).filter(Boolean)) {
    const { text, range } = splitDate(line);
    if (text) {
      const parts = degreeAndSchool(text);
      const complete = Boolean(current.degree && current.institution && current.range);
      const continuesDegree = Boolean(parts.degree && !parts.institution && current.degree && schoolFirst && !current.range);
      if (continuesDegree) current.degree = `${current.degree}, ${parts.degree}`;
      else {
        if (complete || (parts.degree && current.degree) || (parts.institution && current.institution)) push();
        if (!current.degree && !current.institution && parts.institution && !parts.degree) schoolFirst = true;
        if (parts.degree) current.degree = parts.degree;
        if (parts.institution) current.institution = parts.institution;
      }
    }
    if (range) { if (current.range) push(); current.range = range; }
  }
  push();
  return entries;
}

export function resumeEducationEntries(structured: Record<string, any>): ResumeEducationEntry[] {
  const items = Array.isArray(structured?.education) ? structured.education : [];
  if (!items.length) return parseLegacyEducation(structured?.education_legacy_text);
  const part = (value: any) => value?.year ? (value.month ? `${String(value.month).padStart(2, "0")}/${value.year}` : String(value.year)) : "";
  return items.map((item: any) => ({
    degree: [item.degree, item.field_of_study, item.gpa ? `GPA: ${item.gpa}` : ""].map(clean).filter(Boolean).join(", "),
    institution: clean(item.institution),
    range: [part(item.start_date), item.is_current ? "Present" : part(item.end_date)].filter(Boolean).join(" – "),
    details: clean(item.details),
  })).filter((entry: ResumeEducationEntry) => entry.degree || entry.institution);
}

// Technologies for one role: final skills that the role's own source details name, in priority order.
export function roleEnvironment(skillsValue: unknown, roleDetails: unknown, limit = ENVIRONMENT_LIMIT): string[] {
  const details = String(roleDetails ?? ""), found: string[] = [], seen = new Set<string>();
  for (const raw of Array.isArray(skillsValue) ? skillsValue : []) {
    const skill = clean(raw);
    if (!skill || seen.has(key(skill)) || !mentions(details, skill)) continue;
    seen.add(key(skill)); found.push(skill);
    if (found.length === limit) break;
  }
  return found.length >= 2 ? found : [];
}
