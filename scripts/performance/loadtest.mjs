// Reproducible, non-production-by-default load test for the list RPCs/queries touched by v0.7.1.
//
// SAFETY: never reads dashboard/.env.local or extension config, and never defaults to any URL -
// you must pass --url/--key (or set LOADTEST_SUPABASE_URL/LOADTEST_SUPABASE_KEY) explicitly every
// time. This is deliberate friction: it should never be possible to "accidentally" load test
// whatever project happens to be configured for real use, let alone production.
//
// Usage:
//   node scripts/performance/loadtest.mjs --url=https://xxxx.supabase.co --key=<anon-or-service-key> \
//     --email=<test-user-email> --password=<test-user-password> --concurrency=10 --requests=50
//
// Reports p50/p95/p99 per scenario. Uses the app's own @supabase/supabase-js dependency - no new
// package required.

import { createClient } from "@supabase/supabase-js";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? true];
  }),
);

const url = args.url || process.env.LOADTEST_SUPABASE_URL;
const key = args.key || process.env.LOADTEST_SUPABASE_KEY;
if (!url || !key) {
  console.error("Refusing to run: pass --url/--key or set LOADTEST_SUPABASE_URL/LOADTEST_SUPABASE_KEY explicitly.");
  process.exit(1);
}

const concurrency = Math.max(1, Number(args.concurrency) || 10);
const requestsPerScenario = Math.max(1, Number(args.requests) || 25);

console.log(`Target: ${new URL(url).host}`);
console.log(`Concurrency: ${concurrency}, requests per scenario: ${requestsPerScenario}`);

const client = createClient(url, key, { auth: { persistSession: false } });

if (args.email && args.password) {
  const { error } = await client.auth.signInWithPassword({ email: args.email, password: args.password });
  if (error) {
    console.error(`Sign-in failed: ${error.message}`);
    process.exit(1);
  }
} else {
  console.log("No --email/--password supplied - running unauthenticated (RLS will likely reject most scenarios; expected).");
}

function percentile(sortedMs, p) {
  if (!sortedMs.length) return null;
  const index = Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length));
  return sortedMs[index];
}

async function runScenario(name, fn) {
  const durations = [];
  let failures = 0;
  const queue = Array.from({ length: requestsPerScenario }, (_, i) => i);
  async function worker() {
    while (queue.length) {
      queue.shift();
      const start = performance.now();
      try {
        const { error } = await fn();
        if (error) failures++;
      } catch {
        failures++;
      }
      durations.push(performance.now() - start);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, requestsPerScenario) }, worker));
  durations.sort((a, b) => a - b);
  console.log(
    `${name}: p50=${percentile(durations, 50)?.toFixed(0)}ms p95=${percentile(durations, 95)?.toFixed(0)}ms p99=${percentile(durations, 99)?.toFixed(0)}ms failures=${failures}/${requestsPerScenario}`,
  );
}

const scenarios = [
  ["Applier queue (list_applications_cursor)", () => client.rpc("list_applications_cursor", { p_limit: 25 })],
  ["Manager Application list (list_applications_v07)", () => client.rpc("list_applications_v07", { p_limit: 25, p_offset: 0 })],
  ["JD search (full-text)", () => client.from("job_descriptions").select("id,company,job_title").textSearch("search_vector", "engineer", { type: "websearch", config: "english" }).limit(25)],
  ["Resume search (full-text)", () => client.from("resumes").select("id,candidate_name,resume_name").textSearch("search_vector", "engineer", { type: "websearch", config: "english" }).limit(25)],
  ["Bulk preview (100 JDs)", () => client.rpc("preview_bulk_applications", { p_selected_jd_ids: [] })],
  ["Business overview summary", () => client.rpc("get_business_overview")],
  ["Application counts summary", () => client.rpc("get_application_counts")],
];

for (const [name, fn] of scenarios) {
  // eslint-disable-next-line no-await-in-loop
  await runScenario(name, fn);
}

console.log("\nDone. These numbers are only meaningful against a dataset shaped like production - " +
  "use scripts/performance/generate-synthetic-data.mjs against an isolated project first.");
