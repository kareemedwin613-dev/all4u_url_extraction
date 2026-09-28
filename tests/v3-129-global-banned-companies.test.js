import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { findGlobalBannedCompany } from "../extension/shared/banned-company.js";

const sql = readFileSync(new URL("../supabase/migrations/202609281900_v3_129_global_banned_companies.sql", import.meta.url), "utf8");

test("global banned companies are a catalog list with manager writes and capture rejection", () => {
  assert.match(sql, /create table if not exists public\.global_banned_companies/);
  assert.match(sql, /has_any_role\(array\['JD_FINDER', 'APPLYING_MANAGER', 'ADMIN'\]\)/);
  assert.match(sql, /application_actor_can_manage\(\)/);
  assert.match(sql, /list_global_banned_companies_v3129/);
  assert.match(sql, /reject_globally_banned_job_company/);
  assert.match(sql, /GLOBAL_BANNED_COMPANY/);
  assert.match(sql, /revoke all on table public\.global_banned_companies from public, anon, authenticated/);
});

test("company matching ignores case and extra spaces", () => {
  const entries = [{ companyName: "Labcorp" }];
  assert.equal(findGlobalBannedCompany("  labcorp ", entries).companyName, "Labcorp");
  assert.equal(findGlobalBannedCompany("Labcorp Inc", entries), null);
  assert.equal(findGlobalBannedCompany("", entries), null);
});
