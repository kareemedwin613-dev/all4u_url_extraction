import assert from"node:assert/strict";
import{readFileSync}from"node:fs";
import test from"node:test";
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");

test("v1.9 migration constrains and audits DOCX/PDF without public mutation access",()=>{
  const sql=read("supabase/migrations/202608030047_v1_9_tailored_resume_pdf.sql");
  assert.match(sql,/render_format in\('DOCX','PDF'\)/);
  assert.match(sql,/select_tailoring_format_v19/);
  assert.match(sql,/begin_tailoring_materialization_v19/);
  assert.match(sql,/finalize_tailoring_materialization_v19/);
  assert.match(sql,/p_mime_type is distinct from v_expected_mime/);
  assert.match(sql,/lower\(t\.render_format\)/);
  assert.match(sql,/revoke execute on function public\.begin_tailoring_materialization_v16\(uuid\) from authenticated/);
  assert.match(sql,/revoke execute on function public\.finalize_tailoring_materialization_v16[^;]+from authenticated/);
  assert.match(sql,/revoke all on function public\.finalize_tailoring_materialization_v19[^;]+from public,anon/);
  assert.doesNotMatch(sql,/grant execute[^;]+to anon/);
});

test("dashboard fixes all new materialization to PDF while retaining the protected endpoint",()=>{
  const page=read("dashboard/src/features/tailoring/tailoring-pages.jsx"),service=read("dashboard/src/features/tailoring/tailoring-service.js"),api=read("apps/api/src/platform/platform.controller.ts");
  assert.match(page,/Output Format/);
  assert.match(page,/clean private PDF/);
  assert.doesNotMatch(page,/selectTailoringFormat/);
  assert.doesNotMatch(page,/value:"DOCX"/);
  assert.match(service,/\/format/);
  assert.match(api,/@Patch\(":id\/format"\)/);
  assert.match(api,/"APPLYING_MANAGER","ADMIN"/);
});
