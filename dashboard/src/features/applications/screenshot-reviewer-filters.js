export const UNASSIGNED_FILTER = "00000000-0000-4000-8000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const clip = (value, limit = 100) => String(value || "").trim().slice(0, limit);

function idFilter(value) {
  const text = clip(value, 80);
  if (!text) return "";
  if (text === UNASSIGNED_FILTER || UUID.test(text)) return text;
  return "";
}

function personFilter(value) {
  const text = clip(value, 200);
  if (!text) return "";
  if (text === UNASSIGNED_FILTER) return text;
  return text;
}

const REVIEW_FILTERS = new Set(["CORRECT", "HAS_MISTAKES", "NOT_REVIEWED"]);

function reviewFilter(value) {
  const text = clip(value, 20).toUpperCase().replace(/-/g, "_");
  return REVIEW_FILTERS.has(text) ? text : "";
}

export function screenshotMatchesReviewFilter(status, review) {
  const selected = reviewFilter(review);
  if (!selected) return true;
  const value = String(status || "").toUpperCase();
  if (selected === "CORRECT") return value === "CORRECT";
  if (selected === "HAS_MISTAKES") return value === "HAS_MISTAKES";
  return value !== "CORRECT" && value !== "HAS_MISTAKES";
}

function matchesReview(selected, row) {
  if (!selected) return true;
  const reviewed = Number(row?.reviewed_screenshot_count) || 0;
  const mistakes = Number(row?.mistake_screenshot_count) || 0;
  const unchecked = Number(row?.unreviewed_screenshot_count) || 0;
  if (selected === "CORRECT") return reviewed - mistakes > 0;
  if (selected === "HAS_MISTAKES") return mistakes > 0;
  return unchecked > 0;
}

export function parseScreenshotReviewerFilters(query = "") {
  const params = new URLSearchParams(query);
  const status = clip(params.get("status"), 20).toUpperCase();
  return {
    profile: clip(params.get("profile")),
    status: status === "ACTIVE" || status === "ARCHIVED" ? status : "",
    currentApplier: personFilter(params.get("currentApplier")),
    primaryReviewer: idFilter(params.get("primaryReviewer")),
    secondaryReviewer: idFilter(params.get("secondaryReviewer")),
    review: reviewFilter(params.get("review")),
  };
}

export function countScreenshotReviewerFilters(filters = {}, { isAdmin = false } = {}) {
  let count = 0;
  if (filters.profile) count += 1;
  if (filters.status) count += 1;
  if (isAdmin && filters.currentApplier) count += 1;
  if (filters.primaryReviewer) count += 1;
  if (filters.secondaryReviewer) count += 1;
  if (filters.review) count += 1;
  return count;
}

function matchesAssigned(selected, actual) {
  if (!selected) return true;
  const value = String(actual || "").trim();
  if (selected === UNASSIGNED_FILTER) return !value;
  return value === selected;
}

export function screenshotReviewerRowMatches(row, filters = {}, { isAdmin = false } = {}) {
  const profile = String(filters.profile || "").trim().toLowerCase();
  if (profile) {
    const haystack = [row?.candidate_name, row?.candidate_email, row?.resume_name]
      .map((value) => String(value || "").toLowerCase())
      .join(" ");
    if (!haystack.includes(profile)) return false;
  }
  if (filters.status && String(row?.resume_status || "").toUpperCase() !== filters.status) return false;
  if (isAdmin && !matchesAssigned(filters.currentApplier, row?.current_applier_name)) return false;
  if (!matchesAssigned(filters.primaryReviewer, row?.primary_reviewer_id)) return false;
  if (!matchesAssigned(filters.secondaryReviewer, row?.secondary_reviewer_id)) return false;
  if (!matchesReview(filters.review, row)) return false;
  return true;
}
