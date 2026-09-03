import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { downloadApplicationResume } from "../extension/services/application-service.js";

const read=(path)=>fs.readFileSync(new URL(path,import.meta.url),"utf8");

test("v1.7 database functions are set-based, Application-scoped, and anonymous-safe",()=>{
  const sql=read("../supabase/migrations/202608030045_v1_7_extension_resume_download.sql");
  assert.match(sql,/create or replace function public\.list_my_applications_v17/);
  assert.match(sql,/a\.assigned_to=auth\.uid\(\)/);
  assert.match(sql,/r\.resume_number,r\.resume_type/);
  assert.match(sql,/create or replace function public\.get_application_resume_download_v17/);
  assert.match(sql,/application_actor_can_view\(a\.assigned_to\)/);
  assert.match(sql,/revoke all on function public\.get_application_resume_download_v17\(uuid\) from public,anon/);
});
test("extension displays Resume identity and downloads through NestJS",()=>{
  const card=read("../extension/sidepanel/components/ApplicationCard.jsx"),view=read("../extension/sidepanel/views/MyApplicationsView.jsx"),service=read("../extension/services/application-service.js"),manifest=JSON.parse(read("../extension/manifest.json"));
  assert.match(card,/Resume #\$\{application\.resume_number\}/);
  assert.match(card,/application-card--tailored/);
  assert.match(card,/application-resume-tag--tailored/);
  assert.match(card,/Download Resume/);
  assert.doesNotMatch(card,/>Load Resume</);
  assert.match(view,/downloadApplicationResume/);
  assert.match(view,/All profiles/);
  assert.match(view,/formatMineResumeOptionLabel/);
  assert.match(view,/data\.resumes/);
  assert.match(view,/resumeId: nextResumeId|resumeId: activeResumeId|resumeId: value/);
  assert.match(service,/resumeId/);
  assert.match(service,/\/api\/v1\/applications\/\$\{encodeURIComponent\(applicationId\)\}\/resume-file-url/);
  assert.ok(manifest.permissions.includes("downloads"));
});

test("My Applications resume options come from the status-scoped API payload",()=>{
  const sql=read("../supabase/migrations/202608310103_v3_43_applier_mine_status_filter.sql");
  const view=read("../extension/sidepanel/views/MyApplicationsView.jsx");
  const service=read("../extension/services/application-service.js");
  const nest=read("../apps/api/src/applications/application.service.ts");
  assert.match(sql,/create or replace function public\.list_my_applications_v20/);
  assert.match(sql,/p_resume_id uuid default null/);
  assert.match(sql,/'resumes', v_resumes/);
  assert.match(sql,/where p_resume_id is null or resume_id = p_resume_id/);
  assert.match(nest,/list_my_applications_v20/);
  assert.match(nest,/p_resume_id:q\.resumeId\|\|null/);
  assert.match(service,/list_my_applications_v20/);
  assert.match(service,/client\.rpc\("list_my_applications_v20"/);
  assert.match(view,/setResumeFilter\(""\)/);
  assert.doesNotMatch(view,/resumesFromItems/);
  assert.doesNotMatch(service,/supportsResumeFilter/);
});

test("My Applications status filter shows only core Applier workflow statuses", () => {
  const view = read("../extension/sidepanel/views/MyApplicationsView.jsx");
  const modal = read("../extension/sidepanel/components/ApplicationStatusModal.jsx");
  const statuses = read("../extension/shared/applier-application-statuses.js");
  for (const label of ["All Statuses", "Assigned", "Applied", "Blocked"]) {
    assert.match(statuses, new RegExp(`label: "${label}"`));
  }
  assert.match(view, /APPLIER_STATUS_FILTER_OPTIONS/);
  assert.match(modal, /APPLIER_STATUS_UPDATE_OPTIONS/);
  for (const label of ["Screening", "Interview Scheduled", "Offer Received", "Rejected", "Withdrawn", "Closed", "Cancelled"]) {
    assert.doesNotMatch(statuses, new RegExp(`label: "${label}"`));
  }
});

test("download validates variant identity and delegates to Chrome download manager",async()=>{
  const originalFetch=globalThis.fetch,requests=[];
  globalThis.fetch=async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify({data:{signedUrl:"https://project.supabase.co/storage/v1/object/sign/tailored-resumes/file",filename:"Andrew Thomas Resume - App 42.pdf",candidateName:"Andrew Thomas",resumeName:"Andrew Thomas Resume",resumeNumber:42,resumeType:"TAILORED",mimeType:"application/pdf",fileSizeBytes:1234,applicationNumber:42}}),{status:200,headers:{"content-type":"application/json"}});};
  try{
    let downloadOptions;
    const result=await downloadApplicationResume({auth:{getSession:async()=>({data:{session:{access_token:"token-value"}},error:null})}},"https://api.example.com","7c0bcc36-feb5-4bf3-872c-aca688def302",async(options)=>{downloadOptions=options;return 7;});
    assert.equal(result.resumeNumber,42);
    assert.equal(downloadOptions.filename,"Andrew Thomas Resume - App 42.pdf");
    assert.equal(downloadOptions.saveAs,true);
    assert.equal(requests.length,1);
    assert.match(requests[0].url,/\/api\/v1\/applications\/7c0bcc36-feb5-4bf3-872c-aca688def302\/resume-file-url$/);
  }finally{globalThis.fetch=originalFetch;}
});
