// Adds Resume work-history and education entries on ATS forms that collect them one at a time
// behind an "Add" button (open an inline editor, fill it, save it, repeat).
// Only plain buttons (type="button") are clicked, so the application itself is never submitted.
import { fillControl } from "./personal-field-adapter.js";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

async function waitFor(check, timeout = 2500, interval = 50) {
  const started = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - started >= timeout) return null;
    await sleep(interval);
  }
}

// A <button> inside a form submits it unless its type is "button".
export function safeToClick(element) {
  if (!element || element.disabled || element.getAttribute?.("aria-disabled") === "true") return false;
  const tag = String(element.tagName || "").toLowerCase();
  if (tag === "button") return String(element.getAttribute?.("type") || "").toLowerCase() === "button";
  if (tag === "input") return false;
  return String(element.getAttribute?.("role") || "").toLowerCase() === "button" && !(tag === "a" && /^(?!#|javascript:)/i.test(element.getAttribute?.("href") || "#"));
}

const controls = (root) => [...root.querySelectorAll("input,select,textarea")];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Month pickers (react-datepicker on Workable) ignore typed text: open the picker, move to the year,
// and click the month. Only "YYYY-MM" values are picked; a year alone has no month to choose.
async function pickMonth(input, value, root) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]), month = MONTHS[Number(match[2]) - 1];
  input.focus?.();
  input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  input.click?.();
  const shownYear = () => {
    const option = root.querySelector('[role="dialog"] [role="option"][aria-label]');
    const found = String(option?.getAttribute("aria-label") || "").match(/(\d{4})\s*$/);
    return found ? Number(found[1]) : null;
  };
  if (!(await waitFor(shownYear, 1500))) return false;
  for (let step = 0; step < 80 && shownYear() !== year; step += 1) {
    const button = root.querySelector(`[role="dialog"] button[aria-label="${shownYear() > year ? "Previous Year" : "Next Year"}"]`);
    if (!safeToClick(button)) return false;
    button.click();
    await sleep(40);
  }
  const option = root.querySelector(`[role="dialog"] [role="option"][aria-label="Choose ${month} ${year}"]`);
  if (!option) return false;
  option.click();
  return Boolean(await waitFor(() => input.value === `${match[2]}/${match[1]}`, 1000));
}

async function setEntryControl(element, key, value, root) {
  const leaf = key.split(".").at(-1);
  if (String(element.type || "").toLowerCase() === "checkbox") {
    // React updates its state from the click, not from a changed property.
    if (Boolean(element.checked) !== Boolean(value)) element.click();
    if (Boolean(element.checked) === Boolean(value)) return true;
    return fillControl(element, key, Boolean(value));
  }
  if ((leaf === "startDate" || leaf === "endDate") && /mm\s*\/\s*yyyy/i.test(element.getAttribute?.("placeholder") || "")) {
    if (!/^\d{4}-\d{2}$/.test(String(value))) return null;
    return pickMonth(element, value, root);
  }
  return fillControl(element, key, value);
}

// sections: { employment?: rows, education?: rows } — rows from repeatableSectionRows().
export function detectRepeatableSections(root, layout) {
  return Object.entries(layout).map(([kind, config]) => {
    const container = root.querySelector(config.container);
    const add = container?.querySelector(config.add);
    if (!container || !add) return null;
    return { kind, existing: container.querySelectorAll(config.entries).length, addable: safeToClick(add) };
  }).filter(Boolean);
}

async function addEntry(root, kind, config, row, index) {
  const result = (status, code) => ({ fieldId: `section_${kind}_${index}`, key: `${kind}.${index}.entry`, status, code });
  const required = Object.entries(config.fields).find(([, field]) => field.required)?.[1].leaf;
  if (required && !clean(row[required])) return result("SKIPPED", "VALUE_UNAVAILABLE");
  const container = root.querySelector(config.container);
  const add = await waitFor(() => { const button = container?.querySelector(config.add); return safeToClick(button) ? button : null; });
  if (!add) return result("FAILED", "SECTION_ADD_UNAVAILABLE");
  const before = new Set(controls(root)), entriesBefore = container.querySelectorAll(config.entries).length;
  add.click();
  const editor = await waitFor(() => { const added = controls(root).filter((element) => !before.has(element)); return added.length ? added : null; });
  if (!editor) return result("FAILED", "SECTION_EDITOR_NOT_OPENED");
  const byName = (name) => editor.find((element) => element.getAttribute?.("name") === name);
  const save = () => root.querySelector(config.save), cancel = () => root.querySelector(config.cancel);
  let failed = false;
  // Text fields first, then the current-role box, then the end date only for past roles.
  const ordered = Object.entries(config.fields).sort(([, a], [, b]) => (a.leaf === "isCurrent") - (b.leaf === "isCurrent") || (a.leaf === "endDate") - (b.leaf === "endDate"));
  for (const [name, field] of ordered) {
    const element = byName(name), value = row[field.leaf];
    if (!element || value === undefined || value === null || value === "" || value === false) continue;
    if (field.leaf === "endDate" && row.isCurrent) continue;
    // null: a year-only date, left for the reviewer rather than inventing a month.
    if ((await setEntryControl(element, `${kind}.${index}.${field.leaf}`, value, root)) === false) failed = true;
    await sleep(20);
  }
  const saveButton = save();
  if (!safeToClick(saveButton)) {
    if (safeToClick(cancel())) cancel().click();
    return result("FAILED", "SECTION_SAVE_UNAVAILABLE");
  }
  saveButton.click();
  const closed = await waitFor(() => editor.every((element) => !element.isConnected) && container.querySelectorAll(config.entries).length > entriesBefore);
  // A rejected entry stays open with the site's own error message for the reviewer to correct.
  if (!closed) return result("FAILED", "SECTION_SAVE_REJECTED");
  // The site decides where a saved entry appears (Workable lists the newest first), so any entry may match.
  const expected = clean(row[config.summaryLeaf]).toLowerCase();
  const shown = [...container.querySelectorAll(config.entries)].map((entry) => clean(entry.textContent).toLowerCase());
  if (expected && !shown.some((text) => text.includes(expected))) return result("FAILED", "FIELD_VERIFICATION_FAILED");
  return result(failed ? "FAILED" : "VERIFIED", failed ? "FIELD_VERIFICATION_FAILED" : "FIELD_VERIFIED");
}

