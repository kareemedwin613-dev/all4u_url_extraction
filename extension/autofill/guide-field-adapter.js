// Fills questions the published Application Guide answers. Rules only: the guide question and its extra
// wordings are matched against each control's visible question, and the answer comes from the guide or
// from the verified Resume. NEVER entries are claimed so no other matcher fills them.
import { choiceGroup, containerQuestion, formSection, isUserFacing, linkedLabels, questionText } from "./form-context.js";
import { US_STATE_NAMES, findBestOption, normalizeOptionText, optionPolarity, usStateCode } from "./option-matching.js";
import { questionBlocked, skillSpecificExperience } from "./screening-field-adapter.js";

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
  if (!element || element.disabled || element.readOnly || !isUserFacing(element)) return false;
  const tag = tagOf(element);
  return tag === "select" || tag === "textarea" || (tag === "input" && (TEXT_TYPES.has(typeOf(element)) || isChoice(element)));
}

function ownLabel(element) {
  return linkedLabels(element).map((label) => clean(label.textContent)).concat(clean(element.closest?.("label")?.textContent)).filter(Boolean);
}

// The question a control answers. For radio and checkbox groups the option's own label ("Yes") is removed.
function controlQuestion(element, grouped, group = [element]) {
  // Radio and checkbox groups: the group's own question, never one option's label.
  const container = containerQuestion(element, group);
  if (grouped && container) return container;
  let text = questionText(element);
  if (grouped) for (const label of ownLabel(element)) text = clean(text.replace(label, " "));
  return text || container || clean(element.getAttribute?.("placeholder") || "");
}

function groupOf(element, all) {
  return choiceGroup(element, all);
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
    const question = controlQuestion(element, grouped, elements);
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

// Yes/No questions about the candidate's own experience, answered from the Resume by resume-evidence.js.
const EXPERIENCE_QUESTION = /^(?:do|does|have|has|are|can|would)\s+you\b[^?]*\b(experience|years?|familiar|proficien\w*|knowledge|expertise|skilled|worked with|hands[- ]on)\b/i;

function offersYesAndNo(element, elements) {
  const texts = tagOf(element) === "select"
    ? [...(element.options || [])].map((option) => option.textContent)
    : typeOf(element) === "radio" || typeOf(element) === "checkbox" ? elements.flatMap((item) => optionLabel(item)) : null;
  if (!texts) return true; // A search dropdown's options appear only once it is opened.
  const polarities = new Set(texts.map(optionPolarity));
  return polarities.has("yes") && polarities.has("no");
}

export function evidenceFieldCandidates(root = document) {
  const all = [...root.querySelectorAll("input,select,textarea")].filter(usable), seen = new Set(), candidates = [];
  for (const element of all) {
    const choice = tagOf(element) === "select" || typeOf(element) === "radio" || typeOf(element) === "checkbox" || isCombobox(element);
    if (!choice) continue;
    const elements = groupOf(element, all);
    // A checkbox pair used as a Yes/No answer (Lever: "Yes, Strong C# skills" / "No"); never a single consent box.
    if (typeOf(element) === "checkbox" && elements.length !== 2) continue;
    if (seen.has(elements[0])) continue;
    seen.add(elements[0]);
    const question = controlQuestion(element, typeOf(element) === "radio" || typeOf(element) === "checkbox", elements);
    if (!EXPERIENCE_QUESTION.test(question.replace(/^[*\s]+/, "")) || questionBlocked(question) || !offersYesAndNo(element, elements)) continue;
    candidates.push({
      element, elements, confidence: 85, key: `evidence.${candidates.length}`, label: question.slice(0, 300),
      controlType: typeOf(element) === "radio" || typeOf(element) === "checkbox" ? typeOf(element) : isCombobox(element) ? "combobox" : tagOf(element), inputType: typeOf(element),
    });
  }
  return candidates.slice(0, 40);
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

// "Miami, FL, USA" → search "Miami", then pick the suggestion naming that city and state.
function locationParts(value) {
  const parts = String(value || "").split(",").map(clean).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return null;
  const state = usStateCode(parts[1]) || (parts[1].length > 2 ? "" : parts[1].toUpperCase());
  return { city: parts[0], state, stateName: state ? normalizeOptionText(US_STATE_NAMES[state] || "") : normalizeOptionText(parts[1]) };
}

function locationOption(options, parts) {
  const city = normalizeOptionText(parts.city);
  return options.find((option) => {
    const text = normalizeOptionText(option.textContent);
    return (text === city || text.startsWith(`${city} `)) && (!parts.state || new RegExp(`(^| )(${parts.state.toLowerCase()}|${parts.stateName})( |$)`).test(text));
  }) || null;
}

async function waitFor(check, timeout) {
  for (const started = Date.now(); ; await pause(60)) {
    const value = check();
    if (value || Date.now() - started > timeout) return value || null;
  }
}

// react-select opens from the event sequence a real click produces, not from click() alone.
function openCombobox(element) {
  const control = element.closest?.("[class*='control']") || element.parentElement || element;
  const view = element.ownerDocument?.defaultView || globalThis;
  const fire = (type, Ctor) => {
    const Event = (Ctor && view[Ctor]) || view.MouseEvent || globalThis.Event;
    control.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, view }));
  };
  fire("pointerdown", "PointerEvent"); fire("mousedown");
  element.focus?.();
  fire("pointerup", "PointerEvent"); fire("mouseup"); fire("click");
  if (control !== element) element.click?.();
}

