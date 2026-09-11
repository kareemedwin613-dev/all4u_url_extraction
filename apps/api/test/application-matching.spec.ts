import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { BulkCreateDto, BulkPreviewDto, RequestApplicationMatchesDto } from "../src/application-batches/application-batches.dto.js";
import { CreateApplicationDto, ResumeOptionsQueryDto } from "../src/applications/application.dto.js";
import { ApplicationService } from "../src/applications/application.service.js";
import { ApplicationController } from "../src/applications/application.controller.js";
import { REQUIRED_ROLES } from "../src/auth/require-roles.decorator.js";
import { ApplicationBatchesService } from "../src/application-batches/application-batches.service.js";
import { ApplicationBatchesRepository } from "../src/application-batches/application-batches.repository.js";
const jd="123e4567-e89b-42d3-a456-426614174000",resume="223e4567-e89b-42d3-a456-426614174000",user={id:"user",token:"jwt",claims:{}};
const pair={jobDescriptionId:jd,resumeId:resume};

test("Application score comparison reads and requests are caller-scoped and separate from creation", async () => {
  const calls: any[]=[];
  const service=new ApplicationService({forUser:(token:string)=>{assert.equal(token,"jwt");return{rpc:async(name:string,args:any)=>{calls.push({name,args});return{data:{original:{score:80},tailored:{score:90}},error:null};}};}} as any);
  assert.equal((await service.matchComparison(user as any,jd)).original.score,80);
  await service.requestMatchComparison(user as any,jd);
  assert.deepEqual(calls,[{name:"get_application_match_comparison_v378",args:{p_application_id:jd}},{name:"request_application_match_comparison_v378",args:{p_application_id:jd}}]);
});

test("comparison endpoints allow authorized Application viewers to read but only managers to queue scoring", () => {
  assert.ok(Reflect.getMetadata(REQUIRED_ROLES, ApplicationController.prototype.matchComparison).includes("APPLIER"));
  assert.deepEqual(Reflect.getMetadata(REQUIRED_ROLES, ApplicationController.prototype.requestMatchComparison),["APPLYING_MANAGER","ADMIN"]);
});

test("matching choice DTOs permit SCORE/CATEGORY only and never accept per-pair overrides", async () => {
  const options = { whitelist: true, forbidNonWhitelisted: true };
  const cases: [any, any][] = [[BulkPreviewDto, { jobDescriptionIds: [jd] }], [BulkCreateDto, { combinations: [pair] }],
    [CreateApplicationDto, { ...pair, priority: "NORMAL" }], [ResumeOptionsQueryDto, { jobDescriptionId: jd }]];
  for (const [type, base] of cases) {
    for (const matchingMode of [undefined, "SCORE", "CATEGORY"]) assert.equal((await validate(plainToInstance(type, { ...base, matchingMode }), options)).length, 0);
    for (const matchingMode of ["ANY", "category", true, 100, {}]) assert.ok((await validate(plainToInstance(type, { ...base, matchingMode }), options)).length);
  }
  assert.ok((await validate(plainToInstance(BulkCreateDto, { combinations: [{ ...pair, matchingMode: "CATEGORY" }] }), options)).length);
  assert.ok((await validate(plainToInstance(RequestApplicationMatchesDto, { combinations: [pair], matchingMode: "CATEGORY" }), options)).length);
});

test("matching choice routes preview and create without enqueuing AI; retry hashes include the method", async () => {
  const calls: any[] = [];
  const service = new ApplicationBatchesService({ rpc: async (_u: any, name: string, args: any) => {
    calls.push({ name, args }); return { combinations: [], matchingMode: name.includes("category") ? "CATEGORY" : "SCORE", createdCount: 1 };
  } } as any, { log: () => {} } as any);
  const preview = await service.preview(user as any, { jobDescriptionIds: [jd], matchingMode: "CATEGORY" }, "req");
  assert.equal(preview.matchingMode, "CATEGORY");
  assert.equal(calls[0].name, "preview_category_application_matches_v377");
  const created = await service.create(user as any, { combinations: [pair], matchingMode: "CATEGORY" }, "retry-key", "req");
  assert.equal(created.matchingMode, "CATEGORY");
  assert.equal(calls[1].name, "create_category_applications_bulk_api_v377");
  await service.create(user as any, { combinations: [pair], matchingMode: "SCORE" }, "retry-key", "req");
  await service.create(user as any, { combinations: [pair] }, "retry-key", "req");
  assert.equal(calls[2].name, "create_applications_bulk_api");
  assert.notEqual(calls[1].args.p_request_hash, calls[2].args.p_request_hash);
  assert.equal(calls[2].args.p_request_hash, calls[3].args.p_request_hash);
  assert.ok(calls.every(call => !call.name.includes("request_application_matches")));
});

test("single creation and Resume options use the same selected method with caller-scoped RPCs", async () => {
  const calls: any[] = [];
  const service = new ApplicationService({ forUser: (token: string) => { assert.equal(token, "jwt"); return {
    rpc: async (name: string, args: any) => { calls.push({ name, args }); return { data: [], error: null }; },
  }; } } as any);
  await service.resumes(user as any, jd, "", "CATEGORY");
  await service.create(user as any, { ...pair, priority: "HIGH", matchingMode: "CATEGORY", assignedTo: resume });
  await service.resumes(user as any, jd);
  await service.create(user as any, { ...pair, priority: "NORMAL" });
  assert.deepEqual(calls.map(call => call.name), ["list_category_application_resumes_v377", "create_category_application_v377", "list_application_resumes", "create_application"]);
  assert.equal(calls[1].args.p_assigned_to, resume);
  assert.equal(calls[1].args.p_priority, "HIGH");
  assert.equal(calls[1].args.p_resume_id, resume);
});

