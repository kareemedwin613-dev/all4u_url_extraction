import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { appliersApi } from "../src/features/bulk-assignment/bulk-assignment-service.js";

const directory = await readFile(new URL("../src/features/applications/applier-directory-page.jsx", import.meta.url), "utf8");
const wizard = await readFile(new URL("../src/features/bulk-assignment/bulk-assignment-pages.jsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../../supabase/migrations/202608250073_v3_13_applier_resume_profiles.sql", import.meta.url), "utf8");
const profileAssign = await readFile(new URL("../../supabase/migrations/202608250075_v3_15_profile_bulk_assignment.sql", import.meta.url), "utf8");

test("applier directory manages exclusive resume profiles", () => {
  assert.match(directory, /Manage Profiles/);
  assert.match(directory, /Assigned Profiles/);
  assert.match(directory, /This Applier cannot receive Applications until at least one profile is assigned/);
  assert.match(directory, /setResumeProfiles/);
  assert.match(directory, /listResumeProfileOptions/);
  assert.match(directory, /ownedByOther/);
});

test("bulk assignment preview surfaces profile mismatch exclusions", () => {
  assert.match(wizard, /RESUME_PROFILE_MISSING/);
  assert.match(wizard, /strategy: "PROFILE"/);
  assert.match(wizard, /Resume has no Applier profile/);
});

test("migration enforces exclusive unique resume mapping and assignment gates", () => {
  assert.match(migration, /applier_resume_profiles_resume_unique/);
  assert.match(migration, /assert_applier_may_use_resume/);
  assert.match(migration, /APPLIER_PROFILE_REQUIRED/);
  assert.match(migration, /APPLIER_RESUME_NOT_ALLOWED/);
  assert.match(migration, /RESUME_PROFILE_TAKEN/);
  assert.match(migration, /create_application/);
  assert.match(migration, /reassign_application/);
  assert.match(profileAssign, /RESUME_PROFILE_MISSING/);
  assert.match(profileAssign, /preview_bulk_assignment_v08/);
  assert.match(profileAssign, /assign_applications_bulk_v08/);
});

test("frontend APIs call Nest resume-profile routes", async () => {
  const paths = [];
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } }, error: null }) } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    paths.push({ url: String(url), options });
    return { ok: true, headers: { get: () => null }, json: async () => ({ data: [] }) };
  };
  try {
    await appliersApi.listResumeProfileOptions(client, "https://api.example");
    await appliersApi.listResumeProfiles(client, "https://api.example", "applier-1");
    await appliersApi.setResumeProfiles(client, "https://api.example", "applier-1", ["resume-1"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(paths.map((x) => new URL(x.url).pathname), [
    "/api/v1/appliers/resume-profile-options",
    "/api/v1/appliers/applier-1/resume-profiles",
    "/api/v1/appliers/applier-1/resume-profiles",
  ]);
  assert.equal(paths[2].options.method, "PUT");
  assert.equal(JSON.parse(paths[2].options.body).resumeIds[0], "resume-1");
});
