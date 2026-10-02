import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  UNASSIGNED_FILTER,
  countScreenshotReviewerFilters,
  parseScreenshotReviewerFilters,
  screenshotReviewerRowMatches,
} from "../src/features/applications/screenshot-reviewer-filters.js";

const primary = "11111111-1111-4111-8111-111111111111";
const secondary = "22222222-2222-4222-8222-222222222222";
const row = {
  candidate_name: "Ava Chen",
  candidate_email: "ava@example.com",
  resume_name: "Ava Chen Resume",
  resume_status: "ACTIVE",
  current_applier_name: "Jordan Lee",
  primary_reviewer_id: primary,
  secondary_reviewer_id: secondary,
};

test("screenshot reviewer filters combine profile, status, applier, and reviewers", () => {
  const filters = parseScreenshotReviewerFilters(
    `profile=Ava&status=ACTIVE&currentApplier=${encodeURIComponent("Jordan Lee")}&primaryReviewer=${primary}&secondaryReviewer=${secondary}`,
  );
  assert.equal(countScreenshotReviewerFilters(filters, { isAdmin: true }), 5);
  assert.equal(screenshotReviewerRowMatches(row, filters, { isAdmin: true }), true);
  assert.equal(screenshotReviewerRowMatches(row, { ...filters, profile: "other" }, { isAdmin: true }), false);
  assert.equal(screenshotReviewerRowMatches(row, { ...filters, status: "ARCHIVED" }, { isAdmin: true }), false);
  assert.equal(screenshotReviewerRowMatches(row, { ...filters, currentApplier: "Someone Else" }, { isAdmin: true }), false);
  assert.equal(screenshotReviewerRowMatches(row, { ...filters, primaryReviewer: secondary }, { isAdmin: true }), false);
});

test("unassigned reviewer and applier filters match empty assignments", () => {
  const empty = { ...row, current_applier_name: "", primary_reviewer_id: null, secondary_reviewer_id: "" };
  const filters = {
    profile: "",
    status: "",
    currentApplier: UNASSIGNED_FILTER,
    primaryReviewer: UNASSIGNED_FILTER,
    secondaryReviewer: UNASSIGNED_FILTER,
  };
  assert.equal(screenshotReviewerRowMatches(empty, filters, { isAdmin: true }), true);
  assert.equal(screenshotReviewerRowMatches(row, filters, { isAdmin: true }), false);
});

test("reviewer filters stay on the loaded rows and do not reload assignments", async () => {
  const source = await readFile(new URL("../src/features/applications/screenshot-reviewers-page.jsx", import.meta.url), "utf8");
  assert.match(source, /\[period\.window, period\.from, period\.to\]/);
  assert.match(source, /generation !== loadGeneration\.current/);
  assert.match(source, /screenshotReviewerRowMatches\(row, filters, \{ isAdmin \}\)/);
});

test("current applier filter is ignored unless the viewer is an admin", () => {
  const filters = { profile: "", status: "", currentApplier: "Someone Else", primaryReviewer: "", secondaryReviewer: "" };
  assert.equal(screenshotReviewerRowMatches(row, filters, { isAdmin: false }), true);
  assert.equal(countScreenshotReviewerFilters(filters, { isAdmin: false }), 0);
  assert.equal(countScreenshotReviewerFilters(filters, { isAdmin: true }), 1);
});
