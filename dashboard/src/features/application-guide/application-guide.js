const UPDATED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const GUIDE_AUTOFILL_MODES = [
  { value: "NONE", label: "Guidance only (not autofilled)" },
  { value: "FIXED", label: "Fill this answer" },
  { value: "DERIVED", label: "Fill from the Resume or job description" },
  { value: "NEVER", label: "Never autofill (a person answers)" },
];

export const GUIDE_AUTOFILL_SOURCES = [
  { value: "salaryExpectation", label: "Salary: JD range midpoint, else the answer below" },
  { value: "startAvailability", label: "Start availability (date fields get today + 14 days)" },
  { value: "totalYearsOfExperience", label: "Total years of experience from work history" },
  { value: "gender", label: "Gender from the original Resume" },
  { value: "pronouns", label: "Pronouns from the original Resume's gender" },
  { value: "gpa", label: "GPA (the answer below, e.g. 3.8)" },
  { value: "candidate.currentLocation", label: "Current location (City, ST, USA)" },
  { value: "candidate.postalCode", label: "ZIP code" },
  { value: "candidate.city", label: "City" },
  { value: "candidate.state", label: "State" },
  { value: "candidate.country", label: "Country" },
  { value: "candidate.addressLine1", label: "Street address" },
  { value: "candidate.fullName", label: "Full name" },
  { value: "candidate.email", label: "Email" },
  { value: "candidate.phone", label: "Phone" },
  { value: "candidate.linkedInUrl", label: "LinkedIn URL" },
];

// Short label shown next to each question so appliers know what Autofill will enter.
export function guideAutofillLabel(entry) {
  if (entry?.autofillMode === "FIXED") return `Autofill: ${entry.autofillValue}`;
  if (entry?.autofillMode === "DERIVED") {
    const source = GUIDE_AUTOFILL_SOURCES.find((item) => item.value === entry.autofillSource);
    return `Autofill: ${source ? source.label.split(" (")[0].split(":")[0] : "from profile"}`;
  }
  if (entry?.autofillMode === "NEVER") return "Autofill: answer yourself";
  return "";
}

export function guideEntryMatches(entry, { search = "" } = {}) {
  const needle = String(search || "").trim().toLowerCase();
  if (!needle) return true;
  return [entry?.question, entry?.meaning, entry?.howToAnswer, entry?.exampleAnswer]
    .some((value) => String(value || "").toLowerCase().includes(needle));
}

export function sortGuideEntries(entries, direction = "asc") {
  const factor = direction === "desc" ? -1 : 1;
  return [...(entries || [])].sort((left, right) => {
    const byQuestion = String(left?.question || "").localeCompare(String(right?.question || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    });
    return factor * byQuestion || String(left?.id || "").localeCompare(String(right?.id || ""));
  });
}

export function guideEntryIsUpdated(entry, now = Date.now()) {
  if (entry?.status !== "PUBLISHED" || !entry.updatedAt || !entry.publishedAt) return false;
  const updated = Date.parse(entry.updatedAt);
  const published = Date.parse(entry.publishedAt);
  if (!Number.isFinite(updated) || !Number.isFinite(published)) return false;
  if (updated - published < 60_000) return false;
  return now - updated < UPDATED_WINDOW_MS;
}

// "Learned by AI" on the guide page. A question with no known answer carries the kind the AI gave it.
export const LEARNED_KINDS = Object.freeze({
  SAME_FOR_EVERYONE: { label: "Needs a standard answer", color: "orange" },
  DEPENDS_ON_PROFILE: { label: "Depends on the profile", color: "default" },
  ESSAY: { label: "Open-ended: for AI drafting", color: "default" },
  NOT_A_QUESTION: { label: "Statement: left for a person", color: "default" },
});

export function filterLearnedWordings(items = [], filter = "ALL") {
  if (filter === "NEEDS_ANSWER") return items.filter((item) => item.targetKey === "none" && item.answerKind === "SAME_FOR_EVERYONE");
  if (filter === "MATCHED") return items.filter((item) => item.targetKey !== "none");
  if (filter === "NO_ANSWER") return items.filter((item) => item.targetKey === "none");
  return items;
}

// A new guide entry started from a learned question: fixed answer, the employer's wording kept for matching.
export function guideEntryFromLearned(item, emptyEntry) {
  return { ...emptyEntry, question: String(item?.question || "").slice(0, 300), autofillMode: "FIXED", autofillPatterns: [String(item?.question || "").slice(0, 300)], fromLearnedId: item?.id || "" };
}

// Resume answers and contact fields a learned wording can point at (mirrors the database's allowed targets).
export const LEARNED_ANSWER_LABELS = Object.freeze({
  authorized_to_work: "Authorized to work", requires_sponsorship: "Requires sponsorship", willing_to_relocate: "Willing to relocate",
  available_start_date: "Start date", desired_salary: "Desired salary", years_of_experience: "Years of experience",
  remote_work_preference: "Remote preference", gender_identity: "Gender", race_ethnicity: "Race / ethnicity", veteran_status: "Veteran status",
});
export const LEARNED_FIELD_LABELS = Object.freeze({
  firstName: "First name", middleName: "Middle name", lastName: "Last name", fullName: "Full name", email: "Email", phone: "Phone",
  addressLine1: "Street address", city: "City", state: "State", postalCode: "ZIP / postal code", country: "Country",
  currentLocation: "Current location", linkedInUrl: "LinkedIn URL", githubUrl: "GitHub URL", portfolioUrl: "Portfolio / website", currentCompany: "Current company",
});

// What a learned wording points at, in words.
export function learnedTargetLabel(item) {
  const key = String(item?.targetKey || "");
  if (key === "none") return LEARNED_KINDS[item?.answerKind]?.label || "No standard answer";
  if (key.startsWith("answer.")) return `Resume answer: ${LEARNED_ANSWER_LABELS[key.slice(7)] || key.slice(7)}`;
  if (key.startsWith("field.")) return `Contact field: ${LEARNED_FIELD_LABELS[key.slice(6)] || key.slice(6)}`;
  return `Guide: ${item?.targetQuestion || "entry"}`;
}

// Choices for "Correct": published standard answers Autofill fills, Resume answers, contact fields, or no standard
// answer with the kind of question ("none:ESSAY").
export function correctionOptions(entries = []) {
  const guide = entries.filter((entry) => entry?.id && entry.status !== "DRAFT" && ["FIXED", "DERIVED", "NEVER"].includes(entry.autofillMode))
    .map((entry) => ({ value: `guide.${entry.id}`, label: entry.question }));
  return [
    { label: "Contact field", options: Object.entries(LEARNED_FIELD_LABELS).map(([key, label]) => ({ value: `field.${key}`, label })) },
    { label: "Standard answer", options: guide },
    { label: "Resume answer", options: Object.entries(LEARNED_ANSWER_LABELS).map(([key, label]) => ({ value: `answer.${key}`, label })) },
    { label: "No standard answer", options: Object.entries(LEARNED_KINDS).map(([kind, { label }]) => ({ value: `none:${kind}`, label })) },
  ].filter((group) => group.options.length);
}

export const correctionValue = (item) => item?.targetKey === "none" ? (item.answerKind ? `none:${item.answerKind}` : undefined) : item?.targetKey;

/** The API body for a chosen correction. */
export function correctionBody(value) {
  const [targetKey, answerKind] = String(value || "").split(":");
  return targetKey === "none" ? { targetKey, answerKind } : { targetKey };
}
