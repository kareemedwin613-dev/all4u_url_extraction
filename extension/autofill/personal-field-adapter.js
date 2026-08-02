const FIELD_ATTRIBUTE = "data-resume-jd-autofill-id";
const SUPPORTED_TYPES = new Set(["", "text", "email", "tel", "url", "search"]);

const FIELD_RULES = [
  { key: "candidate.firstName", autocomplete: ["given-name"], pattern: /\b(?:first\s*name|given\s*name|forename|fname)\b/i },
  { key: "candidate.middleName", autocomplete: ["additional-name"], pattern: /\b(middle|additional)\s*name\b/i },
  { key: "candidate.lastName", autocomplete: ["family-name"], pattern: /\b(?:last\s*name|family\s*name|surname|lname)\b/i },
  { key: "candidate.fullName", autocomplete: ["name"], pattern: /\b(full|legal|preferred)\s*name\b|^\s*name\s*$/i },
  { key: "candidate.email", autocomplete: ["email"], pattern: /\be-?mail(?:\s+address)?\b/i, type: "email" },
  { key: "candidate.phone", autocomplete: ["tel", "tel-national"], pattern: /\b(phone|telephone|mobile|cell)(?:\s+number)?\b/i, type: "tel" },
  { key: "candidate.addressLine1", autocomplete: ["address-line1", "street-address"], pattern: /\b(address|street)(?:\s+line)?\s*(?:1|one)\b|\bstreet\s+address\b/i },
  { key: "candidate.addressLine2", autocomplete: ["address-line2"], pattern: /\b(address|street)(?:\s+line)?\s*(?:2|two)\b|\b(apt|apartment|suite|unit)\b/i },
  { key: "candidate.city", autocomplete: ["address-level2"], pattern: /\b(city|town|municipality)\b/i },
  { key: "candidate.state", autocomplete: ["address-level1"], pattern: /\b(state|province|region)\b/i },
  { key: "candidate.postalCode", autocomplete: ["postal-code"], pattern: /\b(zip|postal)(?:\s+code)?\b/i },
  { key: "candidate.country", autocomplete: ["country", "country-name"], pattern: /\bcountry\b/i },
  { key: "candidate.linkedInUrl", autocomplete: [], pattern: /\blinked\s*in(?:\s+(?:url|profile))?\b/i },
  { key: "candidate.githubUrl", autocomplete: [], pattern: /\bgithub(?:\s+(?:url|profile))?\b/i },
  { key: "candidate.portfolioUrl", autocomplete: ["url"], pattern: /\b(portfolio|personal\s+(?:site|website)|website)(?:\s+url)?\b/i },
  { key: "candidate.summary", autocomplete: [], pattern: /\b(summary|professional\s+profile|career\s+profile|about\s+me)\b/i },
  { key: "candidate.currentLocation", autocomplete: [], pattern: /\b(current\s+location|candidate\s+location|location\s*\(\s*city\s*\))\b/i },
  { key: "candidate.currentCompany", autocomplete: ["organization"], pattern: /\b(current|present|most\s+recent)\s+(company|employer)|current\s+employed\s+company\b/i },
];

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const normalized = (value) => clean(value).normalize("NFKC").toLowerCase();
const humanized = (value) => clean(String(value ?? "")
  .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  .replace(/[^\p{L}\p{N}]+/gu, " "));

function labelText(element) {
  const labels = [...(element.labels || [])].map((label) => clean(label.textContent));
  const wrapping = clean(element.closest?.("label")?.textContent);
  const legend = clean(element.closest?.("fieldset")?.querySelector?.("legend")?.textContent);
  const previous = clean(element.previousElementSibling?.textContent);
  const parentLabel = clean(element.parentElement?.querySelector?.("label")?.textContent);
  const parentPrompt = clean(element.parentElement?.querySelector?.("[data-ui='label'],[class*='label'],[class*='Label']")?.textContent);
  const labelledBy = clean(element.getAttribute?.("aria-labelledby"));
  const labelledText = labelledBy.split(" ").filter(Boolean).map((id) => clean(element.ownerDocument?.getElementById?.(id)?.textContent)).filter(Boolean);
  return [...labels, wrapping, legend, previous, parentLabel, parentPrompt, ...labelledText].filter(Boolean).join(" ");
}

function descriptor(element) {
  const values = [
    labelText(element), element.getAttribute?.("aria-label"), element.getAttribute?.("placeholder"),
    element.getAttribute?.("title"), element.getAttribute?.("data-automation-id"), element.getAttribute?.("data-testid"),
    element.name, element.id,
  ].map(clean).filter(Boolean);
  return [...values, ...values.map(humanized)].join(" ");
}

