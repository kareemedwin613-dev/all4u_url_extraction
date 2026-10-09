// Workday "My Experience": work history, education and skills.
//
// Workday adds each job or school inline behind an "Add" button (no per-entry Save). Its controls carry ids like
//   workExperience-3--jobTitle, workExperience-3--startDate-dateSectionMonth-input, education-2--degree,
//   education-2--fieldOfStudy, education-2--firstYearAttended-dateSectionYear-input, skills--skills
// Dates are separate MM / YYYY boxes, Degree is a button that opens a listbox, Field of Study and Skills are
// search prompts (type, press Enter, pick a result).
//
// Entries already on the page (Workday parses the uploaded Resume) are matched to Resume rows by company or school
// and only their empty fields are filled; nothing a person or Workday entered is overwritten. When a section has no
// entries, every Resume row is added. Only Add buttons, dropdown buttons and options are clicked: never
// "Save and Continue", "Submit" or anything else that moves the application on.
import { safeToClick } from "./repeatable-sections.js";

export const WORKDAY_SECTION_ATTRIBUTE = "data-resume-jd-section";
const ENTRY_ID = /^(workExperience|education)-(\d+)--([A-Za-z]+)(?:-(dateSectionMonth|dateSectionYear)-input)?$/;
const KIND = { workExperience: "employment", education: "education" };
const LEAF = {
  jobTitle: "jobTitle", companyName: "company", company: "company", location: "location", currentlyWorkHere: "isCurrent", roleDescription: "description",
  description: "description", startDate: "startDate", endDate: "endDate",
  schoolName: "institution", school: "institution", degree: "degree", fieldOfStudy: "fieldOfStudy", gradeAverage: "gpa",
  firstYearAttended: "startDate", lastYearAttended: "endDate",
};
const HEADINGS = { employment: /^work\s+experience$/i, education: /^education$/i };
const SKILLS_INPUT = 'input[id="skills--skills"], [data-automation-id="formField-skills"] input';
const OPTION = '[data-automation-id="promptOption"], [role="option"]';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const norm = (value) => clean(value).toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();
async function waitFor(check, timeout = 3000, interval = 60) {
  const started = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - started >= timeout) return null;
    await sleep(interval);
  }
}
const visible = (element) => !element || typeof element.getClientRects !== "function" || element.getClientRects().length > 0;

export function isWorkdayHost(hostname) {
  return /(?:^|\.)(?:myworkdayjobs\.com|myworkdaysite\.com|myworkday\.com)$/i.test(String(hostname || ""));
}

// --- Reading the page ----------------------------------------------------------------------------------------

// { employment: [{ n, fields: { jobTitle: { element }, startDate: { month, year }, ... } }], education: [...] } in page order.
export function workdayEntries(root = document) {
  const groups = new Map();
  for (const element of root.querySelectorAll("input[id], textarea[id], button[id]")) {
    const match = String(element.id).match(ENTRY_ID);
    if (!match) continue;
    const [, prefix, n, field, part] = match, kind = KIND[prefix], leaf = LEAF[field];
    if (!kind || !leaf) continue;
    const key = `${kind}:${n}`;
    if (!groups.has(key)) groups.set(key, { kind, n: Number(n), fields: {} });
    const fields = groups.get(key).fields;
    if (part) {
      fields[leaf] = fields[leaf] || {};
      fields[leaf][part === "dateSectionMonth" ? "month" : "year"] = element;
    } else if (!fields[leaf]) fields[leaf] = { element };
  }
  const result = { employment: [], education: [] };
  for (const group of [...groups.values()].sort((a, b) => a.n - b.n)) result[group.kind].push(group);
  return result;
}

function headingOf(node) {
  const labelled = (node.getAttribute?.("aria-labelledby") || "").split(" ").map((id) => clean(node.ownerDocument?.getElementById?.(id)?.textContent)).filter(Boolean)[0];
  if (labelled) return labelled;
  const heading = [...(node.children || [])].find((child) => /^h[1-4]$/i.test(child.tagName) || child.getAttribute?.("role") === "heading");
  return clean(heading?.textContent);
}

// The section's own "Add" / "Add Another" button, found by the section heading ("Work Experience", "Education").
export function workdayAddButton(root, kind) {
  for (const button of root.querySelectorAll('button[data-automation-id="add-button"], button')) {
    const label = clean(button.getAttribute("aria-label") || button.textContent);
    if (!/^add(?:\s+another)?\b/i.test(label) || !safeToClick(button)) continue;
    // "Add Work Experience" names its section; "Add" and "Add Another" are found by their section heading.
    const named = label.replace(/^add(?:\s+another)?/i, "").trim();
    if (named) {
      if (HEADINGS[kind].test(named)) return button;
      continue;
    }
    for (let node = button.parentElement, depth = 0; node && depth < 6; node = node.parentElement, depth += 1) {
      const heading = headingOf(node);
      if (!heading) continue;
      if (HEADINGS[kind].test(heading)) return button;
      break;
    }
  }
  return null;
}

