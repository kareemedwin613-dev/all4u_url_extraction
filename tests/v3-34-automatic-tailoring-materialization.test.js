import test from"node:test";
import assert from"node:assert/strict";
import{readFile}from"node:fs/promises";

const migration=await readFile(new URL("../supabase/migrations/202609010111_v3_34_automatic_tailoring_materialization.sql",import.meta.url),"utf8");
const service=await readFile(new URL("../apps/api/src/platform/platform.service.ts",import.meta.url),"utf8");
const batchService=await readFile(new URL("../apps/api/src/platform/tailoring-batch.service.ts",import.meta.url),"utf8");
const worker=await readFile(new URL("../apps/tailoring-worker/src/cli.ts",import.meta.url),"utf8");
const batches=await readFile(new URL("../dashboard/src/features/tailoring/tailoring-batch-pages.jsx",import.meta.url),"utf8");

test("v3.34 automatically approves structurally valid previews in every submission mode",()=>{
  for(const name of["submit_tailoring_preview_v13","submit_tailoring_runner_preview_v15","submit_tailoring_batch_preview_v21"]){
    const fn=migration.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?end\\$\\$;`,"i"))?.[0]||"";
    assert.match(fn,/perform public\.assert_tailoring_preview_v14/);
    assert.match(fn,/status='APPROVED'/);
    assert.match(fn,/automatic_materialization=true/);
    assert.match(fn,/random_tailored_resume_template_v34/);
  }
});

test("v3.34 random selection includes every supported template",()=>{
  for(const key of["CLASSIC_V1","MODERN_V1","COMPACT_V1","EXECUTIVE_V1","TECHNICAL_V1","MINIMAL_V1","CORPORATE_V1","ELEGANT_V1","SLATE_V1","EMERALD_V1","ACADEMIC_V1","IMPACT_V1"])assert.match(migration,new RegExp(key));
  assert.match(migration,/1\+floor\(random\(\)\*12\)/);
});

test("single and batch ticket capabilities render, upload, finalize, and retain retry recovery",()=>{
  assert.match(service,/submit_tailoring_runner_preview_v15[\s\S]*begin_tailoring_runner_materialization_v34[\s\S]*finalize_tailoring_runner_materialization_v34/);
  assert.match(batchService,/submit_tailoring_batch_preview_v21[\s\S]*begin_tailoring_batch_materialization_v34[\s\S]*finalize_tailoring_batch_materialization_v34/);
  assert.match(migration,/runner automatically materializes tailored resumes/);
  assert.match(migration,/status='COMPLETED'[\s\S]*completed_count/);
  assert.match(migration,/fail_tailoring_batch_materialization_v34[\s\S]*retryable=true/);
});

test("operator-facing workflow describes created Resumes instead of per-item review",()=>{
  assert.match(worker,/automatically created with/);
  assert.doesNotMatch(worker,/saved for review/);
  assert.match(batches,/Resumes Created/);
  assert.match(batches,/completed_count/);
});
