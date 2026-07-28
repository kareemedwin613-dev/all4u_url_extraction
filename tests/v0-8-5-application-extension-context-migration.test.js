import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql=(await readFile(new URL("../supabase/migrations/202607280022_v0_8_5_application_extension_context.sql",import.meta.url),"utf8")).toLowerCase();

test("v0.8.5 creates short-lived auditable Application extension sessions",()=>{
  assert.match(sql,/create table public\.application_extension_sessions/);
  assert.match(sql,/action in \('load_resume','autofill'\)/);
  assert.match(sql,/interval '15 minutes'/);
  assert.match(sql,/references public\.applications\(id\)/);
  assert.match(sql,/references auth\.users\(id\)/);
  for(const index of ["application_extension_sessions_user_created_idx","application_extension_sessions_application_created_idx","application_extension_sessions_active_expiry_idx"])assert.match(sql,new RegExp(`create index ${index}`));
});

test("context is Application-authorized and excludes Resume bytes and Storage locations",()=>{
  const context=sql.slice(sql.indexOf("get_application_extension_context_v085"),sql.indexOf("create_application_extension_session_v085"));
  assert.match(context,/application_actor_can_view\(a\.assigned_to\)/);
  for(const field of ["applicationnumber","company","jobtitle","sourceurl","displayname","resumename","originalfilename","mimetype","filesizebytes"])assert.match(context,new RegExp(`'${field}'`));
  assert.doesNotMatch(context,/storage_path|storage_bucket|resume_text|signedurl|access_token|refresh_token/);
  assert.match(context,/'profileavailable', false/);
});

test("extension session writes are RPC-only and RLS protected",()=>{
  assert.match(sql,/alter table public\.application_extension_sessions enable row level security/);
  assert.match(sql,/users read own authorized extension sessions/);
  assert.match(sql,/user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql,/revoke insert, update, delete on public\.application_extension_sessions from authenticated/);
  for(const fn of ["get_application_extension_context_v085(uuid)","create_application_extension_session_v085(uuid,text,text)","update_application_extension_session_v085(uuid,text,text)"])assert.ok(sql.includes(`grant execute on function public.${fn} to authenticated`));
  assert.doesNotMatch(sql,/service_role/);
});
