import { containerQuestion, isUserFacing, linkedLabels } from "./form-context.js";
const FIELD_ATTRIBUTE = "data-resume-jd-screening-autofill-id";
const SAFE_KEYS = new Set([
  "authorized_to_work", "requires_sponsorship", "willing_to_relocate", "available_start_date",
  "desired_salary", "years_of_experience", "remote_work_preference",
  "gender_identity", "race_ethnicity", "veteran_status",
]);
const SENSITIVE_KEYS = new Set(["gender_identity", "race_ethnicity", "veteran_status"]);
const SAFE_TYPES = new Set(["BOOLEAN", "NUMBER", "DATE", "TEXT", "SINGLE_SELECT"]);
const KEY_TYPES = Object.freeze({
  authorized_to_work: "BOOLEAN", requires_sponsorship: "BOOLEAN", willing_to_relocate: "BOOLEAN",
  available_start_date: "DATE", desired_salary: "TEXT", years_of_experience: "NUMBER",
  remote_work_preference: "SINGLE_SELECT",
  gender_identity: "TEXT", race_ethnicity: "TEXT", veteran_status: "TEXT",
});
const CONTROL_TYPES = new Set(["text", "search", "number", "date", "radio"]);
const PROHIBITED_QUESTION = /\b(race|racial|ethnicity|ethnic|gender|sex|sexual|pronouns?|religion|religious|disability|disabled|medical|veteran|military|criminal|conviction|arrest|felony|misdemeanor|marital|pregnan\w*|genetic|transgender|lgbtq?\w*|orientation|accommodation)\b/i;
const LEGAL_OR_ATTESTATION = /\b(certif(?:y|ication)|attest|declare|under penalty|terms and conditions|arbitration|background check|drug (?:test|screen)|restrictive covenant|non[- ]?compete|non[- ]?solicit|conflict of interest|government official|export control|itar|security clearance|public trust)\b/i;
const LONG_FORM = /\b(cover letter|why (?:do|would|are)|explain|describe|additional information|anything else|essay|statement)\b/i;

const RULES = Object.freeze({
  authorized_to_work: ["authorized to work", "authorization to work", "eligible to work", "permitted to work"],
  requires_sponsorship: ["require sponsorship", "requires sponsorship", "need sponsorship", "visa sponsorship", "immigration sponsorship", "sponsorship"],
  willing_to_relocate: ["willing to relocate", "willing and able to relocate", "able to relocate", "open to relocation", "relocate for this"],
  available_start_date: ["available start date", "date available", "earliest start date", "when can you start"],
  desired_salary: ["desired salary", "salary expectation", "expected salary", "compensation expectation"],
  years_of_experience: ["years of experience", "how many years", "total years of experience"],
  remote_work_preference: ["remote work preference", "preferred work arrangement", "work location preference"],
  gender_identity: ["gender", "what is your gender", "identify my gender", "gender identity"],
  race_ethnicity: ["race", "race and ethnicity", "race ethnicity", "what is your race and ethnicity"],
  veteran_status: ["veteran status", "military veteran", "protected veteran"],
});

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const normalize = (value) => clean(value).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const screeningKey = (key) => `screening.${key}`;
const STOP_WORDS=new Set(["a","an","and","are","as","at","be","do","for","have","i","in","is","of","on","or","please","the","this","to","what","will","with","you","your"]);
const tokens=value=>normalize(value).split(" ").filter(token=>token.length>1&&!STOP_WORDS.has(token));

export function normalizeApplicationQuestion(value){return normalize(value);}
export function scoreQuestionPattern(question,pattern){const left=new Set(tokens(question)),right=new Set(tokens(pattern));if(!left.size||!right.size)return 0;const shared=[...right].filter(token=>left.has(token)).length,coverage=shared/right.size,jaccard=shared/new Set([...left,...right]).size;if(coverage===1&&right.size>=2)return 90;return Math.round((coverage*.7+jaccard*.3)*100);}

