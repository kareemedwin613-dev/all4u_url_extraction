import test from "node:test";
import assert from "node:assert/strict";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { HttpStatus } from "@nestjs/common";

Object.assign(process.env, {
  NODE_ENV: "test", PORT: "3001", API_BASE_PATH: "api/v1", CORS_ORIGINS: "http://localhost:4173",
  SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_OR_PUBLISHABLE_KEY: "publishable-test-key-with-safe-length",
  SUPABASE_JWT_ISSUER: "https://example.supabase.co/auth/v1", SUPABASE_JWKS_URL: "https://example.supabase.co/auth/v1/.well-known/jwks.json",
  SUPABASE_JWT_AUDIENCE: "authenticated", RATE_LIMIT_TTL_MS: "60000", RATE_LIMIT_MAX: "60", INGESTION_RATE_LIMIT_MAX: "20", LOG_LEVEL: "info", SWAGGER_ENABLED: "true",
});

const { validateEnvironment } = await import("../src/config/environment.js");
const { CreateJobDescriptionDto } = await import("../src/extension-ingestion/create-job-description.dto.js");
const { RequestIdMiddleware } = await import("../src/common/middleware/request-id.middleware.js");
const { AuthGuard } = await import("../src/auth/auth.guard.js");
const { RolesGuard } = await import("../src/auth/roles.guard.js");
const { SupabaseService } = await import("../src/supabase/supabase.service.js");
const { ApiException } = await import("../src/common/errors/api.exception.js");
const { normalizeSourceUrl, JobDescriptionService } = await import("../src/extension-ingestion/job-description.service.js");
const { JobDescriptionController } = await import("../src/extension-ingestion/job-description.controller.js");
const { JsonLogger } = await import("../src/common/logging/json-logger.service.js");
const { JobDescriptionQueryDto } = await import("../src/job-descriptions/job-description-query.dto.js");
const { JobDescriptionReadService } = await import("../src/job-descriptions/job-description-read.service.js");
const { LookupService } = await import("../src/lookups/lookup.service.js");
const { ApplicationService } = await import("../src/applications/application.service.js");
const { PlatformService, TailoringRunnerService, TailoringService } = await import("../src/platform/platform.service.js");

test("environment validation fails fast and rejects privileged keys", () => {
  assert.throws(() => validateEnvironment({} as NodeJS.ProcessEnv), /Invalid API environment/);
  assert.throws(() => validateEnvironment({ ...process.env, SUPABASE_ANON_OR_PUBLISHABLE_KEY: `test-${["service","role"].join("_")}-key-long-value` }), /privileged/);
  assert.throws(() => validateEnvironment({ ...process.env, SUPABASE_URL: "https://https//example.supabase.co" }), /standard/);
  assert.equal(validateEnvironment(process.env).PORT, 3001);
});

test("JD DTO rejects unknown-quality input and accepts bounded ingestion fields", async () => {
  const invalid = plainToInstance(CreateJobDescriptionDto, { sourceUrl: "javascript:alert(1)", company: "", jobTitle: "x", descriptionText: "short", categoryId: "bad" });
  const errors = await validate(invalid);
  assert.ok(errors.some((error) => error.property === "sourceUrl"));
  assert.ok(errors.some((error) => error.property === "descriptionText"));
  const valid = plainToInstance(CreateJobDescriptionDto, { sourceUrl: "https://example.com/jobs/1", company: "Example", jobTitle: "Engineer", descriptionText: "x".repeat(100), categoryId: "123e4567-e89b-42d3-a456-426614174000" });
  assert.equal((await validate(valid)).length, 0);
});

test("JD read query DTO allowlists filters, sorting, and pagination", async () => {
  const valid=plainToInstance(JobDescriptionQueryDto,{search:"data",categoryId:"123e4567-e89b-42d3-a456-426614174000",capturedByUserId:"223e4567-e89b-42d3-a456-426614174000",seniority:"SENIOR",status:"ACTIVE",capturedFrom:"2026-08-01T04:00:00.000Z",capturedTo:"2026-08-08T04:00:00.000Z",sort:"company_asc",page:"2",pageSize:"25"});
  assert.equal((await validate(valid)).length,0);assert.equal(valid.page,2);
  const invalid=plainToInstance(JobDescriptionQueryDto,{sort:"raw_sql",pageSize:"999",capturedFrom:"not-a-date",capturedByUserId:"not-a-user"});
  assert.ok((await validate(invalid)).length>=2);
});

