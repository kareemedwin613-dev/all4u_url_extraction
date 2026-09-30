import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const sql = read("../supabase/migrations/202609291300_v3_134_resume_attachment_outcomes.sql");

test("v3.134 stores only privacy-safe attachment outcome columns with strict checks", () => {
  for (const column of ["resume_attach_status", "resume_attach_code", "resume_attach_adapter_id", "resume_attach_frame_domain", "resume_attach_embedded", "resume_attach_attempts", "resume_attach_recorded_at"]) {
    assert.match(sql, new RegExp(`add column ${column} `));
  }
  assert.match(sql, /resume_attach_status in \('ATTACHED','MANUAL_REQUIRED','UNSUPPORTED','FAILED'\)/);
  assert.match(sql, /resume_attach_code ~ '\^\[A-Z\]\[A-Z0-9_\]\{0,79\}\$'/);
  assert.doesNotMatch(sql, /add column [a-z_]*(filename|url|bytes|token|value)/i);
});

test("v3.134 recording is owner-scoped, session-bound, validated, and closed to anonymous callers", () => {
  const record = sql.slice(sql.indexOf("function public.record_application_resume_attachment_v134"), sql.indexOf("function public.get_resume_attachment_report_v134"));
  assert.match(record, /security definer/);
  assert.match(record, /where id = p_session_id and user_id = v_actor\s+for update/);
  assert.match(record, /v_session\.action not in \('LOAD_RESUME','AUTOFILL'\)/);
  assert.match(record, /v_session\.status in \('CANCELLED','FAILED','EXPIRED'\)/);
  assert.match(record, /application_actor_can_view/);
  assert.match(record, /resume_attach_attempts = resume_attach_attempts \+ 1/);
  assert.match(sql, /revoke all on function public\.record_application_resume_attachment_v134\(uuid,text,text,text,text,text,boolean\) from public, anon/);
});

test("v3.134 report is limited to Applying Managers and Admins and groups by job site", () => {
  const report = sql.slice(sql.indexOf("function public.get_resume_attachment_report_v134"));
  assert.match(report, /has_role\('APPLYING_MANAGER', v_actor\) or public\.has_role\('ADMIN', v_actor\)/);
  assert.match(report, /least\(coalesce\(p_days, 30\), 90\)/);
  assert.match(report, /group by s\.target_domain, s\.resume_attach_frame_domain, s\.resume_attach_adapter_id/);
  assert.match(report, /failure_codes/);
  assert.match(sql, /revoke all on function public\.get_resume_attachment_report_v134\(integer\) from public, anon/);
});

test("extension records every attachment attempt without blocking the Applier", () => {
  const app = read("../extension/sidepanel/App.jsx"), service = read("../extension/services/application-service.js"), worker = read("../extension/background/service-worker.js");
  assert.match(service, /\/api\/v1\/extension-sessions\/\$\{sessionId\}\/resume-attachment`,\{method:"PATCH",body:outcome\}/);
  assert.match(worker, /frameDomain:new URL\(frame\.result\.origin\)\.hostname/);
  assert.match(app, /recordApplicationResumeAttachment\(client, baseUrl, sessionData\.id, outcome\)\.catch\(\(\) => \{\}\)/);
  // One-click, Autofill success, Autofill failure, manual retry, retry failure, and a LOAD_RESUME session failure.
  assert.equal(app.match(/recordResumeAttachment\(client, backendBaseUrl/g)?.length, 6);
  assert.match(app, /Record before the session becomes FAILED/);
  const outcome = app.slice(app.indexOf("function resumeAttachmentOutcome"), app.indexOf("function recordResumeAttachment"));
  assert.doesNotMatch(outcome, /filename|signedUrl|message:/, "no filename, URL, or free-text message leaves the extension");
});

test("extension build is versioned 1.8.0", () => {
  assert.equal(JSON.parse(read("../extension/manifest.json")).version, "1.8.0");
  assert.match(read("../scripts/build.mjs"), /manifest\.version!=="1\.8\.0"/);
});