const skillsInput = (root) => root.querySelector(SKILLS_INPUT);

// What the panel needs to know before filling: which sections exist and whether they already have entries.
export function detectWorkdaySections(root = document) {
  const entries = workdayEntries(root), found = [];
  for (const kind of ["employment", "education"]) {
    const add = workdayAddButton(root, kind);
    if (add || entries[kind].length) found.push({ kind, existing: entries[kind].length, addable: true, fillExisting: true });
  }
  if (skillsInput(root)) found.push({ kind: "skills", existing: 0, addable: true });
  return found;
}

// Section controls belong to this module; the field matchers and the unanswered-question report skip them.
export function claimWorkdaySectionControls(root = document) {
  for (const element of root.querySelectorAll("input[id], textarea[id], button[id]")) {
    if (ENTRY_ID.test(String(element.id)) || element.id === "skills--skills") element.setAttribute(WORKDAY_SECTION_ATTRIBUTE, "workday");
  }
  skillsInput(root)?.setAttribute(WORKDAY_SECTION_ATTRIBUTE, "workday");
}

// --- Filling one control ------------------------------------------------------------------------------------

function nativeSet(element, value) {
  const proto = element.tagName === "TEXTAREA" ? globalThis.HTMLTextAreaElement?.prototype : globalThis.HTMLInputElement?.prototype;
  const setter = proto && Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(element, value); else element.value = value;
}

// Text, textarea and the MM / YYYY date boxes: set, announce, leave the box so Workday commits it.
function typeValue(element, value) {
  if (!element || element.disabled) return false;
  element.focus?.();
  nativeSet(element, value);
  for (const type of ["input", "change"]) element.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
  element.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
  element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  return clean(element.value) === clean(value);
}

const empty = (element) => !element || (element.type === "checkbox" ? false : !clean(element.value ?? element.textContent));

function setCheckbox(element, wanted) {
  if (!element || element.type !== "checkbox") return false;
  if (Boolean(element.checked) !== Boolean(wanted)) element.click();
  return Boolean(element.checked) === Boolean(wanted);
}

// "2019-06" → { month: "06", year: "2019" }; "2019" → { year: "2019" }.
function dateParts(value) {
  const match = String(value || "").match(/^(\d{4})(?:-(\d{2}))?$/);
  return match ? { year: match[1], month: match[2] } : null;
}

async function fillDate(boxes, value, overwrite) {
  const parts = dateParts(value);
  if (!boxes || !parts) return null;
  let ok = true;
  if (boxes.month && parts.month && (overwrite || empty(boxes.month))) ok = typeValue(boxes.month, parts.month) && ok;
  if (boxes.year && (overwrite || empty(boxes.year))) ok = typeValue(boxes.year, parts.year) && ok;
  return ok;
}

function optionScore(text, wanted, strict) {
  const a = norm(text), b = norm(wanted);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (strict) return 0;
  if (a.startsWith(b) || b.startsWith(a)) return 80;
  if (a.includes(b) || b.includes(a)) return 60;
  const words = new Set(a.split(" ")), shared = b.split(" ").filter((word) => words.has(word)).length;
  return shared ? Math.round((40 * shared) / Math.max(words.size, b.split(" ").length)) : 0;
}

function bestOption(root, wanted, strict, minimum) {
  let best = null;
  for (const option of root.querySelectorAll(OPTION)) {
    if (!visible(option)) continue;
    const score = optionScore(option.getAttribute("aria-label") || option.textContent, wanted, strict);
    if (score >= minimum && (!best || score > best.score)) best = { option, score };
  }
  return best?.option || null;
}

const DEGREE_LEVELS = [
  [/\b(?:bachelor|b\.?\s?s\.?c?|b\.?\s?a\.?|b\.?\s?eng|b\.?\s?tech|undergraduate)\b/i, "bachelor"],
  [/\b(?:master|m\.?\s?s\.?c?|m\.?\s?a\.?|mba|m\.?\s?eng|m\.?\s?tech)\b/i, "master"],
  [/\b(?:ph\.?\s?d|doctor|doctorate|d\.?\s?phil)\b/i, "doctor"],
  [/\bassociate\b/i, "associate"],
  [/\b(?:high\s+school|ged|secondary)\b/i, "high school"],
];
export function degreeLevel(value) { return DEGREE_LEVELS.find(([pattern]) => pattern.test(String(value || "")))?.[1] || ""; }

function closePopup(element) {
  element?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
}