test("JD read query DTO accepts larger Job Descriptions page sizes", async () => {
  for (const pageSize of ["100", "500", "1000"]) {
    const value = plainToInstance(JobDescriptionQueryDto, { status: "ACTIVE", sort: "created_desc", pageSize });
    assert.equal((await validate(value)).length, 0, `pageSize ${pageSize} should be allowed`);
    assert.equal(value.pageSize, Number(pageSize));
  }
});

test("request ID middleware accepts safe IDs and replaces unsafe values", () => {
  const middleware = new RequestIdMiddleware();
  for (const [incoming, expected] of [["request_1234", "request_1234"], ["bad id", null]] as const) {
    const headers: Record<string,string> = {}, request: any = { header: () => incoming }, response: any = { setHeader: (key:string,value:string) => headers[key] = value };
    middleware.use(request, response, () => {});
    if (expected) assert.equal(request.requestId, expected); else assert.match(request.requestId, /^req_/);
    assert.equal(headers["X-Request-ID"], request.requestId);
  }
});

test("auth guard rejects missing tokens and attaches only verified identity", async () => {
  const verifier = { verify: async (token: string) => ({ id: "trusted-user", token, claims: {} }) }, guard = new AuthGuard(verifier as any);
  await assert.rejects(() => guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ header: () => "" }) }) } as any), (error: any) => error.code === "UNAUTHORIZED");
  const request: any = { header: () => "Bearer signed-token" };
  assert.equal(await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as any), true);
  assert.equal(request.user.id, "trusted-user");
});

test("auth guard standardizes invalid and expired token failures", async () => {
  for (const message of ["A valid Supabase access token is required.","Your session has expired."]) {
    const guard=new AuthGuard({verify:async()=>{throw new ApiException("UNAUTHORIZED",message,HttpStatus.UNAUTHORIZED);}} as any);
    await assert.rejects(()=>guard.canActivate({switchToHttp:()=>({getRequest:()=>({header:()=>"Bearer invalid"})})} as any),(error:any)=>error.code==="UNAUTHORIZED"&&error.getStatus()===401);
  }
});

test("structured logger redacts tokens and credentials", () => {
  const output:string[] = [], original=console.log; console.log=(value)=>output.push(String(value));
  try { new JsonLogger().log("safe",{token:"access-token",password:"password",requestId:"req_1"}); } finally { console.log=original; }
  assert.doesNotMatch(output[0],/access-token|"password":"password"/); assert.match(output[0],/\[REDACTED\]/); assert.match(output[0],/req_1/);
});

test("ingestion endpoint has a dedicated rate limit", () => {
  assert.equal(Reflect.getMetadata("THROTTLER:LIMITdefault",JobDescriptionController.prototype.create),20);
});

test("role guard trusts the database RPC and rejects inactive or unauthorized users", async () => {
  const reflector = { getAllAndOverride: () => ["ADMIN"] }, request: any = { user: { id: "u", token: "jwt" } };
  const context: any = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => request }) };
  const make = (data: unknown) => new RolesGuard(reflector as any, { accessContext: async () => ({ data, error: null }) } as any, {warn:()=>{}} as any);
  assert.equal(await make({ status: "ACTIVE", roles: ["ADMIN"] }).canActivate(context), true);
  await assert.rejects(() => make({ status: "INACTIVE", roles: ["ADMIN"] }).canActivate(context), (error: any) => error.code === "FORBIDDEN");
  await assert.rejects(() => make({ status: "ACTIVE", roles: ["APPLIER"] }).canActivate(context), (error: any) => error.code === "FORBIDDEN");
});

test("access context cache deduplicates role checks for the same signed token", async () => {
  const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=(async(_url:any,options:any)=>{calls+=1;assert.match(String(options.headers.Authorization),/^Bearer jwt-/);return new Response(JSON.stringify({status:"ACTIVE",roles:["APPLIER"]}),{status:200,headers:{"content-type":"application/json"}});}) as any;
  try{
    const service=new SupabaseService();
    const [first,second]=await Promise.all([service.accessContext("jwt-one"),service.accessContext("jwt-one")]);
    assert.deepEqual(first,second);assert.equal(calls,1);
    await service.accessContext("jwt-one");assert.equal(calls,1);
    await service.accessContext("jwt-two");assert.equal(calls,2);
  }finally{globalThis.fetch=originalFetch;}
});

