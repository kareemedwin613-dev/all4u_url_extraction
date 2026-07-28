import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { Test } from "@nestjs/testing";
import { ValidationPipe } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";

Object.assign(process.env, {
  NODE_ENV: "test", PORT: "3002", API_BASE_PATH: "api/v1", CORS_ORIGINS: "http://localhost:4173",
  SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_OR_PUBLISHABLE_KEY: "publishable-test-key-with-safe-length",
  SUPABASE_JWT_ISSUER: "https://example.supabase.co/auth/v1", SUPABASE_JWKS_URL: "https://example.supabase.co/auth/v1/.well-known/jwks.json",
  SUPABASE_JWT_AUDIENCE: "authenticated", RATE_LIMIT_TTL_MS: "60000", RATE_LIMIT_MAX: "100", INGESTION_RATE_LIMIT_MAX: "50", LOG_LEVEL: "info", SWAGGER_ENABLED: "true",
});

const { AppModule } = await import("../src/app.module.js");
const { JwtVerifier } = await import("../src/auth/jwt-verifier.service.js");
const { SupabaseService } = await import("../src/supabase/supabase.service.js");
const { ApiExceptionFilter } = await import("../src/common/errors/api-exception.filter.js");
const { JobDescriptionReadService } = await import("../src/job-descriptions/job-description-read.service.js");
const { LookupService } = await import("../src/lookups/lookup.service.js");
const { ResumeService } = await import("../src/resumes/resume.service.js");
const { ApplicationService } = await import("../src/applications/application.service.js");
const { ApplicationBatchesService } = await import("../src/application-batches/application-batches.service.js");
const { BulkAssignmentService } = await import("../src/bulk-assignment/bulk-assignment.service.js");
const { PlatformService, TailoringService } = await import("../src/platform/platform.service.js");

let app: INestApplication, mode: "create"|"duplicate"|"identity"|"rls" = "create", active = true, roles = ["APPLYING_MANAGER"];
const row = { id:"job-1",company:"Example",job_title:"Engineer",category_id:"123e4567-e89b-42d3-a456-426614174000",subcategory_id:null,industry_domain_category_id:null,seniority:"SENIOR",location_text:null,work_arrangement:"REMOTE",clearance_requirements:[],travel_required:null,travel_details:null,salary_min:null,salary_max:null,salary_currency:null,salary_period:null,salary_text:null,source_site:"example.com",source_url:"https://example.com/jobs/1",description_text:"x".repeat(100),detected_skills:["SQL"],capture_method:"dom",extraction_confidence:"high",created_at:"2026-07-27T00:00:00Z" };
const supabaseMock = {
  readiness: async () => {},
  accessContext: async () => ({data:{status:active?"ACTIVE":"INACTIVE",roles},error:null}),
  forUser: () => {
    let identityQuery=false;
    const query: any = { insert: () => query, select: () => query, single: async () => mode === "create" ? ({data:row,error:null}) : mode === "duplicate" ? ({data:null,error:{code:"23505",message:"duplicate"}}) : ({data:null,error:{code:"42501",message:"permission denied"}}), eq: () => query, ilike: () => {identityQuery=true;return query;}, order: () => query, limit: () => query, maybeSingle: async () => mode === "create" ? ({data:null,error:null}) : mode === "duplicate" ? ({data:row,error:null}) : mode === "identity" ? ({data:identityQuery?row:null,error:null}) : ({data:null,error:{code:"42501",message:"permission denied"}}) };
    return { from: () => query };
  },
};
const validBody = { sourceUrl:"https://example.com/jobs/1",sourceWebsite:"example.com",company:"Example",jobTitle:"Engineer",descriptionText:"x".repeat(100),categoryId:"123e4567-e89b-42d3-a456-426614174000",seniority:"SENIOR",workArrangement:"REMOTE",detectedSkills:["SQL"],captureMethod:"dom",extractionConfidence:"high" };