function labelText(element) {
  const labels = linkedLabels(element).map((label) => clean(label.textContent));
  const legend = clean(element.closest?.("fieldset")?.querySelector?.("legend")?.textContent);
  const previous = clean(element.previousElementSibling?.textContent);
  const parentLabel = clean(element.parentElement?.querySelector?.("label")?.textContent);
  const prompt = clean(element.parentElement?.querySelector?.("[data-ui='label'],[class*='label'],[class*='Label'],[class*='question'],[class*='Question']")?.textContent);
  // React Select-based ATS controls (including Greenhouse) keep the visible
  // label on a field wrapper instead of associating it with the search input.
  const fieldWrapper = element.closest?.(".field-wrapper,.select,[class*='field-wrapper'],[class*='question']");
  const wrapperPrompt = clean(fieldWrapper?.querySelector?.("label,legend,[class*='label'],[class*='Label']")?.textContent);
  const labelledBy = clean(element.getAttribute?.("aria-labelledby"));
  const referenced = labelledBy.split(" ").filter(Boolean).map((id) => clean(element.ownerDocument?.getElementById?.(id)?.textContent));
  return [...labels, legend, previous, parentLabel, prompt, wrapperPrompt, ...referenced].filter(Boolean).join(" ");
}

function isCombobox(element) {
  return String(element?.getAttribute?.("role") || "").toLowerCase() === "combobox";
}

function descriptor(element) {
  return [
    labelText(element), element.getAttribute?.("aria-label"), element.getAttribute?.("placeholder"),
    element.getAttribute?.("title"), element.getAttribute?.("data-automation-id"), element.getAttribute?.("data-testid"),
    element.name, element.id,
  ].map(clean).filter(Boolean).join(" ");
}

function allowedControl(element) {
  if (!element || element.disabled || element.readOnly || !isUserFacing(element)) return false;
  const tag = String(element.tagName || "").toLowerCase();
  if (tag === "select") return true;
  return tag === "input" && CONTROL_TYPES.has(String(element.type || "text").toLowerCase());
}

function validValue(answer) {
  if (answer.answerType === "BOOLEAN") return typeof answer.answerValue === "boolean";
  if (answer.answerType === "NUMBER") return typeof answer.answerValue === "number" && Number.isFinite(answer.answerValue) && answer.answerValue >= 0 && answer.answerValue <= 100;
  if (answer.answerType === "DATE") return typeof answer.answerValue === "string" && /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(answer.answerValue) && !Number.isNaN(Date.parse(`${answer.answerValue}T00:00:00Z`));
  if (answer.answerType === "TEXT") return typeof answer.answerValue === "string" && answer.answerValue.trim().length > 0 && answer.answerValue.trim().length <= 500;
  return answer.answerType === "SINGLE_SELECT" && typeof answer.answerValue === "string" && ["REMOTE", "HYBRID", "ONSITE", "FLEXIBLE", "NO_PREFERENCE"].includes(answer.answerValue.toUpperCase());
}

export function sanitizeScreeningAnswers(answers = [], { includeValues = false } = {}) {
  const result = [];
  for (const value of Array.isArray(answers) ? answers.slice(0, 20) : []) {
    const answerKey = clean(value?.answerKey).toLowerCase(), answerType = clean(value?.answerType).toUpperCase();
    const sensitive=SENSITIVE_KEYS.has(answerKey),sensitivePattern=answerKey==="gender_identity"?/\b(gender|sex|self.identif)/i:answerKey==="race_ethnicity"?/\b(race|racial|ethnicity|ethnic)/i:/\b(veteran|military status|military service)/i;
    const questionPatterns = [...new Set((Array.isArray(value?.questionPatterns) ? value.questionPatterns : [])
      .map(clean).filter((pattern) => pattern.length >= 3 && pattern.length <= 300 && (sensitive?sensitivePattern.test(pattern):!PROHIBITED_QUESTION.test(pattern)) && !LEGAL_OR_ATTESTATION.test(pattern) && !LONG_FORM.test(pattern)))].slice(0, 20);
    const answer = { answerKey, answerType, questionPatterns };
    if (!SAFE_KEYS.has(answerKey) || !SAFE_TYPES.has(answerType) || KEY_TYPES[answerKey] !== answerType) continue;
    if (includeValues) {
      answer.answerValue = value?.answerValue;
      if (!validValue(answer)) continue;
    }
    result.push(answer);
  }
  return result;
}

export function questionBlocked(text) {
  return PROHIBITED_QUESTION.test(text) || LEGAL_OR_ATTESTATION.test(text) || LONG_FORM.test(text);
}

