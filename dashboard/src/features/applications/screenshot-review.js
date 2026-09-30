import { serializeApplicationQuery } from "./query-state.js";

export function applicationReviewHref(applicationId, filters = {}, { review = false } = {}) {
  const params = new URLSearchParams(serializeApplicationQuery(filters));
  if (review) params.set("review", "1");
  const query = params.toString();
  return `#/applications/${applicationId}${query ? `?${query}` : ""}`;
}

export function reviewRequested(query = "") {
  return new URLSearchParams(query).get("review") === "1";
}

export const SCREENSHOT_ZOOM_STEPS = Object.freeze([50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180, 200]);

export function stepScreenshotZoom(current, direction) {
  const value = Number(current) || 100;
  if (direction > 0) return SCREENSHOT_ZOOM_STEPS.find((step) => step > value) ?? SCREENSHOT_ZOOM_STEPS.at(-1);
  return [...SCREENSHOT_ZOOM_STEPS].reverse().find((step) => step < value) ?? SCREENSHOT_ZOOM_STEPS[0];
}

export function screenshotReviewStatus(application) {
  const status = String(application?.screenshot_review_status || "").toUpperCase();
  if (status === "CORRECT" || status === "HAS_MISTAKES") return status;
  if (String(application?.screenshot_feedback || "").trim()) return "HAS_MISTAKES";
  return "";
}

export function screenshotPrefetchIds(items, applicationId, { ahead = 4, behind = 1 } = {}) {
  const list = (Array.isArray(items) ? items : []).filter((item) => Number(item?.screenshot_count) > 0);
  const index = list.findIndex((item) => item.id === applicationId);
  if (index < 0) return applicationId ? [applicationId] : [];
  const ids = [list[index].id];
  for (let step = 1; step <= Math.max(ahead, behind); step += 1) {
    if (step <= ahead && index + step < list.length) ids.push(list[index + step].id);
    if (step <= behind && index - step >= 0) ids.push(list[index - step].id);
  }
  return ids;
}

export function upcomingScreenshotIds(items, applicationId, count = 4) {
  const list = Array.isArray(items) ? items : [];
  const index = list.findIndex((item) => item.id === applicationId);
  const ids = [];
  for (let i = index >= 0 ? index + 1 : 0; i < list.length && ids.length < count; i += 1) {
    if (Number(list[i]?.screenshot_count) > 0) ids.push(list[i].id);
  }
  return ids;
}

function withScreenshot(item, applicationId) {
  return item && item.id !== applicationId && Number(item.screenshot_count) > 0;
}

export function loadedReviewNeighbor(items, applicationId, direction) {
  const list = Array.isArray(items) ? items : [];
  const index = list.findIndex((item) => item.id === applicationId);
  if (index < 0) return { located: false, item: null };
  const step = direction === "previous" ? -1 : 1;
  for (let i = index + step; i >= 0 && i < list.length; i += step) {
    if (withScreenshot(list[i], applicationId)) return { located: true, item: list[i] };
  }
  return { located: true, item: null };
}

export async function findReviewNeighbor(fetchPage, filters, applicationId, direction) {
  const pageSize = filters.pageSize || 25;
  const step = direction === "previous" ? -1 : 1;
  const hinted = Math.max(1, Number(filters.page) || 1);
  const first = await fetchPage({ ...filters, page: hinted, pageSize });
  const pageCount = Math.max(1, Number(first?.pageCount) || 1);
  const pages = [];
  for (let page = hinted; page >= 1 && page <= pageCount && pages.length < 40; page += step) pages.push(page);
  let seenCurrent = false;
  for (const page of pages) {
    const data = page === hinted ? first : await fetchPage({ ...filters, page, pageSize });
    const items = data?.items || [];
    const index = items.findIndex((item) => item.id === applicationId);
    if (index >= 0) seenCurrent = true;
    const start = index >= 0 ? index + step : seenCurrent ? (step > 0 ? 0 : items.length - 1) : -1;
    if (start < 0) continue;
    for (let i = start; step > 0 ? i < items.length : i >= 0; i += step) {
      if (withScreenshot(items[i], applicationId)) return { id: items[i].id, page, item: items[i], items };
    }
  }
  return null;
}