// Degree: a button that opens a listbox of options. The Resume's wording is tried first, then its level.
async function chooseFromListbox(root, button, wanted) {
  if (!safeToClick(button)) return false;
  if (optionScore(button.textContent, wanted, false) >= 80) return true;
  button.click();
  const level = degreeLevel(wanted);
  const option = await waitFor(() => bestOption(root, wanted, false, 60) || (level ? bestOption(root, level, false, 60) : null), 2500);
  if (!option) { closePopup(button); return false; }
  option.click();
  return Boolean(await waitFor(() => optionScore(button.textContent, clean(option.textContent), false) >= 80, 1500));
}

// Field of Study, a search-style School field and Skills: type, press Enter to search, pick the best result.
// Enter is a synthetic key event, which browsers never treat as submitting a form.
async function chooseFromPrompt(root, input, wanted, { strict = false } = {}) {
  const container = input.closest?.('[data-automation-id^="formField"], [data-uxi-widget-type], [role="group"]') || input.parentElement;
  const selectedNow = () => [...(container?.querySelectorAll?.('[data-automation-id="selectedItem"]') || [])].map((item) => clean(item.textContent));
  if (selectedNow().some((text) => optionScore(text, wanted, strict) >= (strict ? 100 : 80))) return true;
  typeValue(input, wanted);
  input.focus?.();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
  // Results that appear without a match end the wait at once ("Kubernetes" not in this employer's list).
  let shown = false;
  const option = await waitFor(() => {
    const found = bestOption(root, wanted, strict, strict ? 100 : 60);
    if (found) return found;
    if ([...root.querySelectorAll(OPTION)].some(visible)) { if (shown) return "none"; shown = true; }
    return null;
  }, strict ? 1500 : 3000);
  if (option === "none") { closePopup(input); typeValue(input, ""); return false; }
  if (!option) { closePopup(input); typeValue(input, ""); return false; }
  option.click();
  const chosen = clean(option.getAttribute("aria-label") || option.textContent);
  const ok = Boolean(await waitFor(() => selectedNow().some((text) => optionScore(text, chosen, false) >= 80), 1500));
  closePopup(input);
  return ok;
}

// Clears the selected values of a search box that do not match the wanted one (Workday's parser often picks a wrong
// Field of Study). A selected value is cleared the way a person does: focus it and press Delete.
async function clearOtherSelections(input, wanted) {
  const container = input.closest?.('[data-automation-id^="formField"], [data-uxi-widget-type], [role="group"]') || input.parentElement;
  for (const item of [...(container?.querySelectorAll?.('[data-automation-id="selectedItem"]') || [])]) {
    if (optionScore(item.textContent, wanted, false) >= 80) continue;
    item.focus?.();
    for (const key of ["Delete", "Backspace"]) item.dispatchEvent(new KeyboardEvent("keydown", { key, code: key, bubbles: true }));
    await sleep(80);
  }
}

const isPrompt = (input) => Boolean(input?.closest?.('[data-automation-id="multiselectInputContainer"], [data-uxi-widget-type="multiselect"]')) || /^search$/i.test(clean(input?.getAttribute?.("placeholder")));

// --- Filling entries ----------------------------------------------------------------------------------------

async function fillEntry(root, entry, row, overwrite) {
  let failed = false;
  const step = async (leaf, work) => {
    const value = row[leaf];
    if (value === undefined || value === null || value === "") return;
    const outcome = await work(value);
    if (outcome === false) failed = true;
    await sleep(40);
  };
  const fields = entry.fields;
  for (const leaf of ["jobTitle", "company", "location", "institution", "gpa"]) {
    const element = fields[leaf]?.element;
    if (!element || !(overwrite || empty(element))) continue;
    await step(leaf, async (value) => {
      if (leaf !== "institution" || !isPrompt(element)) return typeValue(element, value);
      if (overwrite) await clearOtherSelections(element, value);
      return chooseFromPrompt(root, element, value);
    });
  }
  if (fields.degree?.element && row.degree && (overwrite || /^(select one)?$/i.test(clean(fields.degree.element.textContent)))) {
    await step("degree", (value) => chooseFromListbox(root, fields.degree.element, value));
  }
  if (fields.fieldOfStudy?.element && row.fieldOfStudy) await step("fieldOfStudy", async (value) => {
    if (overwrite) await clearOtherSelections(fields.fieldOfStudy.element, value);
    return chooseFromPrompt(root, fields.fieldOfStudy.element, value);
  });
  // "I currently work here" follows the Resume both ways when overwriting; the end date boxes appear or disappear with it.
  if (fields.isCurrent?.element && (row.isCurrent || overwrite)) {
    await step("isCurrent", (value) => setCheckbox(fields.isCurrent.element, Boolean(value)));
    await sleep(120);
  }
  const current = workdayEntries(root)[entry.kind]?.find((item) => item.n === entry.n)?.fields || fields;
  await step("startDate", (value) => fillDate(current.startDate, value, overwrite));
  if (!row.isCurrent) await step("endDate", (value) => fillDate(current.endDate, value, overwrite));
  const description = current.description?.element || fields.description?.element;
  if (description && (overwrite || empty(description))) await step("description", (value) => typeValue(description, value));
  return !failed;
}

