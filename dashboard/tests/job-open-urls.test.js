import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { openExternalUrls, safeExternalUrl } from "../src/shared/url.js";
import { MAX_OPEN_JOB_URLS } from "../src/features/bulk-applications/bulk-state.js";

test("openExternalUrls deduplicates and caps tabs", () => {
  const opened = [];
  const originalOpen = globalThis.window?.open;
  globalThis.window = { ...(globalThis.window || {}), open: (url) => {
    opened.push(url);
    return {};
  } };
  try {
    const result = openExternalUrls(
      [
        "https://example.com/jobs/1",
        "https://example.com/jobs/1",
        "https://example.com/jobs/2",
        "ftp://bad.example/job",
        "not-a-url",
        ...Array.from({ length: 30 }, (_, index) => `https://example.com/jobs/${index + 3}`),
      ],
      { limit: MAX_OPEN_JOB_URLS },
    );
    assert.equal(result.total, 32);
    assert.equal(result.attempted, MAX_OPEN_JOB_URLS);
    assert.equal(result.opened, MAX_OPEN_JOB_URLS);
    assert.equal(result.skipped, 32 - MAX_OPEN_JOB_URLS);
    assert.equal(new Set(opened).size, opened.length);
    assert.ok(opened.every((url) => url.startsWith("https://")));
  } finally {
    if (originalOpen) globalThis.window.open = originalOpen;
    else delete globalThis.window.open;
  }
});

test("safeExternalUrl accepts http and https only", () => {
  assert.equal(safeExternalUrl("https://example.com/jobs/1"), "https://example.com/jobs/1");
  assert.equal(safeExternalUrl("javascript:alert(1)"), null);
});

test("Jobs list exposes Open Selected URLs for bulk selection", async () => {
  const source = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /Open Selected URLs/);
  assert.match(source, /openSelectedJobUrls/);
  assert.match(source, /openExternalUrls/);
  assert.match(source, /MAX_OPEN_JOB_URLS/);
  assert.match(source, /rememberSelectedJobs/);
});