test("URL normalization provides the database-backed idempotency key", () => {
  assert.equal(normalizeSourceUrl("https://example.com/jobs/1/?utm_source=x&b=2#a"), "https://example.com/jobs/1?b=2");
});

test("JD read service applies bounded server-side filters and preserves RLS identity", async()=>{
  const calls:any[]=[],row={id:"job",industry_domain:{name:"Healthcare"}};
  const query:any={select:()=>query,textSearch:(...args:any[])=>{calls.push(["textSearch",...args]);return query;},eq:(...args:any[])=>{calls.push(["eq",...args]);return query;},gte:(...args:any[])=>{calls.push(["gte",...args]);return query;},lt:(...args:any[])=>{calls.push(["lt",...args]);return query;},order:(...args:any[])=>{calls.push(["order",...args]);return query;},range:async(...args:any[])=>{calls.push(["range",...args]);return {data:[row],error:null,count:1};}};
  const service=new JobDescriptionReadService({forUser:(token:string)=>{assert.equal(token,"jwt");return {from:(table:string)=>{assert.equal(table,"job_descriptions");return query;}};}} as any);
  const result=await service.list({id:"u",token:"jwt",claims:{}},{search:"data",categoryId:"123e4567-e89b-42d3-a456-426614174000",capturedByUserId:"223e4567-e89b-42d3-a456-426614174000",seniority:"SENIOR",status:"ACTIVE",capturedFrom:"2026-08-01T04:00:00.000Z",capturedTo:"2026-08-08T04:00:00.000Z",sort:"company_asc",page:1,pageSize:25});
  assert.equal(result.items[0].industry_domain,"Healthcare");assert.equal(result.total,1);
  assert.ok(calls.some(call=>call[0]==="textSearch"&&call[1]==="search_vector"));assert.deepEqual(calls.at(-1),["range",0,24]);
  assert.ok(calls.some(call=>call[0]==="gte"&&call[1]==="created_at"));assert.ok(calls.some(call=>call[0]==="lt"&&call[1]==="created_at"));
  assert.ok(calls.some(call=>call[0]==="eq"&&call[1]==="user_id"&&call[2]==="223e4567-e89b-42d3-a456-426614174000"));
});

test("lookup service loads controlled values through the user-scoped client",async()=>{
  const tables:string[]=[],query:any={select:()=>query,eq:()=>query,order:()=>query,then:(resolve:any)=>Promise.resolve({data:[{id:"1"}],error:null}).then(resolve)};
  const service=new LookupService({forUser:(token:string)=>{assert.equal(token,"jwt");return {from:(table:string)=>{tables.push(table);return query;}};}} as any);
  assert.equal((await service.categories({id:"u",token:"jwt",claims:{}}))[0].id,"1");
  assert.equal((await service.industryDomains({id:"u",token:"jwt",claims:{}}))[0].id,"1");
  assert.equal((await service.categories({id:"u",token:"jwt",claims:{}}))[0].id,"1");
  assert.deepEqual(tables,["categories","industry_domain_categories"]);
});

test("Application service forwards only allowlisted RPC arguments with the caller JWT",async()=>{
  let call:any;const service=new ApplicationService({forUser:(token:string)=>{assert.equal(token,"user-jwt");return{rpc:async(name:string,args:any)=>{call={name,args};return{data:{items:[]},error:null};}};}}as any);
  await service.list({id:"user-1",token:"user-jwt",claims:{}},{search:"Acme",status:"IN_PROGRESS",pageSize:25,unexpected:"ignored"});
  assert.equal(call.name,"list_applications_v07");assert.equal(call.args.p_search,"Acme");assert.equal(call.args.p_work_status,"IN_PROGRESS");assert.equal(call.args.p_limit,25);assert.equal(call.args.p_offset,0);assert.equal("unexpected" in call.args,false);
});