function answerQuestionBlocked(text,answer){
  if(!SENSITIVE_KEYS.has(answer.answerKey))return questionBlocked(text);
  if(LEGAL_OR_ATTESTATION.test(text)||LONG_FORM.test(text))return true;
  const allowed=answer.answerKey==="gender_identity"?/\b(gender|sex|self.identif)/i:answer.answerKey==="race_ethnicity"?/\b(race|racial|ethnicity|ethnic)/i:/\b(veteran|military status|military service)/i;
  return !allowed.test(text);
}

// "Years of experience with Python" asks about one skill, not total experience.
const GENERIC_EXPERIENCE = "(?:the|this|a|an|your|our|total|professional|relevant|industry|related|similar|overall|work|full|paid|post|software\\s+development|the\\s+industry)";
const SKILL_AFTER = new RegExp(`\\bexperience\\s+(?:do\\s+you\\s+have\\s+)?(?:with|in|using|on|working\\s+with)\\s+(?!${GENERIC_EXPERIENCE}\\b)[\\p{L}\\p{N}+#.]`, "iu");
const SKILL_BEFORE = new RegExp(`\\byears?\\s+of\\s+(?!${GENERIC_EXPERIENCE}\\b|experience\\b)[\\p{L}\\p{N}+#./-]+(?:\\s+[\\p{L}\\p{N}+#./-]+)?\\s+experience\\b`, "iu");
export function skillSpecificExperience(text) { const value = clean(text); return SKILL_AFTER.test(value) || SKILL_BEFORE.test(value); }

function matchAnswer(text, answer) {
  const normalizedText = normalize(text);
  if (!normalizedText || answerQuestionBlocked(text,answer)) return 0;
  if (answer.answerKey === "years_of_experience" && skillSpecificExperience(text)) return 0;
  const custom = answer.questionPatterns.map(normalize).filter(Boolean);
  if (custom.some((pattern) => normalizedText === pattern)) return 99;
  if (custom.some((pattern) => normalizedText.includes(pattern))) return 96;
  const canonical = RULES[answer.answerKey] || [];
  if (canonical.some((pattern) => normalizedText === normalize(pattern))) return 95;
  if (canonical.some((pattern) => normalizedText.includes(normalize(pattern)))) return 92;
  const fuzzy=[...custom,...canonical].reduce((best,pattern)=>Math.max(best,scoreQuestionPattern(normalizedText,pattern)),0);
  if(fuzzy>=86)return Math.min(91,fuzzy);
  return 0;
}

function compatible(element, answer) {
  const tag = String(element.tagName || "").toLowerCase(), type = String(element.type || "text").toLowerCase();
  if (answer.answerType === "BOOLEAN") return tag === "select" || type === "radio" || isCombobox(element);
  if (answer.answerType === "DATE") return tag === "select" || type === "date" || type === "text";
  if (answer.answerType === "NUMBER") return tag === "select" || type === "number" || type === "text";
  if (answer.answerType === "SINGLE_SELECT") return tag === "select" || type === "radio" || isCombobox(element);
  if (answer.answerType === "TEXT") return type === "text" || type === "search" || (answer.answerKey === "desired_salary" && type === "number") || (SENSITIVE_KEYS.has(answer.answerKey) && (tag === "select" || isCombobox(element)));
  return false;
}

function controls(root) {
  return [...root.querySelectorAll("input,select")].filter(allowedControl);
}

// Every (control group, answer) pair scoring 90+, before arbitration. Radio groups share one candidate.
export function screeningFieldCandidates(root = document, rawAnswers = []) {
  const answers = sanitizeScreeningAnswers(rawAnswers), candidates = [], all = controls(root);
  for (const element of all) {
    const text = descriptor(element);
    for (const answer of answers) {
      if (!compatible(element, answer)) continue;
      const confidence = matchAnswer(text, answer);
      if (confidence < 90) continue;
      const type = String(element.type || "").toLowerCase();
      const elements = type === "radio" && element.name ? all.filter((item) => String(item.type || "").toLowerCase() === "radio" && item.name === element.name) : [element];
      candidates.push({
        element, elements, answer, confidence, key: screeningKey(answer.answerKey),
        label: labelText(element) || clean(element.name || element.id),
        controlType: type === "radio" ? "radio" : isCombobox(element) ? "combobox" : String(element.tagName || "input").toLowerCase(),
        inputType: type,
      });
    }
  }
  return candidates;
}

