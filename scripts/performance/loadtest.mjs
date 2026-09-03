// Reproducible, non-production-by-default load test for the list RPCs/queries touched by v0.7.1.
//
// SAFETY: never reads dashboard/.env.local or extension config, and never defaults to any URL -
// you must pass --url/--key (or set LOADTEST_SUPABASE_URL/LOADTEST_SUPABASE_KEY) explicitly every
// time. This is deliberate friction: it should never be possible to "accidentally" load test
// whatever project happens to be configured for real use, let alone production.
//
// Usage:
//   node scripts/performance/loadtest.mjs --url=https://xxxx.supabase.co --key=<anon-or-service-key> \
//     --email=<test-user-email> --password=<test-user-password> --concurrency=10 --requests=50 \
//     --capture-job-id=<test-user-owned-jd> --p95-budget-ms=750
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
const p95BudgetMs = args["p95-budget-ms"] == null ? null : Math.max(1, Number(args["p95-budget-ms"]));

console.log(`Target: ${new URL(url).host}`);
console.log(`Concurrency: ${concurrency}, requests per scenario: ${requestsPerScenario}`);

const client = createClient(url, key, { auth: { persistSession: false } });

let authenticatedUser = null;
if (args.email && args.password) {
  const { error } = await client.auth.signInWithPassword({ email: args.email, password: args.password });
  if (error) {
    console.error(`Sign-in failed: ${error.message}`);
    process.exit(1);
  }
  const { data } = await client.auth.getUser();
  authenticatedUser = data.user;
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
  const p95=percentile(durations,95);
  const overBudget=p95BudgetMs!=null&&p95>p95BudgetMs;
  console.log(`${name}: p50=${percentile(durations,50)?.toFixed(0)}ms p95=${p95?.toFixed(0)}ms p99=${percentile(durations,99)?.toFixed(0)}ms failures=${failures}/${requestsPerScenario}${overBudget?` OVER_BUDGET(${p95BudgetMs}ms)`:""}`);
  return{failures,overBudget};
}

const scenarios = [
  ["Applier queue (list_applications_cursor)", () => client.rpc("list_applications_cursor", { p_limit: 25 })],
  ["Manager Application list (list_applications_v07)", () => client.rpc("list_applications_v07", { p_limit: 25, p_offset: 0 })],
  ["JD search (full-text)", () => client.from("job_descriptions").select("id,company,job_title").textSearch("search_vector", "engineer", { type: "websearch", config: "english" }).limit(25)],
  ["Resume search (full-text)", () => client.from("resumes").select("id,candidate_name,resume_name").textSearch("search_vector", "engineer", { type: "websearch", config: "english" }).limit(25)],
  ["Bulk preview (100 JDs)", () => client.rpc("preview_bulk_applications", { p_selected_jd_ids: [] })],
  ["Business overview summary", () => client.rpc("get_business_overview")],
  ["Application counts summary", () => client.rpc("get_application_counts")],
  ["Extension categories", () => client.from("categories").select("id,slug,name,parent_id,sort_order,active").eq("active",true).order("sort_order")],
  ["Extension industry domains", () => client.from("industry_domain_categories").select("id,slug,name,description,sort_order").eq("active",true).order("sort_order").order("name")],
];

if(args["capture-job-id"]){
  if(!authenticatedUser){console.error("Atomic capture benchmark requires --email and --password.");process.exit(1);}
  const{data:record,error}=await client.from("job_descriptions").select("*").eq("id",args["capture-job-id"]).maybeSingle();
  if(error||!record){console.error(`Capture benchmark JD could not be loaded: ${error?.message||"not found"}`);process.exit(1);}
  if(record.user_id!==authenticatedUser.id){console.error("Refusing capture benchmark: --capture-job-id must belong to the signed-in test user.");process.exit(1);}
  if(!record.normalized_source_url){console.error("Refusing capture benchmark: the selected JD has no normalized_source_url.");process.exit(1);}
  scenarios.push(["Atomic duplicate JD capture",()=>client.rpc("capture_job_description_v353",{p_record:record})]);
}

let failed=false;
for (const [name, fn] of scenarios) {
  // eslint-disable-next-line no-await-in-loop
  const result=await runScenario(name, fn);
  failed=failed||result.failures>0||result.overBudget;
}

console.log("\nDone. These numbers are only meaningful against a dataset shaped like production - " +
  "use scripts/performance/generate-synthetic-data.mjs against an isolated project first.");
if(failed){console.error("Load test failed because a scenario returned errors or exceeded the optional p95 budget.");process.exitCode=1;}