before(async () => {
  const module = await Test.createTestingModule({ imports:[AppModule] })
    .overrideProvider(JwtVerifier).useValue({ verify: async (token:string) => ({id:"user-1",email:"user@example.com",token,claims:{}}) })
    .overrideProvider(SupabaseService).useValue(supabaseMock)
    .overrideProvider(JobDescriptionReadService).useValue({list:async()=>({items:[row],total:1,page:1,pageSize:25,pageCount:1,from:1,to:1,hasPrevious:false,hasNext:false}),detail:async()=>row,count:async()=>1,recent:async()=>[row]})
    .overrideProvider(LookupService).useValue({categories:async()=>[{id:"category-1",name:"Engineering"}],industryDomains:async()=>[{id:"industry-1",name:"Technology"}]})
    .overrideProvider(ResumeService).useValue({
      list:async()=>({items:[{id:"resume-1",candidate_name:"Candidate"}],total:1,page:1,pageSize:25,pageCount:1,from:1,to:1,hasPrevious:false,hasNext:false}),
      count:async()=>1,recent:async()=>[{id:"resume-1"}],detail:async()=>({id:"resume-1",candidate_name:"Candidate"}),
      signedUrl:async()=>({signedUrl:"https://storage.example/resume",expiresInSeconds:90,filename:"resume.pdf"}),
      identity:async()=>[{id:"resume-1"}],checksum:async()=>({id:"resume-1"}),upload:async()=>({id:"resume-1"}),
      update:async()=>({id:"resume-1"}),status:async()=>({id:"resume-1",status:"ARCHIVED"}),
    })
    .overrideProvider(ApplicationService).useValue({
      list:async()=>({items:[{id:"application-1"}],hasMore:false,nextCursor:null}),mine:async()=>({items:[{id:"application-1"}]}),
      detail:async()=>({application:{id:"application-1"}}),counts:async()=>({total:1}),appliers:async()=>[{id:"applier-1"}],jobs:async()=>[{id:"job-1"}],resumes:async()=>[{id:"resume-1"}],
      create:async()=>({id:"application-1"}),update:async()=>({id:"application-1",work_status:"IN_PROGRESS"}),assign:async()=>({id:"application-1"}),bulkAssign:async()=>({changedCount:1}),
      extensionContext:async()=>({application:{id:"123e4567-e89b-42d3-a456-426614174000",applicationNumber:1},job:{sourceUrl:"https://example.com/jobs/1"},resume:{id:"resume-1"},candidate:{profileAvailable:false},permissions:{canLoadResume:true,canAutofill:true}}),
      createExtensionSession:async(_user:any,id:string,body:any)=>({id:"323e4567-e89b-42d3-a456-426614174000",applicationId:id,action:body.action,status:"CREATED",targetUrl:"https://example.com/jobs/1",expiresAt:"2026-07-28T12:15:00Z"}),
      updateExtensionSession:async(_user:any,id:string,body:any)=>({id,applicationId:"123e4567-e89b-42d3-a456-426614174000",action:"AUTOFILL",status:body.status,expiresAt:"2026-07-28T12:15:00Z"}),
      preview:async()=>({combinations:[]}),bulkCreate:async()=>({batchId:"123e4567-e89b-42d3-a456-426614174000",createdCount:1}),batches:async()=>({items:[],total:0,page:1,pageSize:25,pageCount:0}),batchOptions:async()=>[],batch:async()=>({batch:{id:"123e4567-e89b-42d3-a456-426614174000"}}),
      resumeUrl:async()=>({signedUrl:"https://storage.example/resume",expiresInSeconds:90}),screenshots:async()=>[],addScreenshot:async()=>({id:"screenshot-1"}),removeScreenshot:async()=>({id:"screenshot-1"}),screenshotUrl:async()=>({signedUrl:"https://storage.example/screenshot",expiresInSeconds:90}),
    })
    .overrideProvider(ApplicationBatchesService).useValue({
      preview:async()=>({selectedJdCount:1,combinations:[]}),
      create:async()=>({batchId:"123e4567-e89b-42d3-a456-426614174000",createdCount:1,replayed:false,results:[]}),
      list:async()=>({items:[],total:0,page:1,pageSize:25,pageCount:0,nextCursor:null}),options:async()=>[],
      detail:async()=>({id:"123e4567-e89b-42d3-a456-426614174000",name:"Test",applications:[]}),
      results:async()=>({items:[],total:0,page:1,pageSize:25,pageCount:0}),
    })
    .overrideProvider(BulkAssignmentService).useValue({
      workloads:async()=>({items:[{userId:"applier-1",remainingCapacity:5}],page:{nextCursor:null,pageSize:25,total:1}}),
      settings:async()=>({userId:"applier-1",isAvailable:true,maxActiveApplications:10}),
      updateSettings:async()=>({userId:"applier-1",isAvailable:false,maxActiveApplications:10}),
      preview:async()=>({strategy:"EVEN",proposals:[{applicationId:"application-1",proposedAssigneeId:"applier-1"}],excludedApplications:[]}),
      assign:async()=>({batchId:"123e4567-e89b-42d3-a456-426614174000",assignedCount:1,skippedCount:0,failedCount:0,replayed:false}),
      batches:async()=>({items:[],total:0,page:1,pageSize:25,pageCount:0}),
      batch:async()=>({id:"123e4567-e89b-42d3-a456-426614174000",strategy:"EVEN"}),
      results:async()=>({items:[],page:{nextCursor:null,pageSize:25,total:0}}),
    })
    .overrideProvider(PlatformService).useValue({roles:async()=>[{code:"ADMIN"}],users:async()=>({items:[],page:1,pageSize:25,total:0,totalPages:0}),user:async()=>({id:"user-1"}),role:async()=>["ADMIN"],status:async()=>({id:"user-1",status:"INACTIVE"}),profile:async()=>({id:"user-1",full_name:"Name"}),overview:async()=>({jobCounts:{total:1}})})
    .overrideProvider(TailoringService).useValue({create:async()=>[{status:"created",resumeId:"resume-1"}],list:async()=>[{id:"tailoring-1"}],cancel:async()=>({id:"tailoring-1",status:"CANCELLED"}),fileUrl:async()=>({signedUrl:"https://storage.example/queue",expiresInSeconds:90})})
    .compile();
  app = module.createNestApplication();
  app.setGlobalPrefix("api/v1",{exclude:["health","ready"]});
  app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
});
after(async () => { await app.close(); });