test("Application service maps database authorization errors without exposing raw details",async()=>{
  const service=new ApplicationService({forUser:()=>({rpc:async()=>({data:null,error:{code:"42501",message:"secret policy details"}})})}as any);
  await assert.rejects(()=>service.counts({id:"u",token:"jwt",claims:{}},"2026-08-13T04:00:00.000Z","2026-08-14T04:00:00.000Z"),(error:any)=>error.code==="APPLICATION_ACCESS_DENIED"&&error.getStatus()===403&&!error.message.includes("secret"));
});

test("Platform service keeps Admin RPCs on the caller-scoped client",async()=>{
  let call:any;
  const service=new PlatformService({forUser:(token:string)=>{assert.equal(token,"jwt");return{rpc:async(name:string,args:any)=>{call={name,args};return{data:{id:"user",fullName:"Alex"},error:null};}};}}as any);
  await service.status({id:"actor",token:"jwt",claims:{}},"123e4567-e89b-42d3-a456-426614174000","INACTIVE");
  assert.equal(call.name,"admin_set_user_status");
  assert.equal(call.args.p_status,"INACTIVE");
  await service.updateUserProfile({id:"actor",token:"jwt",claims:{}},"123e4567-e89b-42d3-a456-426614174000"," Alex Applier ");
  assert.equal(call.name,"admin_update_user_profile");
  assert.equal(call.args.p_user_id,"123e4567-e89b-42d3-a456-426614174000");
  assert.equal(call.args.p_full_name,"Alex Applier");
});

test("Tailoring creation and legacy recovery review use only protected caller-scoped RPCs",async()=>{const calls:any[]=[];const service=new TailoringService({forUser:(token:string)=>{assert.equal(token,"jwt");return{rpc:async(name:string,args:any)=>{calls.push({name,args});return{data:name==="create_tailoring_jobs_v13"?[{status:"created",resumeId:"223e4567-e89b-42d3-a456-426614174000"}]:{id:"job"},error:null};}};}}as any),user={id:"actor-id",token:"jwt",claims:{}};await service.create(user,{jobDescriptionId:"123e4567-e89b-42d3-a456-426614174000",matches:[{resumeId:"223e4567-e89b-42d3-a456-426614174000",matchScore:80,matchDetails:{}}]});await service.requestApplication(user,"323e4567-e89b-42d3-a456-426614174000");await service.input(user,"423e4567-e89b-42d3-a456-426614174000");await service.ticket(user,"423e4567-e89b-42d3-a456-426614174000");await service.review(user,"423e4567-e89b-42d3-a456-426614174000",{action:"APPROVE",preview:{summary:"x"},notes:"reviewed",expectedUpdatedAt:"2026-08-03T12:00:00.000Z"});await service.reviews(user,"423e4567-e89b-42d3-a456-426614174000");await service.cancel(user,"423e4567-e89b-42d3-a456-426614174000");assert.deepEqual(calls.map(x=>x.name),["create_tailoring_jobs_v13","request_application_tailoring_v13","get_tailoring_job_input_v13","create_tailoring_runner_ticket_v15","review_tailoring_preview_v14","get_tailoring_job_reviews_v14","cancel_tailoring_job_v13"]);assert.equal(calls[0].args.p_matches[0].sourceResumePath,undefined);assert.equal(calls[4].args.p_expected_updated_at,"2026-08-03T12:00:00.000Z");});
test("Tailoring runner automatically materializes PDF through anonymous capability RPCs",async()=>{const calls:any[]=[],started={alreadyMaterialized:false,jobId:"job",applicationNumber:19,materializationToken:"523e4567-e89b-42d3-a456-426614174000",targetBucket:"tailored-resumes",targetPath:"owner/job/resume.pdf",filename:"resume.pdf",renderFormat:"PDF",candidate:{name:"Alex"},sourceStructuredContent:{professional_experience:[{id:"exp-1",company:"Co",job_title:"Engineer",experience_details:"source"}],education:[],certifications:[]},approvedPreview:{summary:"A complete approved summary for the target role.",professionalExperience:[{sourceExperienceId:"exp-1",tailoredDetails:"Delivered measurable improvements for customers and internal teams."}],skills:["SQL"]}};const client={rpc:async(name:string,args:any)=>{calls.push({name,args});return{data:name==="begin_tailoring_runner_materialization_v34"?started:name==="finalize_tailoring_runner_materialization_v34"?{status:"COMPLETED",tailoredResumeNumber:42}:{jobId:"job"},error:null};},storage:{from:()=>({remove:async()=>({data:[],error:null}),upload:async()=>({data:{path:started.targetPath},error:null})})}};const service=new TailoringRunnerService({anonymous:()=>client}as any),ticket=`trt_${"a".repeat(43)}`;await service.claim(ticket);const result:any=await service.preview(ticket,{generatedAt:"2026-08-03T12:00:00Z",result:{summary:"x"}});assert.equal(result.tailoredResumeNumber,42);assert.equal(result.automaticMaterialization,true);assert.deepEqual(calls.map(x=>x.name),["claim_tailoring_runner_ticket_v15","submit_tailoring_runner_preview_v15","begin_tailoring_runner_materialization_v34","finalize_tailoring_runner_materialization_v34"]);assert.ok(calls.every(x=>x.args.p_ticket===ticket));});

