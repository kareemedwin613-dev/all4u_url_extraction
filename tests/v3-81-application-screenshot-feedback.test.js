import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateScreenshotFeedback } from "../dashboard/src/features/applications/validation.js";
import { updateApplicationScreenshotFeedback } from "../dashboard/src/features/applications/application-service.js";

const sql = await readFile(
  new URL("../supabase/migrations/202609121300_v3_81_application_screenshot_feedback.sql", import.meta.url),
  "utf8",
);
const id = "f3a34ffd-d66a-49f7-815e-c7786857576b";

test("v3.81 adds screenshot feedback columns and manager RPC", () => {
  assert.match(sql, /screenshot_feedback text not null default ''/);
  assert.match(sql, /screenshot_feedback_by uuid/);
  assert.match(sql, /screenshot_feedback_at timestamptz/);
  assert.match(sql, /applications_screenshot_feedback_length/);
  assert.match(sql, /char_length\(screenshot_feedback\) <= 2000/);
  assert.match(sql, /set_application_screenshot_feedback_v381/);
  assert.match(sql, /assert_application_manager\(\)/);
  assert.match(sql, /a\.screenshot_feedback/);
});

test("screenshot feedback validation enforces max length", () => {
  assert.equal(validateScreenshotFeedback({ feedback: "Looks incomplete" }).valid, true);
  assert.equal(validateScreenshotFeedback({ feedback: "x".repeat(2000) }).valid, true);
  assert.equal(validateScreenshotFeedback({ feedback: "x".repeat(2001) }).valid, false);
});

test("screenshot feedback service patches the manager endpoint", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "token" } }, error: null }),
    },
  };
  globalThis.fetch = async (url, options) => {
    calls.push({ url: new URL(url), options, body: options.body ? JSON.parse(options.body) : null });
    return new Response(
      JSON.stringify({
        data: {
          id,
          screenshot_feedback: "Missing confirmation page",
          screenshot_feedback_at: "2026-09-12T12:00:00.000Z",
        },
      }),
      { status: 200 },
    );
  };
  try {
    const updated = await updateApplicationScreenshotFeedback(client, "https://api.example.com", id, "Missing confirmation page");
    assert.equal(updated.screenshot_feedback, "Missing confirmation page");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "PATCH");
  assert.equal(calls[0].url.pathname, `/api/v1/applications/${id}/screenshot-feedback`);
  assert.deepEqual(calls[0].body, { feedback: "Missing confirmation page" });
});

test("v3.82 surfaces screenshot feedback on Application lists", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/202609121400_v3_82_application_list_screenshot_feedback.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /a\.screenshot_feedback,a\.screenshot_feedback_at/);
  assert.match(sql, /list_applications_v07/);
});

test("v3.83 filters Applications by screenshot feedback", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/202609121500_v3_83_screenshot_feedback_filter.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /p_screenshot_feedback text default ''/);
  assert.match(sql, /HAS_FEEDBACK/);
  assert.match(sql, /NO_FEEDBACK/);
  assert.match(sql, /list_applications_v360/);
  assert.match(sql, /list_my_applications_v20/);
});

test("dashboard Filters include screenshot feedback control", async () => {
  const source = await readFile(
    new URL("../dashboard/src/features/applications/application-pages.jsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /Screenshot feedback/);
  assert.match(source, /HAS_FEEDBACK/);
  assert.match(source, /Has feedback \(mistakes\)/);
});

test("dashboard and extension surface screenshot feedback in list and detail", async () => {
  const card = await readFile(
    new URL("../dashboard/src/features/applications/application-screenshots-card.jsx", import.meta.url),
    "utf8",
  );
  const detail = await readFile(
    new URL("../dashboard/src/features/applications/application-pages.jsx", import.meta.url),
    "utf8",
  );
  const modal = await readFile(
    new URL("../extension/sidepanel/components/ApplicationStatusModal.jsx", import.meta.url),
    "utf8",
  );
  const appCard = await readFile(
    new URL("../extension/sidepanel/components/ApplicationCard.jsx", import.meta.url),
    "utf8",
  );
  assert.match(card, /Screenshot review feedback/);
  assert.match(card, /updateApplicationScreenshotFeedback/);
  assert.match(detail, /onFeedbackSaved/);
  assert.match(detail, /a\.screenshot_feedback/);
  assert.match(detail, /WarningOutlined/);
  assert.match(modal, /application\.screenshot_feedback/);
  assert.match(modal, /Screenshot review feedback/);
  assert.match(appCard, /screenshot_feedback/);
  assert.match(appCard, /WarningOutlined/);
});
