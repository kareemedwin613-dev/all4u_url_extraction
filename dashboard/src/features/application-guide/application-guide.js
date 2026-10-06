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