test("preview submission automatically approves and materializes PDF through one user-scoped client",async()=>{const calls:any[]=[],uploads:any[]=[],removals:any[]=[];const started={alreadyMaterialized:false,jobId:"423e4567-e89b-42d3-a456-426614174000",applicationId:"323e4567-e89b-42d3-a456-426614174000",applicationNumber:19,materializationToken:"523e4567-e89b-42d3-a456-426614174000",targetBucket:"tailored-resumes",targetPath:"owner/job/resume.pdf",filename:"resume.pdf",renderFormat:"PDF",candidate:{name:"Alex Example",email:"alex@example.com"},sourceStructuredContent:{professional_experience:[{id:"exp-1",company:"Source Co",job_title:"Engineer",experience_details:"source",is_current:true}],education:[],certifications:[]},approvedPreview:{summary:"A sufficiently complete approved summary for a tailored resume artifact.",professionalExperience:[{sourceExperienceId:"exp-1",tailoredDetails:"Delivered supported and measurable engineering improvements for customers."}],skills:["SQL"]}};const service=new TailoringService({forUser:(token:string)=>{assert.equal(token,"jwt");return{rpc:async(name:string,args:any)=>{calls.push({name,args});return{data:name==="begin_tailoring_materialization_v19"?started:{jobId:started.jobId,status:"COMPLETED",tailoredResumeId:"623e4567-e89b-42d3-a456-426614174000",tailoredResumeNumber:42},error:null};},storage:{from:(bucket:string)=>({remove:async(paths:string[])=>{removals.push({bucket,paths});return{data:[],error:null};},upload:async(path:string,bytes:Buffer,options:any)=>{uploads.push({bucket,path,bytes,options});return{data:{path},error:null};}})}};}}as any),user={id:"actor-id",token:"jwt",claims:{}};const result:any=await service.preview(user,started.jobId,{generatedAt:"2026-09-01T12:00:00Z",result:{summary:"x"}});assert.equal(result.tailoredResumeNumber,42);assert.deepEqual(calls.map(x=>x.name),["submit_tailoring_preview_v13","begin_tailoring_materialization_v19","finalize_tailoring_materialization_v19"]);assert.equal(uploads.length,1);assert.equal(uploads[0].bytes.subarray(0,5).toString(),"%PDF-");assert.equal(uploads[0].options.contentType,"application/pdf");assert.equal(uploads[0].options.upsert,false);assert.match(calls[2].args.p_file_sha256,/^[0-9a-f]{64}$/);assert.equal(calls[2].args.p_materialization_token,started.materializationToken);assert.deepEqual(removals,[{bucket:"tailored-resumes",paths:[started.targetPath]}]);});

test("v1.9 upload failure returns the approved PDF job to a retryable state",async()=>{const calls:string[]=[],started={alreadyMaterialized:false,jobId:"423e4567-e89b-42d3-a456-426614174000",applicationNumber:19,materializationToken:"523e4567-e89b-42d3-a456-426614174000",targetBucket:"tailored-resumes",targetPath:"owner/job/resume.pdf",filename:"resume.pdf",renderFormat:"PDF",candidate:{name:"Alex"},sourceStructuredContent:{professional_experience:[{id:"exp-1",company:"Co",job_title:"Engineer",experience_details:"source"}],education:[],certifications:[]},approvedPreview:{summary:"A complete approved summary for the candidate and target role.",professionalExperience:[{sourceExperienceId:"exp-1",tailoredDetails:"A supported professional experience description for this role."}],skills:["SQL"]}};const service=new TailoringService({forUser:()=>({rpc:async(name:string)=>{calls.push(name);return{data:name==="begin_tailoring_materialization_v19"?started:{status:"APPROVED"},error:null};},storage:{from:()=>({remove:async()=>({data:[],error:null}),upload:async()=>({data:null,error:{message:"storage unavailable"}})})}})}as any);await assert.rejects(()=>service.materialize({id:"actor",token:"jwt",claims:{}},started.jobId),error=>error instanceof ApiException&&error.getStatus()===502);assert.deepEqual(calls,["begin_tailoring_materialization_v19","fail_tailoring_materialization_v16"]);});

