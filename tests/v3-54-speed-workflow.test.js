import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { clearLookupCaches, loadCachedLookup } from "../extension/services/lookup-cache.js";

const read=(path)=>readFile(new URL(path,import.meta.url),"utf8");

test("speed workflow enables Fluid Compute and deploys atomic capture before API use",async()=>{
  const [vercel,migration,service]=await Promise.all([
    read("../vercel.json"),
    read("../supabase/migrations/202609021117_v3_53_atomic_job_capture.sql"),
    read("../apps/api/src/extension-ingestion/job-description.service.ts"),
  ]);
  assert.equal(JSON.parse(vercel).fluid,true);
  assert.match(migration,/capture_job_description_v353/);
  assert.match(migration,/pg_advisory_xact_lock/);
  assert.match(migration,/job_descriptions_user_identity_ci_idx/);
  assert.match(migration,/grant execute[\s\S]*to authenticated/);
  assert.match(service,/client\.rpc\("capture_job_description_v353"/);
  assert.match(service,/missingAtomic/);
  assert.doesNotMatch(service,/workspaceSync|GoogleWorkspace/);
});

test("retired Workspace mirroring is removed from capture and dropped by migration",async()=>{
  const[removal,module,controller,contract,extension]=await Promise.all([
    read("../supabase/migrations/202609021119_v3_55_remove_google_workspace_mirror.sql"),
    read("../apps/api/src/extension-ingestion/extension-ingestion.module.ts"),
    read("../apps/api/src/extension-ingestion/job-description.controller.ts"),
    read("../packages/contracts/src/index.ts"),
    read("../extension/services/job-service.js"),
  ]);
  assert.match(removal,/drop function if exists public\.begin_google_workspace_jd_sync/);
  assert.match(removal,/drop table if exists public\.job_description_workspace_syncs/);
  assert.doesNotMatch(`${module}${controller}${contract}${extension}`,/GoogleWorkspace|workspaceSync|workspace_sync/);
});

test("tailoring pages use Realtime updates with a slow visibility-aware fallback",async()=>{
  const [migration,hook,pages,batches]=await Promise.all([
    read("../supabase/migrations/202609021118_v3_54_tailoring_realtime.sql"),
    read("../dashboard/src/shared/use-realtime-refresh.js"),
    read("../dashboard/src/features/tailoring/tailoring-pages.jsx"),
    read("../dashboard/src/features/tailoring/tailoring-batch-pages.jsx"),
  ]);
  assert.match(migration,/supabase_realtime add table public\.tailoring_jobs/);
  assert.match(migration,/supabase_realtime add table public\.tailoring_batches/);
  assert.match(hook,/postgres_changes/);
  assert.match(hook,/FALLBACK_REFRESH_MS = 30_000/);
  assert.match(hook,/visibilityState === "hidden"/);
  assert.match(pages,/table:"tailoring_jobs"/);
  assert.match(batches,/table:"tailoring_batches"/);
  assert.doesNotMatch(`${pages}${batches}`,/setInterval\([^)]*,4000\)/);
});

test("tailoring batches use bounded concurrency and the load test covers new hot paths",async()=>{
  const[runner,concurrency,loadtest,packageJson]=await Promise.all([
    read("../apps/tailoring-worker/src/cli.ts"),
    read("../apps/tailoring-worker/src/concurrency.ts"),
    read("../scripts/performance/loadtest.mjs"),
    read("../package.json"),
  ]);
  assert.match(concurrency,/TAILORING_BATCH_CONCURRENCY\|\|"2"/);
  assert.match(concurrency,/\^\[1-3\]\$/);
  assert.match(runner,/new Set<Promise<void>>/);
  assert.match(runner,/Promise\.race\(active\)/);
  assert.match(loadtest,/Atomic duplicate JD capture/);
  assert.match(loadtest,/p95-budget-ms/);
  assert.equal(JSON.parse(packageJson).scripts["test:load"],"node scripts/performance/loadtest.mjs");
});

test("extension lookups can return a project-scoped persistent cache without a network read",async()=>{
  const values={},storage={
    get:async(key)=>key===null?{...values}:{[key]:values[key]},
    set:async(next)=>Object.assign(values,next),
    remove:async(keys)=>{for(const key of Array.isArray(keys)?keys:[keys])delete values[key];},
  };
  globalThis.chrome={storage:{local:storage}};
  const key="lookup-cache-v1:project.supabase.co:persisted-test";
  values[key]={storedAt:Date.now(),rows:[{id:"cached"}]};
  try{
    const rows=await loadCachedLookup({supabaseUrl:"https://project.supabase.co"},"persisted-test",async()=>{throw new Error("network should not run");});
    assert.deepEqual(rows,[{id:"cached"}]);
    await clearLookupCaches(storage);assert.equal(values[key],undefined);
  }finally{delete globalThis.chrome;}
});