// Only this field's own list: the page may hold other, hidden option lists (a phone widget's countries).
function comboboxOptions(element, root) {
  const document = element.ownerDocument || root;
  const ids = [element.getAttribute?.("aria-controls"), element.getAttribute?.("aria-owns"), element.id ? `react-select-${element.id}-listbox` : ""]
    .join(" ").split(/\s+/).filter(Boolean);
  for (const id of ids) {
    const list = document.getElementById?.(id);
    const options = list ? [...list.querySelectorAll("[role='option']")] : [];
    if (options.length) return options;
  }
  return [...(root.querySelectorAll?.("[role='option']") || [])].filter((option) => isUserFacing(option));
}

export async function chooseCombobox(element, value, root = element.ownerDocument) {
  openCombobox(element);
  const options = () => comboboxOptions(element, root);
  const find = () => findBestOption(options(), value, (option) => [clean(option.textContent), option.getAttribute?.("data-value")]);
  const place = locationParts(value);
  // Options may be a fixed list shown on focus, or search results fetched while typing.
  let option = await waitFor(find, 400);
  if (!option) {
    setText(element, place ? place.city : String(value));
    option = await waitFor(() => (place ? locationOption(options(), place) : null) || find(), 3000);
  }
  if (!option) return null;
  option.click?.(); dispatch(option);
  await pause(60);
  return option;
}

// react-select shows the choice in a sibling "single value" element; other widgets keep it in the input.
function comboboxDisplay(element) {
  for (let node = element.parentElement, depth = 0; node && depth < 5; node = node.parentElement, depth += 1) {
    const selected = node.querySelector?.("[class*='single-value'],[class*='singleValue']");
    if (selected) return selected;
  }
  return null;
}

export function comboboxShows(element, value) {
  return Boolean(findBestOption([comboboxDisplay(element) || element], value, (item) => [clean(item.textContent), item.value]));
}

// Selects a value in a dropdown that types-to-search; returns a result code.
export async function selectComboboxValue(element, value, root = element.ownerDocument) {
  const chosen = clean((await chooseCombobox(element, value, root))?.textContent ?? "");
  if (!chosen) return "SELECT_OPTION_NOT_FOUND";
  // A location reads back in the site's wording ("Miami, Florida, United States"), and a phone-country
  // picker shows only part of the chosen option ("+1" for "United States +1").
  const place = locationParts(value), shown = clean(comboboxDisplay(element)?.textContent);
  const verified = comboboxShows(element, value) || (place && locationOption([{ textContent: element.value }], place))
    || (shown.length > 0 && chosen.toLowerCase().includes(shown.toLowerCase()));
  return verified ? "FIELD_VERIFIED" : "FIELD_VERIFICATION_FAILED";
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
        const code = await selectComboboxValue(target, wanted, root);
        if (code === "SELECT_OPTION_NOT_FOUND") { results.push({ fieldId, key, status: "FAILED", code }); continue; }
        ok = code === "FIELD_VERIFIED";
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
