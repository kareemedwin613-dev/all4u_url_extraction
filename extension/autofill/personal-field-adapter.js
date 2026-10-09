import { findBestOption, monthAliases, valueAliases } from "./option-matching.js";
import { containerQuestion, formSection, isUserFacing, linkedLabels, notAQuestion, sentenceLike } from "./form-context.js";

const FIELD_ATTRIBUTE = "data-resume-jd-autofill-id";
const SUPPORTED_TYPES = new Set(["", "text", "email", "tel", "url", "search", "month", "date", "number", "checkbox"]);
const LEGAL_OR_CONSENT = /\b(certif(?:y|ication)|attest|declare|hereby|under penalty|terms|agree|consent|acknowledge|authori[sz]e)\b/i;

const FIELD_RULES = [
  { key: "candidate.firstName", autocomplete: ["given-name"], pattern: /\b(?:first\s*name|given\s*name|forename|fname)\b/i },
  { key: "candidate.middleName", autocomplete: ["additional-name"], pattern: /\b(middle|additional)\s*name\b/i },
  { key: "candidate.lastName", autocomplete: ["family-name"], pattern: /\b(?:last\s*name|family\s*name|surname|lname)\b/i },
  // A bare "Name" label is matched part by part: the joined descriptor ("Name name name") never equals "name".
  // "First & Last Name" asks for the whole name, so it outranks the Last name rule it also matches.
  { key: "candidate.fullName", autocomplete: ["name"], pattern: /\b(full|legal|preferred)\s*name\b/i, exact: /^\s*(?:your\s+)?name\s*\*?$/i, strong: /\bfirst\s*(?:&|and|\/|\+)\s*last\s*name\b/i },
  { key: "candidate.email", autocomplete: ["email"], pattern: /\be-?mail(?:\s+address)?\b/i, type: "email" },
  { key: "candidate.phone", autocomplete: ["tel", "tel-national"], pattern: /\b(phone|telephone|mobile|cell)(?:\s+number)?\b/i, type: "tel" },
  { key: "candidate.addressLine1", autocomplete: ["address-line1", "street-address"], pattern: /\b(address|street)(?:\s+line)?\s*(?:1|one)\b|\bstreet\s+address\b|\bhome\s+address\b/i, exact: /^\s*(?:mailing\s+)?address\s*\*?$/i },
  { key: "candidate.addressLine2", autocomplete: ["address-line2"], pattern: /\b(address|street)(?:\s+line)?\s*(?:2|two)\b|\b(apt|apartment|suite|unit)\b/i },
  { key: "candidate.city", autocomplete: ["address-level2"], pattern: /\b(city|town|municipality)\b/i },
  { key: "candidate.state", autocomplete: ["address-level1"], pattern: /\b(state|province|region)\b/i },
  { key: "candidate.postalCode", autocomplete: ["postal-code"], pattern: /\b(zip|postal)(?:\s+code)?\b/i },
  { key: "candidate.country", autocomplete: ["country", "country-name"], pattern: /\bcountry\b/i },
  { key: "candidate.linkedInUrl", autocomplete: [], pattern: /\blinked\s*in(?:\s+(?:url|profile))?\b/i },
  { key: "candidate.githubUrl", autocomplete: [], pattern: /\bgithub(?:\s+(?:url|profile))?\b/i },
  { key: "candidate.portfolioUrl", autocomplete: ["url"], pattern: /\b(portfolio|personal\s+(?:site|website)|website)(?:\s+url)?\b/i },
  { key: "candidate.summary", autocomplete: [], pattern: /\b(summary|professional\s+profile|career\s+profile|about\s+me)\b/i },
  // The Application's cover letter goes into a text box; an upload field is not a text box.
  { key: "candidate.coverLetter", autocomplete: [], pattern: /\b(cover\s*letter|motivation(?:al)?\s+letter|letter\s+of\s+(?:interest|intent))\b/i, textareaOnly: true },
  { key: "candidate.currentLocation", autocomplete: [], pattern: /\b(current\s+location|candidate\s+location|location\s*\(\s*city\s*\))\b/i },
  { key: "candidate.currentCompany", autocomplete: ["organization"], pattern: /\b(current|present|most\s+recent)\s+(company|employer)|current\s+employed\s+company\b/i },
];

