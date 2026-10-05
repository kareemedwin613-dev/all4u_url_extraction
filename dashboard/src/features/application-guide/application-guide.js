const UPDATED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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
