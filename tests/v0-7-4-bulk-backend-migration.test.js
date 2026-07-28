import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration=await readFile(new URL("../supabase/migrations/202607270020_v0_7_4_bulk_backend_api.sql",import.meta.url),"utf8");
test("v0.7.4 adds durable actor-scoped idempotency without weakening RLS",()=>{
  assert.match(migration,/unique index application_creation_batches_actor_idempotency_uidx/i);
  assert.match(migration,/pg_advisory_xact_lock/i);assert.match(migration,/IDEMPOTENCY_CONFLICT/i);
  assert.match(migration,/perform public\.assert_application_manager\(\)/i);
});
test("v0.7.4 batch reads are bounded, filtered, and authenticated-only",()=>{
  assert.match(migration,/list_application_batch_results_v074/i);assert.match(migration,/least\(greatest\(coalesce\(p_limit,25\),1\),100\)/i);
  assert.match(migration,/get_application_batch_summary_v074/i);
  assert.match(migration,/revoke all on function public\.list_application_batch_results_v074[\s\S]*from public,anon/i);
  assert.match(migration,/grant execute on function public\.list_application_batch_results_v074[\s\S]*to authenticated/i);
});
