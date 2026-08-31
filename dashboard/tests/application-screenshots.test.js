import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateApplicationScreenshotFile } from "../src/features/applications/application-service.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("validateApplicationScreenshotFile accepts common image types and infers MIME from extension", () => {
  assert.equal(
    validateApplicationScreenshotFile({ name: "confirmation.png", type: "", size: 1024 }).valid,
    true,
  );
  assert.equal(
    validateApplicationScreenshotFile({ name: "confirmation.jpg", type: "", size: 1024 }).mime,
    "image/jpeg",
  );
  assert.equal(
    validateApplicationScreenshotFile({ name: "note.txt", type: "text/plain", size: 1024 }).valid,
    false,
  );
});

test("Application screenshot services use protected API routes", async () => {
  const [service, extensionService] = await Promise.all([
    read("../src/features/applications/application-service.js"),
    read("../../extension/services/application-service.js"),
  ]);
  assert.match(service, /listApplicationScreenshots/);
  assert.match(service, /\/api\/v1\/applications\/\$\{encodeURIComponent\(applicationId\)\}\/screenshots/);
  assert.match(service, /attachApplicationScreenshot/);
  assert.match(service, /removeApplicationScreenshot/);
  assert.match(service, /validateApplicationScreenshotFile/);
  assert.match(service, /getApplicationScreenshotUrl/);
  assert.match(service, /\/screenshots\/\$\{encodeURIComponent\(screenshotId\)\}\/file-url/);
  assert.match(service, /openApplicationScreenshot/);
  assert.match(service, /timeoutMs:SCREENSHOT_UPLOAD_TIMEOUT_MS/);
  assert.match(extensionService, /timeoutMs:SCREENSHOT_UPLOAD_TIMEOUT_MS/);
  assert.match(extensionService, /inferScreenshotMime/);
});

test("Application detail page includes screenshot count, upload, and remove UI", async () => {
  const [pages, card, styles] = await Promise.all([
    read("../src/features/applications/application-pages.jsx"),
    read("../src/features/applications/application-screenshots-card.jsx"),
    read("../src/styles/applications.css"),
  ]);

  assert.match(pages, /ApplicationScreenshotsCard/);
  assert.match(pages, /applicationId=\{id\}/);
  assert.match(pages, /onCountChange=\{setScreenshotCount\}/);
  assert.match(pages, /Confirmation Screenshots/);
  assert.match(pages, /screenshot_count/);
  assert.match(card, /Confirmation Screenshots/);
  assert.match(card, /Upload screenshot/);
  assert.match(card, /removeApplicationScreenshot/);
  assert.match(card, /attachApplicationScreenshot/);
  assert.match(card, /listApplicationScreenshots/);
  assert.match(card, /getApplicationScreenshotUrl/);
  assert.match(card, /application-screenshot-preview/);
  assert.match(styles, /application-screenshots-grid/);
});