test("health and readiness are public and return request IDs", async () => {
  const health=await request(app.getHttpServer()).get("/health");
  assert.equal(health.status,200,JSON.stringify(health.body));
  assert.equal(health.body.version,"0.7.2"); assert.match(health.headers["x-request-id"],/^req_/);
  const ready=await request(app.getHttpServer()).get("/ready").expect(200);
  assert.equal(ready.body.dependencies.supabase,"ready");
});

test("ingestion rejects unauthenticated, inactive, and invalid requests", async () => {
  await request(app.getHttpServer()).post("/api/v1/extension/job-descriptions").send(validBody).expect(401).expect(({body,headers})=>{assert.equal(body.code,"UNAUTHORIZED");assert.equal(body.requestId,headers["x-request-id"]);});
  active=false;
  await request(app.getHttpServer()).post("/api/v1/extension/job-descriptions").set("Authorization","Bearer token").send(validBody).expect(403);
  active=true;
  await request(app.getHttpServer()).post("/api/v1/extension/job-descriptions").set("Authorization","Bearer token").send({...validBody,descriptionText:"short"}).expect(400);
});

test("JD read and lookup routes require authentication and expose bounded API responses",async()=>{
  await request(app.getHttpServer()).get("/api/v1/access-context").expect(401);
  await request(app.getHttpServer()).get("/api/v1/access-context").set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.status,"ACTIVE"));
  await request(app.getHttpServer()).get("/api/v1/job-descriptions").expect(401);
  await request(app.getHttpServer()).get("/api/v1/job-descriptions?sort=raw_sql&pageSize=500").set("Authorization","Bearer token").expect(400);
  await request(app.getHttpServer()).get("/api/v1/job-descriptions?status=ACTIVE&sort=created_desc&pageSize=25").set("Authorization","Bearer token").expect(200).expect(({body})=>{assert.equal(body.data.total,1);assert.equal(body.data.items[0].id,"job-1");});
  await request(app.getHttpServer()).get("/api/v1/job-descriptions/count?status=ACTIVE").set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data,1));
  await request(app.getHttpServer()).get("/api/v1/job-descriptions/recent?limit=5").set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.length,1));
  await request(app.getHttpServer()).get("/api/v1/job-descriptions/123e4567-e89b-42d3-a456-426614174000").set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.id,"job-1"));
  await request(app.getHttpServer()).get("/api/v1/lookups/categories").set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data[0].name,"Engineering"));
  await request(app.getHttpServer()).get("/api/v1/lookups/industry-domains").set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data[0].name,"Technology"));
});

test("Resume reads use authenticated API routes and Admin-only operations remain protected",async()=>{
  const id="123e4567-e89b-42d3-a456-426614174000";
  roles=["APPLYING_MANAGER"];
  await request(app.getHttpServer()).get("/api/v1/resumes").expect(401);
  await request(app.getHttpServer()).get("/api/v1/resumes?pageSize=25").set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.total,1));
  await request(app.getHttpServer()).get(`/api/v1/resumes/${id}`).set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.candidate_name,"Candidate"));
  await request(app.getHttpServer()).get(`/api/v1/resumes/${id}/file-url`).set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.expiresInSeconds,90));
  await request(app.getHttpServer()).post("/api/v1/resumes/identity-duplicates").set("Authorization","Bearer token").send({candidateName:"Candidate"}).expect(403);
  roles=["ADMIN"];
  await request(app.getHttpServer()).post("/api/v1/resumes/identity-duplicates").set("Authorization","Bearer token").send({candidateName:"Candidate"}).expect(201).expect(({body})=>assert.equal(body.data[0].id,"resume-1"));
  roles=["APPLYING_MANAGER"];
});