export async function fillRepeatableSections(root, sections = {}, layout = {}) {
  const results = [];
  for (const [kind, config] of Object.entries(layout)) {
    const rows = Array.isArray(sections?.[kind]) ? sections[kind] : [];
    if (!rows.length) continue;
    const container = root.querySelector(config.container);
    if (!container) continue;
    // Entries already on the page (typed by a person or parsed from the Resume by the site) are kept, never duplicated.
    if (container.querySelectorAll(config.entries).length) {
      results.push({ fieldId: `section_${kind}_0`, key: `${kind}.0.entry`, status: "SKIPPED", code: "SECTION_ALREADY_HAS_ENTRIES" });
      continue;
    }
    // Sites that show the newest-added entry first get the oldest row first, so the page keeps Resume order.
    const order = config.addedEntryAppearsFirst ? [...rows.keys()].reverse() : [...rows.keys()];
    for (const index of order) {
      const outcome = await addEntry(root, kind, config, rows[index], index);
      results.push(outcome);
      if (outcome.code === "SECTION_SAVE_REJECTED" || outcome.code === "SECTION_EDITOR_NOT_OPENED" || outcome.code === "SECTION_ADD_UNAVAILABLE") break;
    }
  }
  return results;
}

// Workable: verified on apply.workable.com (Add → inline editor → Save, one entry at a time).
export const WORKABLE_SECTIONS = Object.freeze({
  employment: {
    container: '[data-ui="experience"]', add: 'button[data-ui="add-section"]', save: 'button[data-ui="save-section"]', cancel: 'button[data-ui="cancel-section"]',
    entries: '[data-ui="group"]', summaryLeaf: "jobTitle", addedEntryAppearsFirst: true,
    fields: { title: { leaf: "jobTitle", required: true }, company: { leaf: "company" }, summary: { leaf: "description" }, start_date: { leaf: "startDate" }, end_date: { leaf: "endDate" }, current: { leaf: "isCurrent" } },
  },
  education: {
    container: '[data-ui="education"]', add: 'button[data-ui="add-section"]', save: 'button[data-ui="save-section"]', cancel: 'button[data-ui="cancel-section"]',
    entries: '[data-ui="group"]', summaryLeaf: "institution", addedEntryAppearsFirst: true,
    fields: { school: { leaf: "institution", required: true }, field_of_study: { leaf: "fieldOfStudy" }, degree: { leaf: "degree" }, start_date: { leaf: "startDate" }, end_date: { leaf: "endDate" } },
  },
});

const ROW_LIMITS = { company: 200, jobTitle: 200, location: 200, description: 10000, institution: 240, degree: 200, fieldOfStudy: 200 };
// Bounded copy of the rows sent from the extension panel to the page.
export function sanitizeSectionRows(sections = {}) {
  const date = (value) => (/^\d{4}(-\d{2})?$/.test(String(value || "")) ? String(value) : undefined);
  const row = (item, keys) => Object.fromEntries(keys.map((key) => {
    if (key === "startDate" || key === "endDate") return [key, date(item?.[key])];
    if (key === "isCurrent") return [key, item?.isCurrent === true];
    const text = typeof item?.[key] === "string" ? item[key].trim().slice(0, ROW_LIMITS[key]) : undefined;
    return [key, text || undefined];
  }));
  return {
    employment: (Array.isArray(sections?.employment) ? sections.employment : []).slice(0, 10).map((item) => row(item, ["company", "jobTitle", "location", "description", "startDate", "endDate", "isCurrent"])),
    education: (Array.isArray(sections?.education) ? sections.education : []).slice(0, 10).map((item) => row(item, ["institution", "degree", "fieldOfStudy", "startDate", "endDate"])),
  };
}
