import test from"node:test";
import assert from"node:assert/strict";
import{readFile}from"node:fs/promises";
const root=new URL("../",import.meta.url);
test("structured Resume migration uses one protected atomic RPC on the resumes row",async()=>{const sql=await readFile(new URL("supabase/migrations/202607310031_v0_9_1_structured_resume_editor.sql",root),"utf8");assert.match(sql,/update_resume_structured_content_v091/);assert.match(sql,/perform public\.assert_application_manager\(\)/);assert.match(sql,/update public\.resumes set structured_content=/);assert.match(sql,/revoke all on function public\.update_resume_structured_content_v091/);assert.doesNotMatch(sql,/create table/i);});
test("dashboard exposes add remove reorder and atomic save controls",async()=>{const source=await readFile(new URL("dashboard/src/features/candidates/structured-resume-editor.jsx",root),"utf8");for(const text of["Add experience","Add education","Add certification","Move up","Move down","Remove","Save Structured Resume","updateResumeStructuredContent"])assert.match(source,new RegExp(text));});
