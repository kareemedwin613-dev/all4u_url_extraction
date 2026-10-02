import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applicationReviewHref, findReviewNeighbor, loadedReviewNeighbor, reviewRequested, screenshotPrefetchIds, screenshotReviewStatus, stepScreenshotZoom, upcomingScreenshotIds } from "../src/features/applications/screenshot-review.js";

const row = (id, screenshotCount) => ({ id, screenshot_count: screenshotCount });

test("review links keep the Applications list filters and open the viewer", () => {
  const href = applicationReviewHref("0055ead1-0a66-4b52-854e-90568b867742", { status: "APPLIED", page: 4, pageSize: 25 }, { review: true });
  assert.match(href, /^#\/applications\/0055ead1-0a66-4b52-854e-90568b867742\?/);
  assert.match(href, /status=APPLIED/);
  assert.match(href, /page=4/);
  assert.match(href, /review=1/);
  assert.equal(reviewRequested(href.split("?")[1]), true);
});

test("screenshot review can maximize and minimize the preview", async () => {
  const source = await readFile(new URL("../src/features/applications/screenshot-review-modal.jsx", import.meta.url), "utf8");
  const card = await readFile(new URL("../src/features/applications/application-screenshots-card.jsx", import.meta.url), "utf8");
  assert.match(source, /autoFocus/);
  assert.match(card, /autoFocus/);
  assert.match(source, /maskClosable=\{false\}/);
  assert.match(source, /keyboard=\{false\}/);
  assert.match(card, /maskClosable=\{false\}/);
  assert.match(card, /keyboard=\{false\}/);
  assert.match(source, /Maximize/);
  assert.match(source, /Minimize/);
  assert.match(source, /application-screenshot-review--max/);
  assert.match(source, /Screenshot size/);
  assert.match(source, /event\.ctrlKey/);
});

test("changing a screenshot reviewer asks for confirmation before saving", async () => {
  const source = await readFile(new URL("../src/features/applications/screenshot-reviewers-page.jsx", import.meta.url), "utf8");
  assert.match(source, /modal\.confirm\(/);
  assert.match(source, /Change \$\{role\}\?/);
  assert.match(source, /confirmReviewerChange\(row, "primary", next\)/);
  assert.match(source, /confirmReviewerChange\(row, "secondary", next\)/);
  assert.doesNotMatch(source, /onChange=\{\(next\) => save\(/);
});

test("screenshot review status distinguishes correct, mistakes, and unchecked", () => {
  assert.equal(screenshotReviewStatus({ screenshot_review_status: "CORRECT" }), "CORRECT");
  assert.equal(screenshotReviewStatus({ screenshot_review_status: "HAS_MISTAKES", screenshot_feedback: "Wrong page" }), "HAS_MISTAKES");
  assert.equal(screenshotReviewStatus({ screenshot_feedback: "Wrong page" }), "HAS_MISTAKES");
  assert.equal(screenshotReviewStatus({ screenshot_feedback: "" }), "");
});

test("screenshot review badges mark checked screenshots", async () => {
  const modal = await readFile(new URL("../src/features/applications/screenshot-review-modal.jsx", import.meta.url), "utf8");
  const pages = await readFile(new URL("../src/features/applications/application-pages.jsx", import.meta.url), "utf8");
  const sql = await readFile(new URL("../../supabase/migrations/202609301400_v3_133_screenshot_review_status.sql", import.meta.url), "utf8");
  assert.match(modal, /Not checked/);
  assert.match(modal, /reviewStatus: "CORRECT"/);
  assert.match(modal, /reviewStatus: "HAS_MISTAKES"/);
  assert.match(modal, /listScreenshotPreviews/);
  assert.match(modal, /screenshotPrefetchIds/);
  assert.match(pages, /Has mistakes/);
  assert.match(sql, /screenshot_review_status/);
  assert.match(sql, /set_application_screenshot_feedback_v3133/);
});

test("screenshot review prefetches the next screenshots before the page ends", () => {
  const items = [row("a", 1), row("b", 0), row("c", 1), row("d", 1), row("e", 1), row("f", 1)];
  assert.deepEqual(screenshotPrefetchIds(items, "a"), ["a", "c", "d", "e", "f"]);
  assert.deepEqual(screenshotPrefetchIds(items, "e"), ["e", "f", "d"]);
  assert.deepEqual(upcomingScreenshotIds(items, "d", 4), ["e", "f"]);
});

test("screenshot zoom steps by ten percent", () => {
  assert.equal(stepScreenshotZoom(100, 1), 110);
  assert.equal(stepScreenshotZoom(100, -1), 90);
  assert.equal(stepScreenshotZoom(70, 1), 80);
  assert.equal(stepScreenshotZoom(120, -1), 110);
  assert.equal(stepScreenshotZoom(200, 1), 200);
  assert.equal(stepScreenshotZoom(50, -1), 50);
});

test("loaded page neighbor stays on the applications already in view", () => {
  const items = [row("a", 1), row("b", 0), row("c", 1)];
  assert.equal(loadedReviewNeighbor(items, "a", "next").item.id, "c");
  assert.equal(loadedReviewNeighbor(items, "c", "next").item, null);
  assert.equal(loadedReviewNeighbor(items, "c", "next").located, true);
});

test("review neighbor is the nearest application with a screenshot", async () => {
  const pages = {
    2: { items: [row("a", 1), row("b", 0), row("c", 1)], pageCount: 3 },
    3: { items: [row("d", 0), row("e", 1)], pageCount: 3 },
    1: { items: [row("z", 1)], pageCount: 3 },
  };
  const fetchPage = async (filters) => pages[filters.page];
  assert.equal((await findReviewNeighbor(fetchPage, { page: 2, pageSize: 25 }, "a", "next")).id, "c");
  assert.equal((await findReviewNeighbor(fetchPage, { page: 2, pageSize: 25 }, "c", "next")).id, "e");
  assert.equal((await findReviewNeighbor(fetchPage, { page: 2, pageSize: 25 }, "a", "previous")).id, "z");
  assert.equal(await findReviewNeighbor(fetchPage, { page: 3, pageSize: 25 }, "e", "next"), null);
});
