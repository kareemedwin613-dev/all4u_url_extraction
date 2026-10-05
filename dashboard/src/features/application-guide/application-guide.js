export const GUIDE_CATEGORIES = Object.freeze([
  { value: "PERSONAL_DETAILS", label: "Personal details" },
  { value: "WORK_EXPERIENCE", label: "Work experience" },
  { value: "CONSENT", label: "Consent & disclosures" },
]);

export const GUIDE_ANSWER_TYPES = Object.freeze([
  { value: "GENERAL_GUIDANCE", label: "General guidance" },
  { value: "CANDIDATE_INFORMATION", label: "Candidate information" },
  { value: "CANDIDATE_DECISION", label: "Candidate decision" },
]);

const UPDATED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function guideLabel(options, value) {
  return options.find((item) => item.value === value)?.label || "";
}

export function guideEntryMatches(entry, { search = "", category = "" } = {}) {
  if (category && entry?.category !== category) return false;
  const needle = String(search || "").trim().toLowerCase();
  if (!needle) return true;
  return [entry?.question, entry?.meaning, entry?.howToAnswer, entry?.exampleAnswer]
    .some((value) => String(value || "").toLowerCase().includes(needle));
}

export function guideEntryIsUpdated(entry, now = Date.now()) {
  if (entry?.status !== "PUBLISHED" || !entry.updatedAt || !entry.publishedAt) return false;
  const updated = Date.parse(entry.updatedAt);
  const published = Date.parse(entry.publishedAt);
  if (!Number.isFinite(updated) || !Number.isFinite(published)) return false;
  if (updated - published < 60_000) return false;
  return now - updated < UPDATED_WINDOW_MS;
}
