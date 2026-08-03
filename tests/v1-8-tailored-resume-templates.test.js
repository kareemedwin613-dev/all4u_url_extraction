import test from"node:test";
import assert from"node:assert/strict";
import fs from"node:fs";
const read=path=>fs.readFileSync(new URL(path,import.meta.url),"utf8");

test("v1.8 migration audits an allowlisted template on jobs and tailored Resumes",()=>{
  const sql=read("../supabase/migrations/202608030046_v1_8_tailored_resume_templates.sql");
  for(const column of["render_template_key","template_selected_by","template_selected_at"])assert.match(sql,new RegExp(`add column ${column}`));
  for(const key of["CLASSIC_V1","MODERN_V1","COMPACT_V1"])assert.match(sql,new RegExp(key));
  assert.match(sql,/status<>'APPROVED'/);
  assert.match(sql,/updated_at is distinct from p_expected_updated_at/);
  assert.match(sql,/application_actor_can_manage|assert_application_manager/);
  assert.match(sql,/revoke all on function public\.begin_tailoring_materialization_v16_pre_v18\(uuid\) from public,anon,authenticated/);
  assert.match(sql,/update public\.resumes set render_template_key=coalesce\(v_key,'CLASSIC_V1'\)/);
});

test("v1.8 UI loads server-owned templates and records selection before materialization",()=>{
  const page=read("../dashboard/src/features/tailoring/tailoring-pages.jsx"),service=read("../dashboard/src/features/tailoring/tailoring-service.js"),controller=read("../apps/api/src/platform/platform.controller.ts");
  assert.match(page,/Resume template/);
  assert.match(page,/selectTailoringTemplate/);
  assert.match(page,/render_template_key/);
  assert.match(service,/\/api\/v1\/tailoring-jobs\/templates/);
  assert.match(service,/\/template`/);
  assert.match(controller,/@Get\("templates"\).*RequireRoles\("APPLYING_MANAGER","ADMIN"\)/s);
  assert.match(controller,/@Patch\(":id\/template"\).*SelectTailoringTemplateDto/s);
});