// Pairs each entry already on the page with a Resume row: the row whose company (or school) or title it shows, else
// the next unused row in Resume order (Workday's parser keeps the order but often garbles names).
export function pairWorkdayEntries(kind, entries, rows) {
  const used = new Set(), pairs = new Map();
  // Company (or school) first across every entry, then job title, so a title such as "Software Engineer" inside
  // "Senior Software Engineer" never takes a row another entry names by company.
  for (const leaf of kind === "employment" ? ["company", "jobTitle"] : ["institution"]) {
    for (const entry of entries) {
      if (pairs.has(entry)) continue;
      const index = rowForEntry(entry, rows, used, leaf);
      if (index >= 0) { used.add(index); pairs.set(entry, index); }
    }
  }
  for (const entry of entries) {
    if (pairs.has(entry)) continue;
    const index = rows.findIndex((_, position) => !used.has(position));
    if (index < 0) break;
    used.add(index); pairs.set(entry, index);
  }
  return { pairs, used };
}

// The unused Resume row whose company, school or title (leaf) the entry shows: an exact match first, then one name
// containing the other.
function rowForEntry(entry, rows, used, leaf) {
  const shown = norm(entry.fields[leaf]?.element?.value);
  if (!shown) return -1;
  const free = [...rows.entries()].filter(([index, row]) => !used.has(index) && norm(row[leaf]));
  const exact = free.find(([, row]) => norm(row[leaf]) === shown);
  if (exact) return exact[0];
  const near = free.find(([, row]) => shown.includes(norm(row[leaf])) || norm(row[leaf]).includes(shown));
  return near ? near[0] : -1;
}

export async function fillWorkdaySections(root = document, sections = {}) {
  const results = [];
  const result = (kind, index, status, code) => ({ fieldId: `section_${kind}_${index}`, key: `${kind}.${index}.entry`, status, code });
  for (const kind of ["employment", "education"]) {
    const rows = Array.isArray(sections?.[kind]) ? sections[kind] : [];
    if (!rows.length) continue;
    const existing = workdayEntries(root)[kind];
    let toAdd = [...rows.keys()];
    if (existing.length) {
      // Workday's own resume parsing is not trusted: every entry paired with a Resume row is overwritten from the
      // Resume. Entries beyond the Resume's rows are left as they are (Delete is never clicked).
      const { pairs, used } = pairWorkdayEntries(kind, existing, rows);
      for (const entry of existing) {
        if (!pairs.has(entry)) continue;
        const index = pairs.get(entry);
        const ok = await fillEntry(root, entry, rows[index], true);
        results.push(result(kind, index, ok ? "VERIFIED" : "FAILED", ok ? "FIELD_VERIFIED" : "FIELD_VERIFICATION_FAILED"));
      }
      toAdd = toAdd.filter((index) => !used.has(index));
    }
    for (const index of toAdd) {
      const row = rows[index];
      const required = kind === "employment" ? row.jobTitle : row.institution;
      if (!clean(required)) { results.push(result(kind, index, "SKIPPED", "VALUE_UNAVAILABLE")); continue; }
      const add = await waitFor(() => workdayAddButton(root, kind), 2000);
      if (!add) { results.push(result(kind, index, "FAILED", "SECTION_ADD_UNAVAILABLE")); break; }
      const known = new Set(workdayEntries(root)[kind].map((entry) => entry.n));
      add.click();
      const entry = await waitFor(() => workdayEntries(root)[kind].find((item) => !known.has(item.n)), 3000);
      if (!entry) { results.push(result(kind, index, "FAILED", "SECTION_EDITOR_NOT_OPENED")); break; }
      await sleep(150);
      const ok = await fillEntry(root, workdayEntries(root)[kind].find((item) => item.n === entry.n) || entry, row, true);
      results.push(result(kind, index, ok ? "VERIFIED" : "FAILED", ok ? "FIELD_VERIFIED" : "FIELD_VERIFICATION_FAILED"));
    }
  }
  const skills = Array.isArray(sections?.skills) ? sections.skills : [];
  const input = skillsInput(root);
  if (skills.length && input) {
    // Only exact matches are picked: a near-miss skill is worse than a missing one.
    let added = 0;
    for (const skill of skills) {
      if (await chooseFromPrompt(root, input, skill, { strict: true })) added += 1;
      await sleep(60);
    }
    results.push({ fieldId: "section_skills_0", key: "skills.0.entry", status: added ? "VERIFIED" : "FAILED", code: added ? "FIELD_VERIFIED" : "SKILLS_NOT_FOUND", added, requested: skills.length });
  }
  return results;
}
