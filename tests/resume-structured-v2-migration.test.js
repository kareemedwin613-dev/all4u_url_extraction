import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const migration=new URL("../supabase/migrations/202607240011_resume_structured_schema_v2.sql",import.meta.url);

test("Resume structured schema v2 migration preserves v1 compatibility",async()=>{const sql=await readFile(migration,"utf8");assert.match(sql,/structured_schema_version in \(1, 2\)/i);assert.match(sql,/professional_experience/i);assert.doesNotMatch(sql,/service.role/i);});