test("Application and bulk routes enforce roles and validate protected mutations",async()=>{
  const id="123e4567-e89b-42d3-a456-426614174000",resumeId="223e4567-e89b-42d3-a456-426614174000";
  roles=["APPLIER"];
  await request(app.getHttpServer()).get("/api/v1/applications/mine?applicationStatus=NOT_APPLIED").set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.items.length,1));
  await request(app.getHttpServer()).post("/api/v1/applications").set("Authorization","Bearer token").send({jobDescriptionId:id,resumeId,priority:"NORMAL"}).expect(403);
  await request(app.getHttpServer()).patch(`/api/v1/applications/${id}/progress`).set("Authorization","Bearer token").send({workStatus:"ASSIGNED",applicationStatus:"APPLIED",applicationUrl:"http://localhost:4174/#/applications?workStatus=ASSIGNED"}).expect(200);
  roles=["APPLYING_MANAGER"];
  await request(app.getHttpServer()).post("/api/v1/applications").set("Authorization","Bearer token").send({jobDescriptionId:id,resumeId,priority:"NORMAL"}).expect(201);
  await request(app.getHttpServer()).post("/api/v1/applications/bulk-preview").set("Authorization","Bearer token").send({jobDescriptionIds:[id]}).expect(201);
  await request(app.getHttpServer()).post("/api/v1/applications/bulk-create").set("Authorization","Bearer token").set("Idempotency-Key","bulk_test_123").send({combinations:[{jobDescriptionId:id,resumeId}],batchName:"Test"}).expect(201);
  await request(app.getHttpServer()).post("/api/v1/applications/bulk-create").set("Authorization","Bearer token").send({combinations:[{jobDescriptionId:id,resumeId}]}).expect(400);
  await request(app.getHttpServer()).get(`/api/v1/application-batches/${id}`).set("Authorization","Bearer token").expect(200);
  await request(app.getHttpServer()).get(`/api/v1/application-batches/${id}/results?page=1&limit=25`).set("Authorization","Bearer token").expect(200);
  roles=["APPLYING_MANAGER"];
});

test("v0.8.5 extension context and sessions enforce roles and validate state",async()=>{
  const id="123e4567-e89b-42d3-a456-426614174000",sessionId="323e4567-e89b-42d3-a456-426614174000";
  roles=["DEVELOPER"];
  await request(app.getHttpServer()).get(`/api/v1/applications/${id}/extension-context`).set("Authorization","Bearer token").expect(403);
  roles=["APPLIER"];
  await request(app.getHttpServer()).get(`/api/v1/applications/${id}/extension-context`).set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.permissions.canLoadResume,true));
  await request(app.getHttpServer()).post(`/api/v1/applications/${id}/extension-sessions`).set("Authorization","Bearer token").send({action:"AUTOFILL",unexpected:true}).expect(400);
  await request(app.getHttpServer()).post(`/api/v1/applications/${id}/extension-sessions`).set("Authorization","Bearer token").send({action:"AUTOFILL",extensionVersion:"0.8.5"}).expect(201).expect(({body})=>assert.equal(body.data.applicationId,id));
  await request(app.getHttpServer()).patch(`/api/v1/extension-sessions/${sessionId}`).set("Authorization","Bearer token").send({status:"TARGET_READY"}).expect(200).expect(({body})=>assert.equal(body.data.status,"TARGET_READY"));
  await request(app.getHttpServer()).patch(`/api/v1/extension-sessions/${sessionId}`).set("Authorization","Bearer token").send({status:"UNKNOWN"}).expect(400);
  roles=["APPLYING_MANAGER"];
});