export function tagScreeningField(elements, fieldId) { for (const item of elements) item.setAttribute(FIELD_ATTRIBUTE, fieldId); }

export function screeningFieldResult({ answer, confidence, label, controlType, inputType }, fieldId) {
  const requiresReview = false;
  return {
    fieldId, key: screeningKey(answer.answerKey), answerKey: answer.answerKey, answerType: answer.answerType,
    label: label || answer.answerKey.replaceAll("_", " "), confidence,
    readiness: !requiresReview && confidence >= 90 ? "READY" : "REVIEW_REQUIRED",
    controlType, inputType, requiresReview,
  };
}

export function detectScreeningFields(root = document, rawAnswers = []) {
  const selected = new Map();
  for (const candidate of screeningFieldCandidates(root, rawAnswers).sort((a, b) => b.confidence - a.confidence)) {
    if (!selected.has(candidate.answer.answerKey)) selected.set(candidate.answer.answerKey, candidate);
  }
  let sequence = 0;
  return [...selected.values()].map((candidate) => {
    const fieldId = `screening_${Date.now().toString(36)}_${sequence++}`;
    tagScreeningField(candidate.elements, fieldId);
    return screeningFieldResult(candidate, fieldId);
  });
}

const CLAIMED_ATTRIBUTES = [FIELD_ATTRIBUTE, "data-resume-jd-autofill-id", "data-resume-jd-guide-autofill-id", "data-resume-jd-missing-value"];
// Unclaimed questions include text areas and checkboxes so Admins see long-form and consent prompts too.
function unresolvedControls(root) {
  return [...root.querySelectorAll("input,select,textarea")].filter((element) => {
    if (!element || element.disabled || element.readOnly || !isUserFacing(element)) return false;
    const tag = String(element.tagName || "").toLowerCase(), type = String(element.type || "text").toLowerCase();
    return tag === "select" || tag === "textarea" || (tag === "input" && (CONTROL_TYPES.has(type) || type === "checkbox"));
  });
}

export function detectUnresolvedQuestions(root=document,rawAnswers=[]){
  const answers=sanitizeScreeningAnswers(rawAnswers),seen=new Set(),result=[];
  for(const element of unresolvedControls(root)){
    if(CLAIMED_ATTRIBUTES.some(name=>element.hasAttribute?.(name)))continue;
    const type=String(element.type||"text").toLowerCase(),groupKey=(type==="radio"||type==="checkbox")&&element.name?`${type}:${element.name}`:null;
    if(groupKey&&seen.has(groupKey))continue;if(groupKey)seen.add(groupKey);
    // A group's question, not its first option; unlinked labels are read from the field's container.
    const group=groupKey?unresolvedControls(root).filter(item=>String(item.type||"").toLowerCase()===type&&item.name===element.name):[element];
    const question=(groupKey?containerQuestion(element,group):"")||labelText(element)||containerQuestion(element,group)||clean(element.getAttribute?.("aria-label")||element.getAttribute?.("placeholder")||element.name||element.id);
    if(!question||question.length<2)continue;
    const blocked=questionBlocked(question),suggestions=blocked?[]:answers.map(answer=>({answerKey:answer.answerKey,score:matchAnswer(question,answer)})).filter(item=>item.score>=45).sort((a,b)=>b.score-a.score).slice(0,3);
    result.push({question:question.slice(0,300),normalizedQuestion:normalize(question).slice(0,300),controlType:type==="radio"||type==="checkbox"?type:isCombobox(element)?"combobox":String(element.tagName||"input").toLowerCase(),reason:blocked?"REVIEW_REQUIRED":"NO_MATCHING_ANSWER",suggestions});
  }
  return result.slice(0,50);
}

function optionValue(value) {
  if (typeof value === "boolean") return value ? ["yes", "true", "1"] : ["no", "false", "0"];
  const normalized = normalize(value);
  const aliases = {
    remote: ["remote", "fully remote"], hybrid: ["hybrid"], onsite: ["onsite", "on site", "in office"],
    flexible: ["flexible", "either", "any"], no_preference: ["no preference", "none"],
  };
  return aliases[normalized.replaceAll(" ", "_")] || [normalized];
}