test("ingestion derives user_id from the principal, preserves RLS token, and returns duplicates", async () => {
  const inserted: any[] = [], existingRow = { id: "job-id", company: "Example", job_title: "Engineer", source_url: "https://example.com/jobs/1", created_at: new Date().toISOString() };
  let duplicate = false;
  const query: any = { insert: (row: any) => { inserted.push(row); return query; }, select: () => query, single: async () => duplicate ? ({ data: null, error: { code: "23505", message: "duplicate" } }) : ({ data: existingRow, error: null }), eq: () => query, ilike: () => query, order: () => query, limit: () => query, maybeSingle: async () => ({ data: duplicate ? existingRow : null, error: null }) };
  const service = new JobDescriptionService({ forUser: (token: string) => { assert.equal(token, "user-jwt"); return { from: () => query }; } } as any);
  const input: any = { sourceUrl: "https://example.com/jobs/1", company: "Example", jobTitle: "Engineer", descriptionText: "x".repeat(100), categoryId: "123e4567-e89b-42d3-a456-426614174000" };
  assert.equal((await service.create({ id: "token-user", token: "user-jwt", claims: {} }, input)).duplicate, false);
  assert.equal(inserted[0].user_id, "token-user");
  duplicate = true;
  assert.equal((await service.create({ id: "token-user", token: "user-jwt", claims: {} }, input)).duplicate, true);
});

test("speed-focused ingestion uses one atomic capture RPC with no mirror work",async()=>{
  const calls:any[]=[];
  const service=new JobDescriptionService({forUser:(token:string)=>{assert.equal(token,"user-jwt");return{rpc:async(name:string,args:any)=>{calls.push({name,args});return{data:{row:{id:"job-id",company:"Example",job_title:"Engineer",source_url:"https://example.com/job",created_at:"2026-09-02T00:00:00Z"},duplicate:false,duplicateReason:null},error:null};},from:()=>{throw new Error("legacy capture query should not run");}};}}as any);
  const result=await service.create({id:"token-user",token:"user-jwt",claims:{}},{sourceUrl:"https://example.com/job?utm_source=test",company:"Example",jobTitle:"Engineer",descriptionText:"x".repeat(100),categoryId:"123e4567-e89b-42d3-a456-426614174000"}as any);
  assert.equal(result.row.id,"job-id");assert.equal("workspaceSync" in result,false);
  assert.deepEqual(calls.map(call=>call.name),["capture_job_description_v353"]);
  assert.equal(calls[0].args.p_record.user_id,"token-user");assert.equal(calls[0].args.p_record.normalized_source_url,"https://example.com/job");
});

test("ingestion maps RLS denial to a safe forbidden error", async () => {
  const query: any = { insert: () => query, select: () => query, eq: () => query, ilike: () => query, order: () => query, limit: () => query, maybeSingle: async () => ({ data: null, error: { code: "42501", message: "raw permission denied" } }), single: async () => ({ data: null, error: { code: "42501", message: "raw permission denied" } }) };
  const service = new JobDescriptionService({ forUser: () => ({ from: () => query }) } as any);
  await assert.rejects(() => service.create({ id: "u", token: "jwt", claims: {} }, { sourceUrl: "https://example.com/1", company: "A", jobTitle: "B", descriptionText: "x".repeat(100), categoryId: "123e4567-e89b-42d3-a456-426614174000" } as any), (error: unknown) => error instanceof ApiException && error.code === "FORBIDDEN" && error.getStatus() === HttpStatus.FORBIDDEN && !error.message.includes("raw"));
});