test("v0.8 workload and bulk-assignment routes are manager-only and require idempotency",async()=>{
  const id="123e4567-e89b-42d3-a456-426614174000";
  roles=["APPLIER"];
  await request(app.getHttpServer()).get("/api/v1/appliers/workloads").set("Authorization","Bearer token").expect(403);
  await request(app.getHttpServer()).post("/api/v1/applications/bulk-assignment-preview").set("Authorization","Bearer token").send({strategy:"EVEN",applicationIds:[id],applierIds:[id]}).expect(403);
  roles=["APPLYING_MANAGER"];
  await request(app.getHttpServer()).get("/api/v1/appliers/workloads?limit=25").set("Authorization","Bearer token").expect(200).expect(({body})=>{assert.equal(body.data.length,1);assert.equal(body.page.total,1);});
  await request(app.getHttpServer()).patch(`/api/v1/appliers/${id}/workload-settings`).set("Authorization","Bearer token").send({isAvailable:false,maxActiveApplications:10}).expect(200);
  await request(app.getHttpServer()).post("/api/v1/applications/bulk-assignment-preview").set("Authorization","Bearer token").send({strategy:"EVEN",applicationIds:[id],applierIds:[id]}).expect(201);
  await request(app.getHttpServer()).post("/api/v1/applications/bulk-assign").set("Authorization","Bearer token").send({strategy:"EVEN",assignments:[{applicationId:id,assignedTo:id}]}).expect(400);
  await request(app.getHttpServer()).post("/api/v1/applications/bulk-assign").set("Authorization","Bearer token").set("Idempotency-Key","assign_test_123").send({strategy:"EVEN",assignments:[{applicationId:id,assignedTo:id}]}).expect(201);
  await request(app.getHttpServer()).get(`/api/v1/assignment-batches/${id}/results?limit=25`).set("Authorization","Bearer token").expect(200);
});

test("Profile, Admin, overview, and tailoring routes enforce the final backend boundary",async()=>{
  const id="123e4567-e89b-42d3-a456-426614174000",resumeId="223e4567-e89b-42d3-a456-426614174000";
  roles=[];
  await request(app.getHttpServer()).patch("/api/v1/profile").set("Authorization","Bearer token").send({fullName:"Name"}).expect(200);
  await request(app.getHttpServer()).get("/api/v1/admin/roles").set("Authorization","Bearer token").expect(403);
  roles=["APPLIER"];
  await request(app.getHttpServer()).get("/api/v1/business-overview").set("Authorization","Bearer token").expect(200);
  await request(app.getHttpServer()).get("/api/v1/tailoring-jobs?status=PENDING").set("Authorization","Bearer token").expect(200);
  await request(app.getHttpServer()).post("/api/v1/tailoring-jobs").set("Authorization","Bearer token").send({jobDescriptionId:id,matches:[{resumeId,matchScore:80,matchDetails:{eligible:true}}]}).expect(403);
  roles=["ADMIN"];
  await request(app.getHttpServer()).get("/api/v1/admin/roles").set("Authorization","Bearer token").expect(200);
  await request(app.getHttpServer()).get("/api/v1/admin/users?page=1&pageSize=25").set("Authorization","Bearer token").expect(200);
  await request(app.getHttpServer()).post("/api/v1/tailoring-jobs").set("Authorization","Bearer token").send({jobDescriptionId:id,matches:[{resumeId,matchScore:80,matchDetails:{eligible:true}}]}).expect(201);
  await request(app.getHttpServer()).post("/api/v1/tailoring-jobs").set("Authorization","Bearer token").send({jobDescriptionId:id,matches:[{resumeId:"bad",matchScore:101,matchDetails:{}}]}).expect(400);
  roles=["APPLYING_MANAGER"];
});

test("ingestion creates once, returns a duplicate safely, and exposes RLS denial", async () => {
  mode="create";
  await request(app.getHttpServer()).post("/api/v1/extension/job-descriptions").set("Authorization","Bearer token").set("Idempotency-Key","request-1234").set("X-Request-ID","incoming_1234").send(validBody).expect(201).expect(({body,headers})=>{assert.equal(body.data.duplicate,false);assert.equal(body.requestId,"incoming_1234");assert.equal(headers["x-request-id"],"incoming_1234");});
  mode="duplicate";
  await request(app.getHttpServer()).post("/api/v1/extension/job-descriptions").set("Authorization","Bearer token").set("Idempotency-Key","request-1234").send(validBody).expect(200).expect(({body})=>assert.equal(body.data.duplicate,true));
  mode="identity";
  await request(app.getHttpServer()).post("/api/v1/extension/job-descriptions").set("Authorization","Bearer token").send({...validBody,sourceUrl:"https://example.com/jobs/different"}).expect(200).expect(({body})=>{assert.equal(body.data.duplicate,true);assert.equal(body.data.duplicateReason,"COMPANY_JOB_TITLE");});
  mode="rls";
  await request(app.getHttpServer()).post("/api/v1/extension/job-descriptions").set("Authorization","Bearer token").send(validBody).expect(403).expect(({body})=>{assert.equal(body.code,"FORBIDDEN");assert.doesNotMatch(body.message,/permission denied/);});
});
