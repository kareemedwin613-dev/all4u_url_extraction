// Fills questions the published Application Guide answers. Rules only: the guide question and its extra
// wordings are matched against each control's visible question, and the answer comes from the guide or
// from the verified Resume. NEVER entries are claimed so no other matcher fills them.
import { formSection, questionText } from "./form-context.js";
import { findBestOption, optionPolarity } from "./option-matching.js";
import { skillSpecificExperience } from "./screening-field-adapter.js";

const FIELD_ATTRIBUTE = "data-resume-jd-guide-autofill-id";
const MODES = new Set(["FIXED", "DERIVED", "NEVER"]);
const SOURCES = new Set([
  "candidate.currentLocation", "candidate.postalCode", "candidate.city", "candidate.state", "candidate.country",
  "candidate.email", "candidate.phone", "candidate.fullName", "candidate.linkedInUrl", "candidate.addressLine1",
  "gender", "pronouns", "salaryExpectation", "startAvailability", "gpa", "totalYearsOfExperience",
]);
// Answers about the candidate today, never about a past job or school entry.
const OUTSIDE_ENTRIES_ONLY = new Set(["candidate.currentLocation", "candidate.postalCode", "candidate.city", "candidate.state", "candidate.country", "candidate.addressLine1", "startAvailability"]);
const TEXT_TYPES = new Set(["", "text", "search", "email", "tel", "url", "number", "date", "month"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER = "qqcompanyqq";
const STOP_WORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "do", "for", "have", "i", "in", "is", "it", "of", "on", "or", "our", "please", "the", "this", "to", "us", "we", "what", "will", "with", "you", "your"]);
const TRAILING_NOISE = /\b(optional|required|please select|select one|select)\b/g;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
export function normalizeGuideText(value) {
  return clean(value).normalize("NFKC").toLowerCase().replace(/\[\s*company\s*\]/g, ` ${PLACEHOLDER} `)
    .replace(/\bu\.\s?s\.?(?=\s|$)/g, "us").replace(/[^\p{L}\p{N}%]+/gu, " ").replace(/\s+/g, " ").trim();
}
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phrase = (normalized) => normalized.split(" ").map((token) => token === PLACEHOLDER ? "\\S+(?: \\S+){0,5}" : escape(token)).join(" ");
const tokens = (normalized) => normalized.split(" ").filter((token) => token && token !== PLACEHOLDER && !STOP_WORDS.has(token));

export function sanitizeGuideEntries(entries = []) {
  return (Array.isArray(entries) ? entries : []).slice(0, 200).map((entry) => ({
    id: String(entry?.id || ""), question: clean(entry?.question).slice(0, 300), mode: String(entry?.mode || "").toUpperCase(),
    source: entry?.source ? String(entry.source) : null, sensitive: entry?.sensitive === true,
    patterns: (Array.isArray(entry?.patterns) ? entry.patterns : []).map(clean).filter((pattern) => pattern.length >= 2 && pattern.length <= 300).slice(0, 20),
  })).filter((entry) => UUID.test(entry.id) && entry.question && MODES.has(entry.mode) && (entry.mode !== "DERIVED" || SOURCES.has(entry.source)));
}

// 99 exact, 97 exact one-word wording, 96 contains the wording, 80–95 near match, 0 no match.
export function scoreGuidePattern(question, pattern) {
  const asked = normalizeGuideText(question), wanted = normalizeGuideText(pattern);
  if (!asked || !wanted) return 0;
  const exact = new RegExp(`^${phrase(wanted)}$`);
  if (exact.test(asked)) return 99;
  const words = wanted.split(" ").filter((token) => token !== PLACEHOLDER).length;
  // One-word wordings ("Languages", "Location", "GitHub") must be the whole question:
  // "Programming languages" or "Job location" are different questions.
  if (words <= 1) return exact.test(asked.replace(TRAILING_NOISE, " ").replace(/\s+/g, " ").trim()) ? 97 : 0;
  if (new RegExp(`(^| )${phrase(wanted)}( |$)`).test(asked)) return 96;
  const wantedTokens = tokens(wanted), askedTokens = new Set(tokens(asked));
  if (wantedTokens.length < 3) return 0;
  const shared = wantedTokens.filter((token) => askedTokens.has(token)).length;
  const coverage = shared / wantedTokens.length, jaccard = shared / new Set([...askedTokens, ...wantedTokens]).size;
  return coverage >= 0.85 && jaccard >= 0.5 ? Math.min(95, Math.round(80 + 15 * jaccard)) : 0;
}

