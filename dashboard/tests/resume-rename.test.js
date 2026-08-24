import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renameResume } from "../src/services/resume-read-service.js";

test("renameResume patches Nest /name route", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "token" } }, error: null }),
    },
  };
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body });
    return new Response(JSON.stringify({ data: { id: "resume-1", resume_name: "Brian Rose Resume" } }), { status: 200 });
  };
  try {
    const result = await renameResume(
      client,
      "https://api.example.com",
      "f3a34ffd-d66a-49f7-815e-c7786857576b",
      "Brian Rose Resume",
    );
    assert.equal(result.resume_name, "Brian Rose Resume");
    await assert.rejects(() => renameResume(client, "https://api.example.com", "f3a34ffd-d66a-49f7-815e-c7786857576b", "  "), {
      code: "VALIDATION_ERROR",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls[0].method, "PATCH");
  assert.match(calls[0].url, /\/api\/v1\/resumes\/f3a34ffd-d66a-49f7-815e-c7786857576b\/name$/);
  assert.match(calls[0].body, /Brian Rose Resume/);
});

test("Resume editor exposes Resume Name on personal details form", async () => {
  const page = await readFile(new URL("../src/features/candidates/candidate-profile-page.jsx", import.meta.url), "utf8");
  assert.match(page, /name="resumeName"/);
  assert.match(page, /label="Resume Name"/);
  assert.match(page, /renameResume/);
  const detail = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.equal(/Rename Resume/.test(detail), false);
  const migration = await readFile(
    new URL("../../supabase/migrations/202608240070_v3_10_resume_name_on_autofill_profile.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /'resumeName',r\.resume_name/);
});