function allowed(element) {
  if (!element || element.disabled || element.readOnly) return false;
  const tag = String(element.tagName || "").toLowerCase();
  if (tag === "select" || tag === "textarea") return true;
  return tag === "input" && SUPPORTED_TYPES.has(String(element.type || "").toLowerCase());
}

export function scorePersonalField(element, rule) {
  if (!allowed(element)) return -1;
  const autocomplete = normalized(element.getAttribute?.("autocomplete")).split(" ").pop();
  const text = descriptor(element);
  let score = rule.autocomplete.includes(autocomplete) ? 100 : rule.pattern.test(text) ? 90 : 0;
  if (rule.type && String(element.type || "").toLowerCase() === rule.type) score = Math.max(score, text ? 92 : 82);
  if (rule.key.endsWith("Url") && String(element.type || "").toLowerCase() === "url" && rule.pattern.test(text)) score += 3;
  if (element.required) score += 1;
  return Math.min(score, 100);
}

export function detectPersonalFields(root = document, availableKeys = FIELD_RULES.map((rule) => rule.key)) {
  const allowedKeys = new Set(availableKeys), candidates = [];
  for (const element of root.querySelectorAll("input,select,textarea")) {
    let best = null;
    for (const rule of FIELD_RULES) {
      if (!allowedKeys.has(rule.key)) continue;
      const confidence = scorePersonalField(element, rule);
      if (confidence >= 70 && (!best || confidence > best.confidence)) best = { rule, confidence };
    }
    if (best) candidates.push({ element, ...best });
  }
  const selected = new Map(), usedElements = new Set();
  for (const candidate of candidates.sort((a, b) => b.confidence - a.confidence)) {
    if (!selected.has(candidate.rule.key) && !usedElements.has(candidate.element)) {
      selected.set(candidate.rule.key, candidate);
      usedElements.add(candidate.element);
    }
  }
  let sequence = 0;
  return [...selected.values()].map(({ element, rule, confidence }) => {
    const fieldId = `personal_${Date.now().toString(36)}_${sequence++}`;
    element.setAttribute(FIELD_ATTRIBUTE, fieldId);
    return {
      fieldId, key: rule.key, label: labelText(element) || clean(element.name || element.id) || rule.key,
      confidence, readiness: confidence >= 90 ? "READY" : "REVIEW_REQUIRED",
      controlType: String(element.tagName || "input").toLowerCase(),
    };
  });
}

function setNativeValue(element, value) {
  const tag = String(element.tagName || "").toLowerCase();
  if (tag === "select") {
    const wanted = normalized(value);
    const option = [...element.options].find((item) => normalized(item.value) === wanted || normalized(item.textContent) === wanted);
    if (!option) return false;
    element.value = option.value;
  } else {
    const prototype = tag === "textarea" ? globalThis.HTMLTextAreaElement?.prototype : globalThis.HTMLInputElement?.prototype;
    const setter = prototype && Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, value); else element.value = value;
  }
  for (const type of ["input", "change", "blur"]) element.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
  return true;
}

function verified(element, value) {
  const actual = normalized(element.value), expected = normalized(value);
  if (actual === expected) return true;
  if (String(element.type || "").toLowerCase() === "tel") {
    const actualDigits = actual.replace(/\D/g, ""), expectedDigits = expected.replace(/\D/g, "");
    if (actualDigits === expectedDigits) return true;
    // ATS forms commonly keep the 1–3 digit country calling code in an
    // adjacent selector and expose only the national number in the tel input.
    return actualDigits.length >= 7 && expectedDigits.endsWith(actualDigits) && expectedDigits.length - actualDigits.length <= 3;
  }
  return false;
}

export function fillPersonalFields(requests, root = document) {
  return requests.map(({ fieldId, key, value }) => {
    const element = [...root.querySelectorAll(`[${FIELD_ATTRIBUTE}]`)].find((item) => item.getAttribute(FIELD_ATTRIBUTE) === fieldId);
    if (!element || !allowed(element)) return { fieldId, key, status: "FAILED", code: "FIELD_NO_LONGER_AVAILABLE" };
    const safeValue = clean(value);
    if (!safeValue) return { fieldId, key, status: "SKIPPED", code: "VALUE_UNAVAILABLE" };
    try {
      if (!setNativeValue(element, safeValue)) return { fieldId, key, status: "FAILED", code: "SELECT_OPTION_NOT_FOUND" };
      const ok = verified(element, safeValue);
      if (ok) element.setAttribute("data-resume-jd-autofill-verified", "true");
      return { fieldId, key, status: ok ? "VERIFIED" : "FAILED", code: ok ? "FIELD_VERIFIED" : "FIELD_VERIFICATION_FAILED" };
    } catch {
      return { fieldId, key, status: "FAILED", code: "FIELD_FILL_FAILED" };
    }
  });
}

export const PERSONAL_AUTOFILL_KEYS = Object.freeze(FIELD_RULES.map((rule) => rule.key));