// Leaves of repeated employment/education entries. "shared" leaves exist in both sections and need
// the surrounding section to decide which one they belong to.
const STRUCTURED_RULES = {
  company: { section: "employment", pattern: /\b(company|employer|organization)\b/i },
  jobTitle: { section: "employment", pattern: /\b(job\s*title|position\s*title|title|role\s*title)\b/i, exact: /^\s*(position|role)\s*\*?$/i },
  description: { section: "employment", pattern: /\b(description|responsibilit\w*|duties|achievements|accomplishments)\b/i, textareaOnly: true, score: 95 },
  isCurrent: { section: "employment", pattern: /\b(i\s+(?:still\s+)?(?:currently\s+)?work\s+here|currently\s+work(?:ing)?\s+here|current(?:ly)?\s+(?:employed|role|position|job|employer)|present\s+(?:role|position|job))\b|^\s*(?:current|present)\s*$/i, checkboxOnly: true },
  institution: { section: "education", pattern: /\b(school|institution|university|college)\b/i },
  degree: { section: "education", pattern: /\bdegree\b/i },
  // Not a bare "field": many forms give inputs ids like "field-8" (Rippling).
  fieldOfStudy: { section: "education", pattern: /\b(field\s+of\s+study|area\s+of\s+study|discipline|major)\b/i },
  gpa: { section: "education", pattern: /\b(gpa|grade\s+point)\b/i },
  location: { section: "shared", pattern: /\b(location|city)\b/i },
  startMonth: { section: "shared", pattern: /\b(start|from)\s*(date\s*)?month\b/i, score: 92 },
  startYear: { section: "shared", pattern: /\b(start|from)\s*(date\s*)?year\b/i, score: 92 },
  endMonth: { section: "shared", pattern: /\b(end|to)\s*(date\s*)?month\b/i, score: 92 },
  endYear: { section: "shared", pattern: /\b(end|to|graduation)\s*(date\s*)?year\b/i, score: 92 },
  startDate: { section: "shared", pattern: /\b(start\s*date|date\s+started)\b/i, exact: /^\s*from\s*\*?$/i },
  endDate: { section: "shared", pattern: /\b(end\s*date|date\s+ended|graduation\s+date|completion\s+date)\b/i, exact: /^\s*to\s*\*?$/i },
};
const DATE_LEAVES = new Set(["startDate", "endDate"]);
const MONTH_LEAVES = new Set(["startMonth", "endMonth"]);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const normalized = (value) => clean(value).normalize("NFKC").toLowerCase();
const humanized = (value) => clean(String(value ?? "")
  .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  .replace(/[^\p{L}\p{N}]+/gu, " "));

function labelText(element) {
  const labels = linkedLabels(element).map((label) => clean(label.textContent));
  const wrapping = clean(element.closest?.("label")?.textContent);
  const legend = clean(element.closest?.("fieldset")?.querySelector?.("legend")?.textContent);
  // A neighbouring dropdown is not a label or prompt: its text is a list of options (ADP's phone country picker).
  const sibling = element.previousElementSibling;
  const previous = sibling && !/^(select|option)$/i.test(sibling.tagName) && !sibling.querySelector?.("select,option") ? clean(sibling.textContent) : "";
  const parentLabel = clean(element.parentElement?.querySelector?.("label")?.textContent);
  const promptElement = element.parentElement?.querySelector?.("[data-ui='label'],[class*='label'],[class*='Label']");
  const parentPrompt = promptElement && !/^(select|option)$/i.test(promptElement.tagName) && !promptElement.querySelector?.("select,option") ? clean(promptElement.textContent) : "";
  const labelledBy = clean(element.getAttribute?.("aria-labelledby"));
  const labelledText = labelledBy.split(" ").filter(Boolean).map((id) => clean(element.ownerDocument?.getElementById?.(id)?.textContent)).filter(Boolean);
  // The same label is often reached several ways; repeating it would make a short label look like a sentence.
  const found = [...new Set([...labels, wrapping, legend, previous, parentLabel, parentPrompt, ...labelledText].filter(Boolean))].join(" ");
  // An unlinked label in the field's own container (Ashby).
  return found || containerQuestion(element);
}

