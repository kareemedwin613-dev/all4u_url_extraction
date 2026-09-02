import assert from"node:assert/strict";
import{readFileSync}from"node:fs";
import test from"node:test";

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");

test("v3.35 makes PDF the database default and rejects new DOCX materialization",()=>{
  const sql=read("supabase/migrations/202609010112_v3_35_pdf_only_tailored_resumes.sql");
  assert.match(sql,/alter column render_format set default 'PDF'/);
  assert.match(sql,/v_format<>'PDF'/);
  assert.match(sql,/v_job\.render_format<>'PDF'/);
  assert.match(sql,/application\/pdf/);
  assert.match(sql,/completed historical DOCX artifacts remain unchanged/i);
});

test("every automatic submission reserves PDF before materialization",()=>{
  const sql=read("supabase/migrations/202609010111_v3_34_automatic_tailoring_materialization.sql");
  assert.equal((sql.match(/render_format='PDF'/g)||[]).length,3);
  assert.equal((sql.match(/format_selected_at=v_now/g)||[]).length,3);
});

test("API and dashboard expose PDF-only creation",()=>{
  const materializer=read("apps/api/src/platform/tailored-resume-materializer.ts"),dto=read("apps/api/src/platform/platform.dto.ts"),page=read("dashboard/src/features/tailoring/tailoring-pages.jsx");
  assert.match(materializer,/renderFormat!=="PDF"/);
  assert.match(materializer,/renderTailoredResumePdf/);
  assert.doesNotMatch(materializer,/renderTailoredResumeDocx/);
  assert.match(dto,/@IsIn\(\["PDF"\]\)renderFormat!:"PDF"/);
  assert.match(page,/Output Format/);
  assert.doesNotMatch(page,/value:"DOCX"/);
});
