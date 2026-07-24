import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const migration=new URL("../supabase/migrations/202607240012_fix_applier_progress_updates.sql",import.meta.url);

test("Applier progress migration accepts null protected fields and preserves managed values",async()=>{const sql=await readFile(migration,"utf8");assert.match(sql,/p_priority is not null or p_due_at is not null or p_applied_at is not null or p_notes is not null/i);assert.match(sql,/case when v_manager then v_priority else priority end/i);assert.match(sql,/case when v_manager then p_due_at else due_at end/i);assert.match(sql,/Appliers can change only status and URL/i);assert.doesNotMatch(sql,/service.role/i);});