// "What is your preferred name?" asks for the same thing as "Preferred name": a short question of that form is
// read as its plain label, so it is not mistaken for a sentence-style screening question.
const ASK_PREFIX = /^\s*(?:what\s+is|what's|please\s+(?:enter|provide)|enter|provide)\s+your\s+/i;
// "LinkedIn Profile: Please provide the URL to your professional profile" names the field before the colon and
// gives an instruction after it. Only an instruction counts, never a question ("Location: are you open to relocating?").
const LABEL_THEN_INSTRUCTION = /^\s*([^:?]{2,40}?)\s*:\s*(?:please\s+|kindly\s+)?(?:provide|enter|include|add|paste|share|type|insert|list|give|e\.g\.|for\s+example|optional|required)\b/i;
function plainLabel(text) {
  const headed = String(text || "").match(LABEL_THEN_INSTRUCTION);
  if (headed && clean(headed[1]).split(" ").length <= 4) return clean(headed[1]);
  const stripped = clean(String(text || "").replace(ASK_PREFIX, "").replace(/[?*:\s]+$/, ""));
  return stripped !== clean(text) && stripped && stripped.split(" ").length <= 4 ? stripped : clean(text);
}

function descriptorParts(element) {
  const values = [
    labelText(element), element.getAttribute?.("aria-label"), element.getAttribute?.("placeholder"),
    element.getAttribute?.("title"), element.getAttribute?.("data-automation-id"), element.getAttribute?.("data-testid"),
    element.name, element.id,
  ].map(clean).filter(Boolean);
  return [...values, ...values.map(humanized)];
}

function descriptor(element) { return descriptorParts(element).join(" "); }

function allowed(element) {
  if (!element || element.disabled || element.readOnly || !isUserFacing(element)) return false;
  const tag = String(element.tagName || "").toLowerCase();
  if (tag === "select" || tag === "textarea") return true;
  return tag === "input" && SUPPORTED_TYPES.has(String(element.type || "").toLowerCase());
}

const inputType = (element) => String(element.type || "").toLowerCase();
const tagOf = (element) => String(element.tagName || "input").toLowerCase();

export function scorePersonalField(element, rule) {
  if (!allowed(element)) return -1;
  if (rule.textareaOnly && tagOf(element) !== "textarea") return 0;
  const autocomplete = normalized(element.getAttribute?.("autocomplete")).split(" ").pop();
  if (rule.autocomplete.includes(autocomplete)) return Math.min(100 + (element.required ? 1 : 0), 100);
  const text = descriptor(element);
  // Long sentence-style questions belong to the guide and screening matchers.
  const sentence = sentenceLike(plainLabel(labelText(element)));
  const matched = !sentence && (rule.pattern.test(text) || (rule.exact && descriptorParts(element).some((part) => rule.exact.test(part))));
  let score = matched ? 90 : 0;
  if (rule.strong && !sentence && rule.strong.test(text)) score = 95;
  if (rule.type && inputType(element) === rule.type) score = Math.max(score, text ? 92 : 82);
  if (rule.key.endsWith("Url") && inputType(element) === "url" && rule.pattern.test(text)) score += 3;
  if (element.required) score += 1;
  return Math.min(score, 100);
}

function scoreStructuredLeaf(element, leaf) {
  const rule = STRUCTURED_RULES[leaf];
  if (!allowed(element) || sentenceLike(labelText(element))) return 0;
  if (rule.textareaOnly && tagOf(element) !== "textarea") return 0;
  if (Boolean(rule.checkboxOnly) !== (inputType(element) === "checkbox")) return 0;
  if (!rule.pattern.test(descriptor(element)) && !(rule.exact && descriptorParts(element).some((part) => rule.exact.test(part)))) return 0;
  if (leaf === "isCurrent" && LEGAL_OR_CONSENT.test(labelText(element))) return 0;
  return rule.score || 90;
}

function bestStructuredLeaf(element) {
  let best = null;
  for (const leaf of Object.keys(STRUCTURED_RULES)) {
    const score = scoreStructuredLeaf(element, leaf);
    if (score >= 70 && (!best || score > best.score)) best = { leaf, score };
  }
  return best;
}

// Assigns entry numbers: the page's own index when present (ranked, so 0- and 1-based pages agree),
// otherwise the order in which the same leaf repeats within the section.
function indexStructured(entries) {
  const explicit = new Map(), seen = new Map();
  for (const entry of entries) if (Number.isInteger(entry.section.index)) {
    const values = explicit.get(entry.kind) || new Set(); values.add(entry.section.index); explicit.set(entry.kind, values);
  }
  const ranks = new Map([...explicit].map(([kind, values]) => [kind, new Map([...values].sort((a, b) => a - b).map((value, rank) => [value, rank]))]));
  for (const entry of entries) {
    if (Number.isInteger(entry.section.index)) { entry.index = ranks.get(entry.kind).get(entry.section.index); continue; }
    const counter = `${entry.kind}:${entry.leaf}`, next = seen.get(counter) || 0;
    entry.index = next; seen.set(counter, next + 1);
  }
}

// Employer wordings learned for contact fields (from AI recognition or an Admin's correction), compared without
// case, punctuation or a trailing "*".
const wordingKey = (value) => clean(String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " "));
function learnedKey(element, wordings) {
  const label = wordingKey(labelText(element));
  if (!label) return null;
  for (const [key, list] of Object.entries(wordings || {})) {
    for (const wording of Array.isArray(list) ? list : []) {
      const wanted = wordingKey(wording);
      if (wanted && (wanted === label || (wanted.split(" ").length >= 3 && (label.includes(wanted) || (label.split(" ").length >= 3 && wanted.includes(label)))))) return key;
    }
  }
  return null;
}

