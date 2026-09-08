import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bulkReviewJobs, removeExpiredJobs } from "../src/services/job-read-service.js";

const client = {
  auth: {
    getSession: async () => ({ data: { session: { access_token: "token" } }, error: null }),
  },
};
const id = "123e4567-e89b-42d3-a456-426614174000";

test("bulkReviewJobs posts Nest bulk-review route", async () => {
  let request;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    request = { url: String(url), options };
    return new Response(
      JSON.stringify({
        data: {
          total: 1,
          succeeded: 1,
          failed: 0,
          results: [{ id, ok: true, data: { id, review_status: "APPROVED" } }],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const result = await bulkReviewJobs(client, "https://api.example.com", {
      jobDescriptionIds: [id],
      reviewStatus: "APPROVED",
    });
    assert.equal(result.succeeded, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(new URL(request.url).pathname, "/api/v1/job-descriptions/bulk-review");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), {
    jobDescriptionIds: [id],
    reviewStatus: "APPROVED",
  });
});

test("removeExpiredJobs posts Nest bulk-remove-expired route", async () => {
  let request;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    request = { url: String(url), options };
    return new Response(
      JSON.stringify({
        data: {
          total: 1,
          succeeded: 1,
          failed: 0,
          deletedApplications: 2,
          results: [{ id, ok: true, data: { id, jobDeleted: true, deletedApplications: 2, keptApplications: 0 } }],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const result = await removeExpiredJobs(client, "https://api.example.com", {
      jobDescriptionIds: [id],
    });
    assert.equal(result.succeeded, 1);
    assert.equal(result.deletedApplications, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(new URL(request.url).pathname, "/api/v1/job-descriptions/bulk-remove-expired");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), {
    jobDescriptionIds: [id],
  });
});

test("Jobs list exposes bulk review actions for managers", async () => {
  const source = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /Approve Selected/);
  assert.match(source, /Decline Selected/);
  assert.match(source, /Delete Selected/);
  assert.match(source, /Remove Expired Job URLs/);
  assert.match(source, /bulkReviewJobs/);
  assert.match(source, /bulkDeleteJobs/);
  assert.match(source, /removeExpiredJobs/);
  assert.match(source, /submitBulkReview/);
  assert.match(source, /submitBulkDelete/);
  assert.match(source, /submitRemoveExpired/);
  assert.match(source, /hasNeedsReviewSelected/);
  assert.match(source, /createApplicationsDisabled/);
  const api = await readFile(
    new URL("../../apps/api/src/job-descriptions/job-description-read.controller.ts", import.meta.url),
    "utf8",
  );
  assert.match(api, /Post\("bulk-review"\)/);
  assert.match(api, /Post\("bulk-delete"\)/);
  assert.match(api, /Post\("bulk-remove-expired"\)/);
  const service = await readFile(
    new URL("../../apps/api/src/job-descriptions/job-description-read.service.ts", import.meta.url),
    "utf8",
  );
  assert.match(service, /bulk_review_job_descriptions_v311/);
  assert.match(service, /bulk_delete_job_descriptions_v314/);
  assert.match(service, /remove_expired_job_descriptions_v364/);
  const migration = await readFile(
    new URL("../../supabase/migrations/202608250071_v3_11_bulk_job_description_review.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /bulk_review_job_descriptions_v311/);
  const deleteMigration = await readFile(
    new URL("../../supabase/migrations/202608270087_v3_27_bulk_delete_job_descriptions.sql", import.meta.url),
    "utf8",
  );
  assert.match(deleteMigration, /JOB_HAS_APPLICATIONS/);
  const removeExpiredMigration = await readFile(
    new URL("../../supabase/migrations/202609081145_v3_64_remove_expired_job_urls.sql", import.meta.url),
    "utf8",
  );
  assert.match(removeExpiredMigration, /remove_expired_job_descriptions_v364/);
  assert.match(removeExpiredMigration, /assert_application_manager/);
  assert.match(removeExpiredMigration, /'UNASSIGNED',\s*'ASSIGNED',\s*'IN_PROGRESS'/);
  assert.match(removeExpiredMigration, /jobDeleted/);
  assert.match(removeExpiredMigration, /keptApplications/);
  assert.match(removeExpiredMigration, /Applied, Blocked, or later applications remain/);
});
