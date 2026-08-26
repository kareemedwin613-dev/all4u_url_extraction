import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { appliersApi, assignmentBatchesApi, bulkAssignmentApi, parseAssignmentIds, storeAssignmentIds } from "../src/features/bulk-assignment/bulk-assignment-service.js";

const source = await readFile(new URL("../src/features/bulk-assignment/bulk-assignment-pages.jsx", import.meta.url), "utf8");
const appSource = await readFile(new URL("../src/features/applications/application-pages.jsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../../supabase/migrations/202608250075_v3_15_profile_bulk_assignment.sql", import.meta.url), "utf8");

test("bulk-assignment wizard uses profile-only steps", () => {
  for (const label of ["Applications", "Preview", "Result", "PROFILE"]) assert.match(source, new RegExp(label));
  assert.match(source, /Steps/);
  assert.match(source, /Confirm Bulk Assignment/);
  assert.match(source, /Generate Preview/);
  assert.doesNotMatch(source, /CAPACITY_AWARE/);
  assert.doesNotMatch(source, /Choose Appliers/);
  assert.doesNotMatch(source, /Choose Distribution/);
  assert.doesNotMatch(source, /\bMANUAL\b/);
  assert.doesNotMatch(source, /\bEVEN\b/);
});

test("Application selection allows assigned Applications for reassignment", () => {
  assert.match(appSource, /Assign \/ Reassign Selected/);
  assert.match(appSource, /Assignment \/ Reassignment/);
  assert.match(appSource, /\["CANCELLED","CLOSED","COMPLETED"\]/);
  assert.match(appSource, /applications\/bulk-assign/);
  assert.match(appSource, /storeAssignmentIds/);
  assert.doesNotMatch(appSource, /record\.assigned_to != null/);
  assert.doesNotMatch(appSource, /bulkAssignApplications/);
});

test("bulk-assignment wizard supports assign and reassign copy", () => {
  assert.match(source, /assign or reassign/);
  assert.match(source, /Resume profile/);
});

test("profile migration matches Applications by resume profiles", () => {
  assert.match(migration, /RESUME_PROFILE_MISSING/);
  assert.match(migration, /applier_resume_profiles/);
  assert.match(migration, /'PROFILE'/);
  assert.match(migration, /INVALID_STRATEGY: Select PROFILE assignment strategy/);
});

test("frontend APIs use Nest routes and an idempotency header", async () => {
  const paths = [];
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } }, error: null }) } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    paths.push({ url: String(url), options });
    return { ok: true, headers: { get: () => null }, json: async () => ({ data: [], page: {} }) };
  };
  try {
    await appliersApi.getWorkloads(client, "https://api.example", {});
    await bulkAssignmentApi.preview(client, "https://api.example", { strategy: "PROFILE", applicationIds: ["a"] });
    await bulkAssignmentApi.assign(client, "https://api.example", { strategy: "PROFILE", assignments: [] }, "idempotency-123");
    await assignmentBatchesApi.list(client, "https://api.example", {});
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(paths.map((x) => new URL(x.url).pathname), [
    "/api/v1/appliers/workloads",
    "/api/v1/applications/bulk-assignment-preview",
    "/api/v1/applications/bulk-assign",
    "/api/v1/assignment-batches",
  ]);
  assert.equal(paths[2].options.headers["Idempotency-Key"], "idempotency-123");
});

test("stable Application identifiers persist outside the URL and are deduplicated", () => {
  const values = new Map();
  const storage = { setItem: (key, value) => values.set(key, value), getItem: (key) => values.get(key) };
  assert.deepEqual(storeAssignmentIds(["a", "b", "a"], storage), ["a", "b"]);
  assert.deepEqual(parseAssignmentIds("", storage), ["a", "b"]);
  assert.deepEqual(parseAssignmentIds("ids=c,c", storage), ["c"]);
});