// Every plausible (element, key) pair before arbitration; one best key per element.
export function personalFieldCandidates(root = document, availableKeys = FIELD_RULES.map((rule) => rule.key), learnedWordings = {}) {
  const allowedKeys = new Set(availableKeys), candidates = [], structured = [];
  for (const element of root.querySelectorAll("input,select,textarea")) {
    if (!allowed(element)) continue;
    const section = formSection(element);
    // Every plausible key, strongest first: a "Country" label that also mentions the neighbouring
    // "Phone" must still be offered as Country once the real phone field takes Phone.
    const matches = [];
    for (const rule of FIELD_RULES) {
      if (!allowedKeys.has(rule.key)) continue;
      // Inside an employment or education entry only the autocomplete attribute can claim a contact field.
      const confidence = section.kind && !rule.autocomplete.includes(normalized(element.getAttribute?.("autocomplete")).split(" ").pop()) ? 0 : scorePersonalField(element, rule);
      if (confidence >= 70) matches.push({ key: rule.key, confidence });
    }
    const learned = section.kind ? null : learnedKey(element, learnedWordings);
    if (learned && allowedKeys.has(learned) && !matches.some((match) => match.key === learned && match.confidence >= 95)) {
      matches.splice(0, matches.length, ...matches.filter((match) => match.key !== learned), { key: learned, confidence: 95 });
    }
    matches.sort((a, b) => b.confidence - a.confidence);
    const best = matches[0] || null;
    const leaf = bestStructuredLeaf(element);
    // Outside a detected job or school entry, an equally strong contact match wins.
    if (leaf && (!best || leaf.score > best.confidence || (leaf.score === best.confidence && section.kind))) {
      const rule = STRUCTURED_RULES[leaf.leaf];
      const kind = rule.section === "shared" ? section.kind : section.kind && section.kind !== rule.section ? null : rule.section;
      if (kind) { structured.push({ element, leaf: leaf.leaf, kind, section, confidence: leaf.score }); continue; }
      // A plain "Location" outside any entry is the candidate's own location.
      if (leaf.leaf === "location" && allowedKeys.has("candidate.currentLocation") && !best) matches.push({ key: "candidate.currentLocation", confidence: 88 });
    }
    for (const match of matches) candidates.push({ element, ...match });
  }
  indexStructured(structured);
  for (const entry of structured) {
    const key = `${entry.kind}.${entry.index}.${entry.leaf}`;
    if (allowedKeys.has(key)) candidates.push({ element: entry.element, key, confidence: entry.confidence });
  }
  return candidates.map((candidate) => ({
    ...candidate,
    label: labelText(candidate.element) || clean(candidate.element.name || candidate.element.id) || candidate.key,
    controlType: tagOf(candidate.element), inputType: inputType(candidate.element),
  }));
}