const tagOf = (element) => String(element?.tagName || "").toLowerCase();
const typeOf = (element) => String(element?.type || "").toLowerCase();
const isCombobox = (element) => String(element?.getAttribute?.("role") || "").toLowerCase() === "combobox";
const isChoice = (element) => ["radio", "checkbox"].includes(typeOf(element));

function usable(element) {
  if (!element || element.disabled || element.readOnly) return false;
  const tag = tagOf(element);
  return tag === "select" || tag === "textarea" || (tag === "input" && (TEXT_TYPES.has(typeOf(element)) || isChoice(element)));
}

function ownLabel(element) {
  return [...(element.labels || [])].map((label) => clean(label.textContent)).concat(clean(element.closest?.("label")?.textContent)).filter(Boolean);
}

// The question a control answers. For radio and checkbox groups the option's own label ("Yes") is removed.
function controlQuestion(element, grouped) {
  let text = questionText(element);
  if (grouped) for (const label of ownLabel(element)) text = clean(text.replace(label, " "));
  return text || clean(element.getAttribute?.("placeholder") || "");
}

function groupOf(element, all) {
  if (!isChoice(element) || !element.name) return [element];
  const group = all.filter((item) => typeOf(item) === typeOf(element) && item.name === element.name);
  return group.length ? group : [element];
}

export function guideFieldCandidates(root = document, rawEntries = []) {
  const entries = sanitizeGuideEntries(rawEntries);
  if (!entries.length) return [];
  const all = [...root.querySelectorAll("input,select,textarea")].filter(usable), seen = new Set(), candidates = [];
  for (const element of all) {
    const elements = groupOf(element, all);
    if (seen.has(elements[0])) continue;
    seen.add(elements[0]);
    const grouped = elements.length > 1 || typeOf(element) === "radio";
    const question = controlQuestion(element, grouped);
    if (question.length < 2) continue;
    const section = formSection(element).kind;
    let best = null;
    for (const entry of entries) {
      if (entry.source === "totalYearsOfExperience" && skillSpecificExperience(question)) continue;
      if (section && OUTSIDE_ENTRIES_ONLY.has(entry.source)) continue;
      const confidence = Math.max(...[entry.question, ...entry.patterns].map((pattern) => scoreGuidePattern(question, pattern)));
      if (confidence >= 90 && (!best || confidence > best.confidence)) best = { entry, confidence };
    }
    if (!best) continue;
    candidates.push({
      element, elements, confidence: best.confidence, key: `guide.${best.entry.id}`, guideEntryId: best.entry.id,
      mode: best.entry.mode, source: best.entry.source, label: question.slice(0, 300),
      controlType: typeOf(element) === "radio" || typeOf(element) === "checkbox" ? typeOf(element) : isCombobox(element) ? "combobox" : tagOf(element),
      inputType: typeOf(element),
    });
  }
  return candidates;
}

export function tagGuideField(elements, fieldId) { for (const element of elements) element.setAttribute(FIELD_ATTRIBUTE, fieldId); }

export function guideFieldResult(candidate, fieldId) {
  return {
    fieldId, key: candidate.key, guideEntryId: candidate.guideEntryId, label: candidate.label, confidence: candidate.confidence,
    readiness: "READY", controlType: candidate.controlType, inputType: candidate.inputType,
  };
}

function dispatch(element, types = ["input", "change", "blur"]) {
  for (const type of types) element.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
}

function optionLabel(element) {
  return [element.value, element.getAttribute?.("value"), ...ownLabel(element), clean(element.nextElementSibling?.textContent), clean(element.getAttribute?.("aria-label"))].filter(Boolean);
}

function setText(element, value) {
  const prototype = tagOf(element) === "textarea" ? globalThis.HTMLTextAreaElement?.prototype : globalThis.HTMLInputElement?.prototype;
  const setter = prototype && Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(element, value); else element.value = value;
  dispatch(element);
}

