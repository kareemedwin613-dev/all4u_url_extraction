import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  addResumeBannedCompany,
  listResumeBannedCompanies,
  removeResumeBannedCompany,
} from "../src/services/resume-banned-companies-service.js";

test("banned company client helpers use Nest routes", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "token" } }, error: null }),
    },
  };
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body });
    return new Response(JSON.stringify({ data: [{ id: "ban-1", companyName: "Google" }] }), { status: 200 });
  };
  try {
    await listResumeBannedCompanies(client, "https://api.example.com", "f3a34ffd-d66a-49f7-815e-c7786857576b");
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || "GET", body: options.body });
      return new Response(JSON.stringify({ data: { id: "ban-2", companyName: "Amazon" } }), { status: 200 });
    };
    await addResumeBannedCompany(client, "https://api.example.com", "f3a34ffd-d66a-49f7-815e-c7786857576b", "Amazon");
    await removeResumeBannedCompany(client, "https://api.example.com", "f3a34ffd-d66a-49f7-815e-c7786857576b", "ban-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.match(calls[0].url, /\/banned-companies$/);
  assert.equal(calls[1].method, "POST");
  assert.match(calls[1].body, /Amazon/);
  assert.equal(calls[2].method, "DELETE");
});

test("Resume Detail exposes Banned Companies controls", async () => {
  const source = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /Banned Companies/);
  assert.match(source, /ResumeBannedCompaniesCard/);
  assert.match(source, /addResumeBannedCompany/);
  assert.match(source, /listResumeBannedCompanies/);
  const migration = await readFile(
    new URL("../../supabase/migrations/202608240068_v3_8_resume_banned_companies.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /APPLICATION_BANNED_COMPANY/);
  assert.match(migration, /BANNED_COMPANY/);
  assert.match(migration, /require_resume_company_not_banned_v38/);
});