export function tagPersonalField(element, fieldId) { element.setAttribute(FIELD_ATTRIBUTE, fieldId); }

// Placeholders, option words, generic control labels and cookie-banner items are not questions (form-context.js).
export const placeholderOnly = (label) => notAQuestion(label);

// A plain contact label ("First name", "Email", "Phone number"). Filling these is the contact rules' job;
// they are never sent to AI recognition (a second "First name" is often a reference's, not the candidate's).
export function contactQuestion(label) {
  const text = plainLabel(label);
  return Boolean(text) && !sentenceLike(text) && FIELD_RULES.some((rule) => !rule.textareaOnly && (rule.pattern.test(text) || Boolean(rule.exact?.test(text))));
}

export function personalFieldResult(candidate, fieldId) {
  return {
    fieldId, key: candidate.key, label: candidate.label, confidence: candidate.confidence,
    readiness: candidate.confidence >= 90 ? "READY" : "REVIEW_REQUIRED",
    controlType: candidate.controlType, inputType: candidate.inputType,
  };
}

export function detectPersonalFields(root = document, availableKeys = FIELD_RULES.map((rule) => rule.key)) {
  const selected = new Map(), usedElements = new Set();
  for (const candidate of personalFieldCandidates(root, availableKeys).sort((a, b) => b.confidence - a.confidence)) {
    if (!selected.has(candidate.key) && !usedElements.has(candidate.element)) {
      selected.set(candidate.key, candidate);
      usedElements.add(candidate.element);
    }
  }
  let sequence = 0;
  return [...selected.values()].map((candidate) => {
    const fieldId = `personal_${Date.now().toString(36)}_${sequence++}`;
    tagPersonalField(candidate.element, fieldId);
    return personalFieldResult(candidate, fieldId);
  });
}

// Dates travel as "YYYY-MM" (or "YYYY"); each control receives the shape it accepts.
export function formatDateForControl(value, element) {
  const match = String(value ?? "").match(/^(\d{4})(?:-(\d{1,2}))?/);
  if (!match) return String(value ?? "");
  const year = match[1], month = match[2] ? match[2].padStart(2, "0") : "";
  const type = inputType(element);
  if (type === "month") return `${year}-${month || "01"}`;
  if (type === "date") return `${year}-${month || "01"}-01`;
  const hint = normalized(`${element.getAttribute?.("placeholder") || ""} ${element.getAttribute?.("aria-label") || ""}`);
  if (!month || /^\s*yyyy\s*$/.test(hint)) return year;
  if (/yyyy\s*-\s*mm/.test(hint)) return `${year}-${month}`;
  if (/mm\s*\/\s*dd\s*\/\s*yyyy/.test(hint)) return `${month}/01/${year}`;
  return `${month}/${year}`;
}

function leafOf(key) { return String(key || "").split(".").at(-1); }

function selectOption(element, value, key) {
  const leaf = leafOf(key), texts = (item) => [item.value, item.textContent, item.label];
  if (MONTH_LEAVES.has(leaf)) {
    const aliases = monthAliases(value).map(normalized);
    return [...element.options].find((item) => texts(item).some((text) => aliases.includes(normalized(text)))) || null;
  }
  if (DATE_LEAVES.has(leaf)) {
    const match = String(value).match(/^(\d{4})/);
    return match ? [...element.options].find((item) => texts(item).some((text) => normalized(text) === match[1])) || null : null;
  }
  return findBestOption([...element.options], value, texts);
}

function setNativeValue(element, value, key) {
  const tag = tagOf(element);
  if(tag==="input"&&inputType(element)==="checkbox"){
    const wanted=value===true||["true","yes","1","present","current"].includes(normalized(value));
    if(element.checked!==wanted){const setter=globalThis.HTMLInputElement&&Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype,"checked")?.set;if(setter)setter.call(element,wanted);else element.checked=wanted;for(const type of["input","change"])element.dispatchEvent(new Event(type,{bubbles:true,composed:true}));}
    return element.checked===wanted;
  }
  if (tag === "select") {
    const option = selectOption(element, value, key);
    if (!option) return false;
    element.value = option.value;
  } else {
    // Some text boxes (ADP Workforce Now) keep a value only if it arrives while they have focus; leaving them
    // without having entered restores their saved, empty value.
    try { element.focus?.({ preventScroll: true }); } catch {}
    const prototype = tag === "textarea" ? globalThis.HTMLTextAreaElement?.prototype : globalThis.HTMLInputElement?.prototype;
    const setter = prototype && Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, value); else element.value = value;
  }
  for (const type of ["input", "change"]) element.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
  // A real blur when the box has focus; in a background tab (no focus) the event is sent instead.
  if (element.ownerDocument?.activeElement === element && typeof element.blur === "function") element.blur();
  else element.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
  return true;
}