function matchesOption(element, expected) {
  const values = [element.value, element.getAttribute?.("value"), labelText(element)].map(normalize).filter(Boolean);
  return optionValue(expected).some((wanted) => values.some((actual) => actual === wanted || actual.startsWith(`${wanted} `)));
}

function dispatch(element) {
  for (const type of ["input", "change", "blur"]) element.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
}

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function chooseCombobox(element, value, root) {
  element.focus?.();
  element.click?.();
  await pause(30);
  const findOption = () => [...(root.querySelectorAll?.("[role='option'],[role=option]") || [])]
    .find((option) => matchesOption(option, value));
  let option = findOption();
  if (!option) {
    const setter = globalThis.HTMLInputElement && Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, "value")?.set;
    const query = optionValue(value)[0] || String(value);
    if (setter) setter.call(element, query); else element.value = query;
    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await pause(50);
    option = findOption();
  }
  if (!option) return false;
  option.click?.();
  dispatch(option);
  await pause(30);
  return true;
}

function nativeValue(element, value) {
  const tag = String(element.tagName || "").toLowerCase();
  if (tag === "select") {
    const option = [...(element.options || [])].find((item) => matchesOption(item, value));
    if (!option) return false;
    element.value = option.value;
  } else {
    const setter = globalThis.HTMLInputElement && Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(element, String(value)); else element.value = String(value);
  }
  dispatch(element);
  return true;
}

function verifyValue(element, value) {
  const tag = String(element.tagName || "").toLowerCase();
  if (tag === "select") return matchesOption(element.options?.[element.selectedIndex] || { value: element.value }, value);
  if (isCombobox(element)) {
    const container = element.closest?.(".select,.field-wrapper,[class*='select']");
    const selected = container?.querySelector?.(".select__single-value,[class*='single-value'],[class*='singleValue']");
    return matchesOption(selected || element, value);
  }
  return normalize(element.value) === normalize(value);
}

export async function fillScreeningFields(requests = [], root = document) {
  const results = [];
  for (const { fieldId, key, answerKey, answerType, value } of requests) {
    const fields = controls(root).filter((item) => item.getAttribute?.(FIELD_ATTRIBUTE) === fieldId);
    if (!fields.length) { results.push({ fieldId, key, status: "FAILED", code: "FIELD_NO_LONGER_AVAILABLE" }); continue; }
    const [safe] = sanitizeScreeningAnswers([{ answerKey: answerKey || String(key || "").replace(/^screening\./, ""), answerType, answerValue: value }], { includeValues: true });
    if (!safe) { results.push({ fieldId, key, status: "SKIPPED", code: "VALUE_UNAVAILABLE" }); continue; }
    try {
      const radio = fields[0] && String(fields[0].type || "").toLowerCase() === "radio";
      if (radio) {
        const target = fields.find((item) => matchesOption(item, safe.answerValue));
        if (!target) { results.push({ fieldId, key, status: "FAILED", code: "SELECT_OPTION_NOT_FOUND" }); continue; }
        target.click?.();
        if (!target.checked) target.checked = true;
        dispatch(target);
        const ok = Boolean(target.checked);
        results.push({ fieldId, key, status: ok ? "VERIFIED" : "FAILED", code: ok ? "FIELD_VERIFIED" : "FIELD_VERIFICATION_FAILED" });
        continue;
      }
      const target = fields[0];
      const filled = isCombobox(target) ? await chooseCombobox(target, safe.answerValue, root) : nativeValue(target, safe.answerValue);
      if (!filled) { results.push({ fieldId, key, status: "FAILED", code: "SELECT_OPTION_NOT_FOUND" }); continue; }
      const ok = verifyValue(target, safe.answerValue);
      results.push({ fieldId, key, status: ok ? "VERIFIED" : "FAILED", code: ok ? "FIELD_VERIFIED" : "FIELD_VERIFICATION_FAILED" });
    } catch {
      results.push({ fieldId, key, status: "FAILED", code: "FIELD_FILL_FAILED" });
    }
  }
  return results;
}

export const SCREENING_AUTOFILL_KEYS = Object.freeze([...SAFE_KEYS]);