function setChecked(element, wanted) {
  if (Boolean(element.checked) === wanted) return;
  element.click?.();
  if (Boolean(element.checked) !== wanted) {
    const setter = globalThis.HTMLInputElement && Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, "checked")?.set;
    if (setter) setter.call(element, wanted); else element.checked = wanted;
    dispatch(element, ["input", "change"]);
  }
}

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function chooseCombobox(element, value, root) {
  element.focus?.(); element.click?.();
  await pause(30);
  const find = () => findBestOption([...(root.querySelectorAll?.("[role='option']") || [])], value, (option) => [clean(option.textContent), option.getAttribute?.("data-value")]);
  let option = find();
  if (!option) { setText(element, String(value)); await pause(80); option = find(); }
  if (!option) return null;
  option.click?.(); dispatch(option);
  await pause(30);
  return option;
}

function comboboxShows(element, value) {
  const container = element.closest?.(".select,.field-wrapper,[class*='select']");
  const selected = container?.querySelector?.(".select__single-value,[class*='single-value'],[class*='singleValue']");
  return Boolean(findBestOption([selected || element], value, (item) => [clean(item.textContent), item.value]));
}

function sameText(element, value) {
  if (typeOf(element) === "number") return Number(element.value) === Number(value);
  return clean(element.value).toLowerCase() === clean(value).toLowerCase();
}

export async function fillGuideFields(requests = [], root = document) {
  const results = [];
  for (const { fieldId, key, value } of requests) {
    const elements = [...root.querySelectorAll("input,select,textarea")].filter((item) => item.getAttribute?.(FIELD_ATTRIBUTE) === fieldId && usable(item));
    if (!elements.length) { results.push({ fieldId, key, status: "FAILED", code: "FIELD_NO_LONGER_AVAILABLE" }); continue; }
    const wanted = typeof value === "string" ? value.trim() : value;
    if (wanted === "" || wanted === null || wanted === undefined) { results.push({ fieldId, key, status: "SKIPPED", code: "VALUE_UNAVAILABLE" }); continue; }
    const target = elements[0];
    try {
      let ok;
      if (isChoice(target) && (elements.length > 1 || typeOf(target) === "radio")) {
        const option = findBestOption(elements, wanted, optionLabel);
        if (!option) { results.push({ fieldId, key, status: "FAILED", code: "SELECT_OPTION_NOT_FOUND" }); continue; }
        setChecked(option, true);
        ok = Boolean(option.checked);
      } else if (typeOf(target) === "checkbox") {
        const polarity = optionPolarity(wanted);
        if (polarity !== "yes" && polarity !== "no") { results.push({ fieldId, key, status: "FAILED", code: "SELECT_OPTION_NOT_FOUND" }); continue; }
        setChecked(target, polarity === "yes");
        ok = Boolean(target.checked) === (polarity === "yes");
      } else if (tagOf(target) === "select") {
        const option = findBestOption([...(target.options || [])], wanted, (item) => [item.value, item.textContent, item.label]);
        if (!option) { results.push({ fieldId, key, status: "FAILED", code: "SELECT_OPTION_NOT_FOUND" }); continue; }
        target.value = option.value;
        dispatch(target);
        ok = [...target.options].find((item) => item.value === target.value) === option;      } else if (isCombobox(target)) {
        const option = await chooseCombobox(target, wanted, root);
        if (!option) { results.push({ fieldId, key, status: "FAILED", code: "SELECT_OPTION_NOT_FOUND" }); continue; }
        ok = comboboxShows(target, wanted);
      } else {
        setText(target, String(wanted));
        ok = sameText(target, wanted);
      }
      results.push({ fieldId, key, status: ok ? "VERIFIED" : "FAILED", code: ok ? "FIELD_VERIFIED" : "FIELD_VERIFICATION_FAILED" });
    } catch {
      results.push({ fieldId, key, status: "FAILED", code: "FIELD_FILL_FAILED" });
    }
  }
  return results;
}

export const GUIDE_FIELD_ATTRIBUTE = FIELD_ATTRIBUTE;
export const GUIDE_SOURCES = Object.freeze([...SOURCES]);