test("matching DTOs reject score injection, invalid UUIDs, and excessive pairs",async()=>{
  const options={whitelist:true,forbidNonWhitelisted:true};
  assert.equal((await validate(plainToInstance(RequestApplicationMatchesDto,{combinations:[pair]}),options)).length,0);
  for(const value of [{combinations:[]},{combinations:[{...pair,score:100}]},{combinations:[{...pair,resumeId:"bad"}]},{combinations:[pair],retryFailed:"yes"},{combinations:Array(5001).fill(pair)}]) {
    assert.ok((await validate(plainToInstance(RequestApplicationMatchesDto,value),options)).length);
  }
  assert.equal((await validate(plainToInstance(BulkPreviewDto,{jobDescriptionIds:[jd],resumeIds:[]}))).length,0);
  assert.ok((await validate(plainToInstance(BulkPreviewDto,{jobDescriptionIds:[jd],resumeIds:["bad"]}))).length);
});
test("matching service deduplicates enqueue and preserves excluded/duplicate distinctions",async()=>{
  const calls:any[]=[];
  const repository={rpc:async(_u:any,name:string,args:any)=>{calls.push({name,args});return {activeResumeCount:10,combinations:[
    {resumeId:resume,resumeType:"ORIGINAL",eligible:false,exclusionCode:"BELOW_THRESHOLD",matchScore:69},
    {resumeId:"other",resumeType:"ORIGINAL",eligible:false,exclusionCode:"EXISTING_APPLICATION"},
    {resumeId:"tailored",resumeType:"TAILORED",eligible:true},
  ]};}};
  const service=new ApplicationBatchesService(repository as any,{log:()=>{}} as any);
  await service.requestMatches(user as any,{combinations:[pair,pair],retryFailed:true});
  assert.deepEqual(calls[0],{name:"request_application_matches_with_ticket",args:{p_combinations:[{job_description_id:jd,resume_id:resume}],p_retry_failed:true}});
  const preview=await service.preview(user as any,{jobDescriptionIds:[jd,jd],resumeIds:[resume,resume]},"test");
  assert.deepEqual(calls[1].args,{p_selected_jd_ids:[jd],p_resume_ids:[resume]});
  assert.equal(preview.duplicateCount,1);assert.equal(preview.eligibleCount,0);assert.equal(preview.combinations.length,2);
  assert.equal(preview.activeResumeCount,10);assert.equal(preview.combinations[0].matchScore,69);
});
test("missing matching migration, configuration and role failures are actionable",async()=>{
  for(const [dbError,expected] of [[{code:"PGRST202"},"DATABASE_MIGRATION_REQUIRED"],[{message:"MATCHING_NOT_CONFIGURED: setup"},"MATCHING_NOT_CONFIGURED"],[{code:"42501"},"FORBIDDEN"]] as const) {
    const repository=new ApplicationBatchesRepository({forUser:()=>({rpc:async()=>({error:dbError})})} as any);
    await assert.rejects(()=>repository.rpc(user as any,"request_application_matches",{},"fallback"),(error:any)=>error.code===expected);
  }
});

test("preview database failures distinguish timeouts, connection failures and SQL errors without exposing SQL", async () => {
  const cases = [
    ["57014", "DATABASE_TIMEOUT", 504], ["55P03", "DATABASE_TIMEOUT", 504], ["PGRST003", "DATABASE_TIMEOUT", 504],
    ["08006", "DATABASE_UNAVAILABLE", 503], ["PGRST001", "DATABASE_UNAVAILABLE", 503], ["53300", "DATABASE_UNAVAILABLE", 503],
    ["", "DATABASE_UNAVAILABLE", 503], ["22023", "DATABASE_ERROR", 502],
  ] as const;
  for (const [code, expected, status] of cases) {
    const repository = new ApplicationBatchesRepository({ forUser: () => ({ rpc: async () => ({ error: {
      code, message: code ? "private SQL and resume content" : "TypeError: fetch failed", details: "private data", hint: "private hint",
    } }) }) } as any);
    await assert.rejects(() => repository.rpc(user as any, "preview_application_matches", {}, "Preview failed"), (error: any) => {
      assert.equal(error.code, expected); assert.equal(error.getStatus(), status);
      assert.deepEqual(error.details, { databaseCode: code || "UNKNOWN" });
      assert.doesNotMatch(JSON.stringify(error), /private|migration/i);
      return true;
    });
  }
});

test("preview failure log correlates request, RPC, database code and duration without tokens or source data", async () => {
  const logs: any[] = [];
  const repository = new ApplicationBatchesRepository({ forUser: () => ({ rpc: async () => ({ error: {
    code: "57014", message: "private SQL/source details", details: "private data",
  } }) }) } as any);
  const service = new ApplicationBatchesService(repository, { log: (event: string, context: any) => logs.push({ event, ...context }) } as any);
  await assert.rejects(() => service.preview(user as any, { jobDescriptionIds: [jd], matchingMode: "SCORE" }, "req_preview_error"), (error: any) => error.code === "DATABASE_TIMEOUT");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].event, "bulk.preview.failed");
  assert.equal(logs[0].requestId, "req_preview_error");
  assert.equal(logs[0].rpc, "preview_application_matches");
  assert.equal(logs[0].matchingMode, "SCORE");
  assert.equal(logs[0].databaseCode, "57014");
  assert.equal(logs[0].code, "DATABASE_TIMEOUT");
  assert.ok(logs[0].durationMs >= 0);
  assert.doesNotMatch(JSON.stringify(logs), /private|jwt|token|jobDescriptionIds/);
});