function verified(element, value, key) {
  if(inputType(element)==="checkbox")return element.checked===(value===true||["true","yes","1","present","current"].includes(normalized(value)));
  if (tagOf(element) === "select") {
    const selected = [...(element.options || [])].find((item) => item.value === element.value);
    return Boolean(selected) && selected === selectOption(element, value, key);
  }
  const actual = normalized(element.value), expected = normalized(value);
  if (actual === expected) return true;
  if (inputType(element) === "tel") {
    const actualDigits = actual.replace(/\D/g, ""), expectedDigits = expected.replace(/\D/g, "");
    if (actualDigits === expectedDigits) return true;
    // ATS forms commonly keep the 1–3 digit country calling code in an
    // adjacent selector and expose only the national number in the tel input.
    if (actualDigits.length >= 7 && expectedDigits.endsWith(actualDigits) && expectedDigits.length - actualDigits.length <= 3) return true;
    // Others (ADP) reformat the number and add the calling code in the box itself: "5125550142" → "+1 512 555 0142".
    return expectedDigits.length >= 7 && actualDigits.endsWith(expectedDigits) && actualDigits.length - expectedDigits.length <= 3;
  }
  return false;
}

export function fillPersonalFields(requests, root = document) {
  return requests.map(({ fieldId, key, value }) => {
    const element = [...root.querySelectorAll(`[${FIELD_ATTRIBUTE}]`)].find((item) => item.getAttribute(FIELD_ATTRIBUTE) === fieldId);
    if (!element || !allowed(element)) return { fieldId, key, status: "FAILED", code: "FIELD_NO_LONGER_AVAILABLE" };
    const leaf = leafOf(key);
    let safeValue = typeof value === "boolean" ? value : leaf === "description" || tagOf(element) === "textarea" ? String(value ?? "").trim() : clean(value);
    if (safeValue === "") return { fieldId, key, status: "SKIPPED", code: "VALUE_UNAVAILABLE" };
    if (DATE_LEAVES.has(leaf) && tagOf(element) !== "select") safeValue = formatDateForControl(safeValue, element);
    try {
      if (!setNativeValue(element, safeValue, key)) return { fieldId, key, status: "FAILED", code: "SELECT_OPTION_NOT_FOUND" };
      const ok = verified(element, safeValue, key);
      if (ok) element.setAttribute("data-resume-jd-autofill-verified", "true");
      return { fieldId, key, status: ok ? "VERIFIED" : "FAILED", code: ok ? "FIELD_VERIFIED" : "FIELD_VERIFICATION_FAILED" };
    } catch {
      return { fieldId, key, status: "FAILED", code: "FIELD_FILL_FAILED" };
    }
  });
}

// Fills and verifies one control for a Resume key (dates are formatted for the control). Used for
// controls an ATS creates on demand, such as a Workable "Add experience" editor.
export function fillControl(element, key, value) {
  if (!allowed(element)) return false;
  const leaf = leafOf(key);
  let safeValue = typeof value === "boolean" ? value : leaf === "description" || tagOf(element) === "textarea" ? String(value ?? "").trim() : clean(value);
  if (safeValue === "") return false;
  if (DATE_LEAVES.has(leaf) && tagOf(element) !== "select") safeValue = formatDateForControl(safeValue, element);
  return setNativeValue(element, safeValue, key) && verified(element, safeValue, key);
}

export const PERSONAL_FIELD_ATTRIBUTE = FIELD_ATTRIBUTE;
export const PERSONAL_AUTOFILL_KEYS = Object.freeze(FIELD_RULES.map((rule) => rule.key));
export { valueAliases };
