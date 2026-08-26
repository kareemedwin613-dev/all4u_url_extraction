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
const { CandidateService } = await import("../src/candidates/candidate.service.js");
const { ResumeAnswerService } = await import("../src/resume-answers/resume-answer.service.js");
const { PlatformService, TailoringRunnerService, TailoringService } = await import("../src/platform/platform.service.js");
const { TailoringBatchRunnerService, TailoringBatchService } = await import("../src/platform/tailoring-batch.service.js");

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
    .overrideProvider(JobDescriptionReadService).useValue({list:async()=>({items:[row],total:1,page:1,pageSize:25,pageCount:1,from:1,to:1,hasPrevious:false,hasNext:false}),detail:async()=>row,count:async()=>1,recent:async()=>[row],capturers:async()=>[{id:"123e4567-e89b-42d3-a456-426614174000",displayName:"Capture User",email:"capture@example.com",capturedCount:3}],status:async(_user:any,id:string,status:string,reason?:string)=>({id,status,archive_reason:reason||null}),review:async(_user:any,id:string,reviewStatus:string,declineReason?:string,comment?:string)=>({id,review_status:reviewStatus,review_decline_reason:declineReason||null,review_comment:comment||null}),bulkReview:async(_user:any,ids:string[],reviewStatus:string,declineReason?:string,comment?:string)=>({total:ids.length,succeeded:ids.length,failed:0,results:ids.map(id=>({id,ok:true,data:{id,review_status:reviewStatus,review_decline_reason:declineReason||null,review_comment:comment||null}}))}),managerEdit:async(_user:any,id:string,body:any)=>({id,company:body.company,job_title:body.jobTitle,review_status:"NEEDS_REVIEW"}),correct:async(_user:any,id:string,body:any)=>({id,company:body.company,review_status:"NEEDS_REVIEW"})})
    .overrideProvider(LookupService).useValue({categories:async()=>[{id:"category-1",name:"Engineering"}],industryDomains:async()=>[{id:"industry-1",name:"Technology"}]})
    .overrideProvider(ResumeService).useValue({
      list:async()=>({items:[{id:"resume-1",candidate_name:"Candidate"}],total:1,page:1,pageSize:25,pageCount:1,from:1,to:1,hasPrevious:false,hasNext:false}),
      count:async()=>1,recent:async()=>[{id:"resume-1"}],detail:async()=>({id:"resume-1",candidate_name:"Candidate"}),
      signedUrl:async()=>({signedUrl:"https://storage.example/resume",expiresInSeconds:90,filename:"resume.pdf"}),
      coverLetterSignedUrl:async()=>({signedUrl:"https://storage.example/cover",expiresInSeconds:90,filename:"cover.pdf"}),
      uploadCoverLetter:async()=>({id:"resume-1",cover_letter_storage_path:"owner/resume-1/cover-cover.pdf",cover_letter_original_filename:"cover.pdf"}),
      removeCoverLetter:async()=>({id:"resume-1",cover_letter_storage_path:null}),
      listBannedCompanies:async()=>[{id:"ban-1",companyName:"Google"}],
      addBannedCompany:async(_user:any,_id:string,companyName:string)=>({id:"ban-2",companyName}),
      removeBannedCompany:async()=>({id:"ban-1",companyName:"Google"}),
      applierProfile:async()=>({applierUserId:"applier-1",displayName:"Khalid",resumeId:"resume-1"}),
      identity:async()=>[{id:"resume-1"}],checksum:async()=>({id:"resume-1"}),upload:async()=>({id:"resume-1"}),
      update:async()=>({id:"resume-1"}),rename:async(_user:any,_id:string,resumeName:string)=>({id:"resume-1",resume_name:resumeName}),status:async()=>({id:"resume-1",status:"ARCHIVED"}),
    })
    .overrideProvider(ApplicationService).useValue({
      list:async()=>({items:[{id:"application-1"}],hasMore:false,nextCursor:null}),mine:async()=>({items:[{id:"application-1"}]}),
      detail:async()=>({application:{id:"application-1"}}),counts:async()=>({total:1}),appliers:async()=>[{id:"applier-1"}],jobs:async()=>[{id:"job-1"}],resumes:async()=>[{id:"resume-1"}],
      create:async()=>({id:"application-1"}),update:async()=>({id:"application-1",status:"IN_PROGRESS"}),assign:async()=>({id:"application-1"}),bulkAssign:async()=>({changedCount:1}),
      extensionContext:async()=>({application:{id:"123e4567-e89b-42d3-a456-426614174000",applicationNumber:1},job:{sourceUrl:"https://example.com/jobs/1"},resume:{id:"resume-1"},candidate:{profileAvailable:false},permissions:{canLoadResume:true,canAutofill:true}}),
      createExtensionSession:async(_user:any,id:string,body:any)=>({id:"323e4567-e89b-42d3-a456-426614174000",applicationId:id,action:body.action,status:"CREATED",targetUrl:"https://example.com/jobs/1",expiresAt:"2026-07-28T12:15:00Z"}),
      autofillContext:async(_user:any,id:string,query:any)=>({applicationId:id,sessionId:query.sessionId,resumeId:"223e4567-e89b-42d3-a456-426614174000",resumeUpdatedAt:"2026-07-29T00:00:00Z",profileSchemaVersion:1,reviewedAt:"2026-07-29T00:00:00Z",job:{company:"Example",jobTitle:"Engineer",sourceUrl:"https://example.com/jobs/1"},values:{"candidate.email":"person@example.com"}}),
      updateExtensionSession:async(_user:any,id:string,body:any)=>({id,applicationId:"123e4567-e89b-42d3-a456-426614174000",action:"AUTOFILL",status:body.status,expiresAt:"2026-07-28T12:15:00Z"}),
      recordAutofillTelemetry:async(_user:any,id:string,body:any)=>({id,applicationId:"123e4567-e89b-42d3-a456-426614174000",...body,updatedAt:"2026-08-02T12:01:00Z"}),
      resumeAccess:async()=>({signedUrl:"https://storage.example/signed-resume",filename:"candidate.pdf",mimeType:"application/pdf",fileSizeBytes:1024,expiresAt:"2026-07-28T12:01:00Z"}),
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
      listResumeProfiles:async()=>[{resumeId:"resume-1",resumeName:"Derek"}],
      listResumeProfileOptions:async()=>[{resumeId:"resume-1",resumeName:"Derek",ownerApplierUserId:null}],
      setResumeProfiles:async(_user:any,_id:string,resumeIds:string[])=>resumeIds.map((resumeId)=>({resumeId})),
      preview:async()=>({strategy:"PROFILE",proposals:[{applicationId:"application-1",proposedAssigneeId:"applier-1"}],excludedApplications:[]}),
      assign:async()=>({batchId:"123e4567-e89b-42d3-a456-426614174000",assignedCount:1,skippedCount:0,failedCount:0,replayed:false}),
      batches:async()=>({items:[],total:0,page:1,pageSize:25,pageCount:0}),
      batch:async()=>({id:"123e4567-e89b-42d3-a456-426614174000",strategy:"PROFILE"}),
      results:async()=>({items:[],page:{nextCursor:null,pageSize:25,total:0}}),
    })
    .overrideProvider(CandidateService).useValue({
      get:async()=>({id:"123e4567-e89b-42d3-a456-426614174000",fullName:"Candidate",reviewStatus:"NEEDS_REVIEW",employment:[],education:[]}),
      update:async(_user:any,id:string,body:any)=>({id,fullName:body.fullName,reviewStatus:body.reviewStatus}),
      structured:async(_user:any,id:string,body:any)=>({id,...body,reviewStatus:"VERIFIED"}),
      employment:async(_user:any,id:string,body:any)=>({id:"employment-1",profile:{id,employment:[body]}}),
      education:async(_user:any,id:string,body:any)=>({id:"education-1",profile:{id,education:[body]}}),
    })
    .overrideProvider(ResumeAnswerService).useValue({
      list:async()=>[{id:"answer-1",answerKey:"authorized_to_work",answerValue:true}],
      save:async(_user:any,_resumeId:string,body:any,id?:string)=>({id:id||"answer-1",...body}),
      saveAll:async(_user:any,_resumeId:string,answers:any[])=>answers,
      archive:async()=>({id:"answer-1",active:false}),
    })
    .overrideProvider(PlatformService).useValue({roles:async()=>[{code:"ADMIN"}],users:async()=>({items:[],page:1,pageSize:25,total:0,totalPages:0}),user:async()=>({id:"user-1"}),role:async()=>["ADMIN"],status:async()=>({id:"user-1",status:"INACTIVE"}),updateUserProfile:async()=>({id:"user-1",fullName:"Alex Applier"}),profile:async()=>({id:"user-1",full_name:"Name"}),overview:async()=>({jobCounts:{total:1}})})
    .overrideProvider(TailoringService).useValue({create:async()=>[{status:"created",resumeId:"resume-1"}],list:async()=>[{id:"tailoring-1"}],templates:()=>[{key:"CLASSIC_V1",name:"Classic",description:"Traditional"}],selectTemplate:async()=>({renderTemplateKey:"CLASSIC_V1"}),selectFormat:async(_user:any,_id:string,body:any)=>({renderFormat:body.renderFormat}),requestApplication:async(_user:any,applicationId:string)=>({id:"123e4567-e89b-42d3-a456-426614174000",applicationId,status:"PENDING"}),bulkRequest:async(_user:any,applicationIds:string[])=>applicationIds.map(applicationId=>({applicationId,outcome:"READY"})),bulkTickets:async(_user:any,jobIds:string[])=>jobIds.map(jobId=>({jobId,ticket:`trt_${"b".repeat(43)}`})),input:async()=>({jobId:"123e4567-e89b-42d3-a456-426614174000",input:{contractVersion:"1.2"}}),preview:async()=>({id:"123e4567-e89b-42d3-a456-426614174000",status:"NEEDS_REVIEW"}),ticket:async()=>({ticketId:"223e4567-e89b-42d3-a456-426614174000",jobId:"123e4567-e89b-42d3-a456-426614174000",ticket:`trt_${"a".repeat(43)}`,expiresAt:"2026-08-03T12:10:00Z"}),review:async()=>({id:"123e4567-e89b-42d3-a456-426614174000",status:"APPROVED"}),materialize:async()=>({jobId:"123e4567-e89b-42d3-a456-426614174000",applicationId:"223e4567-e89b-42d3-a456-426614174000",status:"COMPLETED",tailoredResumeId:"323e4567-e89b-42d3-a456-426614174000",tailoredResumeNumber:42,renderFormat:"PDF",alreadyMaterialized:false}),reviews:async()=>[{id:"review-1",action:"APPROVE"}],detail:async()=>({id:"123e4567-e89b-42d3-a456-426614174000",status:"NEEDS_REVIEW"}),cancel:async()=>({id:"tailoring-1",status:"CANCELLED"}),fileUrl:async()=>({signedUrl:"https://storage.example/queue",expiresInSeconds:90})})
    .overrideProvider(TailoringRunnerService).useValue({claim:async()=>({jobId:"123e4567-e89b-42d3-a456-426614174000",runExpiresAt:"2026-08-03T12:30:00Z",input:{contractVersion:"1.2"}}),preview:async()=>({id:"123e4567-e89b-42d3-a456-426614174000",status:"NEEDS_REVIEW"}),fail:async()=>({jobId:"123e4567-e89b-42d3-a456-426614174000",status:"FAILED"})})
    .overrideProvider(TailoringBatchService).useValue({create:async()=>({id:"123e4567-e89b-42d3-a456-426614174000",status:"PENDING",selected_count:2}),list:async()=>[],detail:async()=>({batch:{id:"123e4567-e89b-42d3-a456-426614174000",status:"RUNNING"},items:[]}),ticket:async()=>({ticket:`trb_${"c".repeat(43)}`}),retry:async()=>({retriedCount:1}),cancel:async()=>({status:"CANCELLED"})})
    .overrideProvider(TailoringBatchRunnerService).useValue({claim:async()=>({batchId:"123e4567-e89b-42d3-a456-426614174000",selectedCount:2}),next:async()=>({state:"COMPLETED",reviewCount:2}),preview:async()=>({status:"NEEDS_REVIEW"}),fail:async()=>({status:"WAITING_RETRY"})})
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

test("JD Finder can capture and read owned JDs but cannot access other operational APIs",async()=>{
  roles=["JD_FINDER"];mode="create";
  await request(app.getHttpServer()).get("/api/v1/lookups/categories").set("Authorization","Bearer token").expect(200);
  await request(app.getHttpServer()).post("/api/v1/extension/job-descriptions").set("Authorization","Bearer token").send(validBody).expect(201).expect(({body})=>assert.equal(body.data.company,"Example"));
  await request(app.getHttpServer()).get("/api/v1/job-descriptions").set("Authorization","Bearer token").expect(200);
  await request(app.getHttpServer()).get("/api/v1/applications").set("Authorization","Bearer token").expect(403);
  await request(app.getHttpServer()).get("/api/v1/resumes").set("Authorization","Bearer token").expect(403);
  roles=["APPLYING_MANAGER"];
});

test("JD read and lookup routes require authentication and expose bounded API responses",async()=>{
  await request(app.getHttpServer()).get("/api/v1/access-context").expect(401);
  await request(app.getHttpServer()).get("/api/v1/access-context").set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.status,"ACTIVE"));
  await request(app.getHttpServer()).get("/api/v1/job-descriptions").expect(401);
  await request(app.getHttpServer()).get("/api/v1/job-descriptions?sort=raw_sql&pageSize=999").set("Authorization","Bearer token").expect(400);
  await request(app.getHttpServer()).get("/api/v1/job-descriptions?status=ACTIVE&sort=created_desc&pageSize=500").set("Authorization","Bearer token").expect(200).expect(({body})=>{assert.equal(body.data.total,1);assert.equal(body.data.items[0].id,"job-1");});
  await request(app.getHttpServer()).get("/api/v1/job-descriptions?status=ACTIVE&sort=created_desc&pageSize=25").set("Authorization","Bearer token").expect(200).expect(({body})=>{assert.equal(body.data.total,1);assert.equal(body.data.items[0].id,"job-1");});
  await request(app.getHttpServer()).get("/api/v1/job-descriptions/count?status=ACTIVE").set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data,1));
  await request(app.getHttpServer()).get("/api/v1/job-descriptions/recent?limit=5").set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.length,1));
  await request(app.getHttpServer()).get("/api/v1/job-descriptions/capturers").set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data[0].capturedCount,3));
  await request(app.getHttpServer()).get("/api/v1/job-descriptions/123e4567-e89b-42d3-a456-426614174000").set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.id,"job-1"));
  await request(app.getHttpServer()).get("/api/v1/lookups/categories").set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data[0].name,"Engineering"));
  await request(app.getHttpServer()).get("/api/v1/lookups/industry-domains").set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data[0].name,"Technology"));
});

test("captured URL review is restricted to Applying Managers and Admins",async()=>{
  const id="123e4567-e89b-42d3-a456-426614174000";
  roles=["APPLIER"];
  await request(app.getHttpServer()).patch(`/api/v1/job-descriptions/${id}/status`).set("Authorization","Bearer token").send({status:"ARCHIVED",reason:"NOT_APPLICABLE"}).expect(403);
  roles=["APPLYING_MANAGER"];
  await request(app.getHttpServer()).patch(`/api/v1/job-descriptions/${id}/status`).set("Authorization","Bearer token").send({status:"ARCHIVED",reason:"NOT_APPLICABLE"}).expect(200).expect(({body})=>{assert.equal(body.data.status,"ARCHIVED");assert.equal(body.data.archive_reason,"NOT_APPLICABLE");});
  await request(app.getHttpServer()).patch(`/api/v1/job-descriptions/${id}/status`).set("Authorization","Bearer token").send({status:"ARCHIVED",reason:"UNSAFE_REASON"}).expect(400);
});

test("simple JD decisions are restricted, validated, and returned",async()=>{
  const id="123e4567-e89b-42d3-a456-426614174000";
  roles=["JD_FINDER"];
  await request(app.getHttpServer()).patch(`/api/v1/job-descriptions/${id}/review`).set("Authorization","Bearer token").send({reviewStatus:"APPROVED"}).expect(403);
  roles=["APPLYING_MANAGER"];
  await request(app.getHttpServer()).patch(`/api/v1/job-descriptions/${id}/review`).set("Authorization","Bearer token").send({reviewStatus:"DECLINED",declineReason:"EXPIRED",comment:"Posting closed"}).expect(200).expect(({body})=>assert.equal(body.data.review_status,"DECLINED"));
  await request(app.getHttpServer()).patch(`/api/v1/job-descriptions/${id}/review`).set("Authorization","Bearer token").send({reviewStatus:"DECLINED",declineReason:"UNSAFE"}).expect(400);
  await request(app.getHttpServer()).post("/api/v1/job-descriptions/bulk-review").set("Authorization","Bearer token").send({jobDescriptionIds:[id],reviewStatus:"APPROVED"}).expect(201).expect(({body})=>{assert.equal(body.data.succeeded,1);assert.equal(body.data.results[0].data.review_status,"APPROVED");});
  roles=["APPLIER"];
  await request(app.getHttpServer()).post("/api/v1/job-descriptions/bulk-review").set("Authorization","Bearer token").send({jobDescriptionIds:[id],reviewStatus:"APPROVED"}).expect(403);
});

test("manager can edit an unapproved JD during review",async()=>{
  const id="123e4567-e89b-42d3-a456-426614174000",
    body={company:"Acme",jobTitle:"Engineer",categoryId:id,sourceUrl:"https://example.com/jobs/1",descriptionText:"A".repeat(100)};
  roles=["JD_FINDER"];
  await request(app.getHttpServer()).patch(`/api/v1/job-descriptions/${id}/manager-edit`).set("Authorization","Bearer token").send(body).expect(403);
  roles=["APPLYING_MANAGER"];
  await request(app.getHttpServer()).patch(`/api/v1/job-descriptions/${id}/manager-edit`).set("Authorization","Bearer token").send(body).expect(200).expect(({body:payload})=>{
    assert.equal(payload.data.company,"Acme");
    assert.equal(payload.data.job_title,"Engineer");
  });
});

test("Resume reads preserve history while archive actions require a manager or Admin",async()=>{
  const id="123e4567-e89b-42d3-a456-426614174000";
  roles=["APPLYING_MANAGER"];
  await request(app.getHttpServer()).get("/api/v1/resumes").expect(401);
  await request(app.getHttpServer()).get("/api/v1/resumes?pageSize=25").set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.total,1));
  await request(app.getHttpServer()).get(`/api/v1/resumes/${id}`).set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.candidate_name,"Candidate"));
  await request(app.getHttpServer()).get(`/api/v1/resumes/${id}/file-url`).set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.expiresInSeconds,90));
  roles=["APPLIER"];
  await request(app.getHttpServer()).patch(`/api/v1/resumes/${id}/status`).set("Authorization","Bearer token").send({status:"ARCHIVED"}).expect(403);
  roles=["APPLYING_MANAGER"];
  await request(app.getHttpServer()).patch(`/api/v1/resumes/${id}/status`).set("Authorization","Bearer token").send({status:"ARCHIVED"}).expect(200).expect(({body})=>assert.equal(body.data.status,"ARCHIVED"));
  await request(app.getHttpServer()).patch(`/api/v1/resumes/${id}/name`).set("Authorization","Bearer token").send({resumeName:"Brian Rose Resume"}).expect(200).expect(({body})=>assert.equal(body.data.resume_name,"Brian Rose Resume"));
  await request(app.getHttpServer()).patch(`/api/v1/resumes/${id}/name`).set("Authorization","Bearer token").send({resumeName:""}).expect(400);
  await request(app.getHttpServer()).post("/api/v1/resumes/identity-duplicates").set("Authorization","Bearer token").send({candidateName:"Candidate"}).expect(403);
  roles=["ADMIN"];
  await request(app.getHttpServer()).post("/api/v1/resumes/identity-duplicates").set("Authorization","Bearer token").send({candidateName:"Candidate"}).expect(201).expect(({body})=>assert.equal(body.data[0].id,"resume-1"));
  roles=["APPLYING_MANAGER"];
});

test("Resume cover letter open is readable while upload and delete require a manager or Admin",async()=>{
  const id="123e4567-e89b-42d3-a456-426614174000";
  roles=["APPLIER"];
  await request(app.getHttpServer()).get(`/api/v1/resumes/${id}/cover-letter/file-url`).set("Authorization","Bearer token").expect(200).expect(({body})=>{
    assert.equal(body.data.signedUrl,"https://storage.example/cover");
    assert.equal(body.data.expiresInSeconds,90);
  });
  await request(app.getHttpServer()).post(`/api/v1/resumes/${id}/cover-letter`).set("Authorization","Bearer token").attach("file",Buffer.from("%PDF-1.4"),"cover.pdf").expect(403);
  await request(app.getHttpServer()).delete(`/api/v1/resumes/${id}/cover-letter`).set("Authorization","Bearer token").expect(403);
  roles=["APPLYING_MANAGER"];
  await request(app.getHttpServer()).post(`/api/v1/resumes/${id}/cover-letter`).set("Authorization","Bearer token").attach("file",Buffer.from("%PDF-1.4"),"cover.pdf").expect(201).expect(({body})=>assert.equal(body.data.cover_letter_original_filename,"cover.pdf"));
  await request(app.getHttpServer()).delete(`/api/v1/resumes/${id}/cover-letter`).set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.cover_letter_storage_path,null));
  roles=["APPLYING_MANAGER"];
});

test("Resume banned companies are readable while add and delete require a manager or Admin",async()=>{
  const id="123e4567-e89b-42d3-a456-426614174000",entryId="223e4567-e89b-42d3-a456-426614174000";
  roles=["APPLIER"];
  await request(app.getHttpServer()).get(`/api/v1/resumes/${id}/banned-companies`).set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data[0].companyName,"Google"));
  await request(app.getHttpServer()).post(`/api/v1/resumes/${id}/banned-companies`).set("Authorization","Bearer token").send({companyName:"Amazon"}).expect(403);
  await request(app.getHttpServer()).delete(`/api/v1/resumes/${id}/banned-companies/${entryId}`).set("Authorization","Bearer token").expect(403);
  roles=["APPLYING_MANAGER"];
  await request(app.getHttpServer()).post(`/api/v1/resumes/${id}/banned-companies`).set("Authorization","Bearer token").send({companyName:"Amazon"}).expect(201).expect(({body})=>assert.equal(body.data.companyName,"Amazon"));
  await request(app.getHttpServer()).delete(`/api/v1/resumes/${id}/banned-companies/${entryId}`).set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.companyName,"Google"));
  roles=["APPLYING_MANAGER"];
});

test("Applier resume profile allowlist routes are manager-only",async()=>{
  const id="123e4567-e89b-42d3-a456-426614174000",resumeId="223e4567-e89b-42d3-a456-426614174000";
  roles=["APPLIER"];
  await request(app.getHttpServer()).get(`/api/v1/resumes/${resumeId}/applier-profile`).set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.displayName,"Khalid"));
  await request(app.getHttpServer()).get("/api/v1/appliers/resume-profile-options").set("Authorization","Bearer token").expect(403);
  await request(app.getHttpServer()).get(`/api/v1/appliers/${id}/resume-profiles`).set("Authorization","Bearer token").expect(403);
  await request(app.getHttpServer()).put(`/api/v1/appliers/${id}/resume-profiles`).set("Authorization","Bearer token").send({resumeIds:[resumeId]}).expect(403);
  roles=["APPLYING_MANAGER"];
  await request(app.getHttpServer()).get("/api/v1/appliers/resume-profile-options").set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data[0].resumeName,"Derek"));
  await request(app.getHttpServer()).get(`/api/v1/appliers/${id}/resume-profiles`).set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data[0].resumeName,"Derek"));
  await request(app.getHttpServer()).put(`/api/v1/appliers/${id}/resume-profiles`).set("Authorization","Bearer token").send({resumeIds:[resumeId]}).expect(200).expect(({body})=>assert.equal(body.data[0].resumeId,resumeId));
  roles=["APPLYING_MANAGER"];
});

test("Application and bulk routes enforce roles and validate protected mutations",async()=>{
  const id="123e4567-e89b-42d3-a456-426614174000",resumeId="223e4567-e89b-42d3-a456-426614174000";
  roles=["APPLIER"];
  await request(app.getHttpServer()).get("/api/v1/applications/mine?status=ASSIGNED").set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.items.length,1));
  await request(app.getHttpServer()).post("/api/v1/applications").set("Authorization","Bearer token").send({jobDescriptionId:id,resumeId,priority:"NORMAL"}).expect(403);
  await request(app.getHttpServer()).patch(`/api/v1/applications/${id}/progress`).set("Authorization","Bearer token").send({status:"APPLIED",applicationUrl:"http://localhost:4174/#/applications?status=ASSIGNED"}).expect(200);
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
  await request(app.getHttpServer()).post(`/api/v1/applications/${id}/resume-access`).set("Authorization","Bearer token").expect(403);
  roles=["APPLIER"];
  await request(app.getHttpServer()).get(`/api/v1/applications/${id}/extension-context`).set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.permissions.canLoadResume,true));
  await request(app.getHttpServer()).post(`/api/v1/applications/${id}/extension-sessions`).set("Authorization","Bearer token").send({action:"AUTOFILL",unexpected:true}).expect(400);
  await request(app.getHttpServer()).post(`/api/v1/applications/${id}/extension-sessions`).set("Authorization","Bearer token").send({action:"AUTOFILL",extensionVersion:"0.8.5"}).expect(201).expect(({body})=>assert.equal(body.data.applicationId,id));
  await request(app.getHttpServer()).patch(`/api/v1/extension-sessions/${sessionId}`).set("Authorization","Bearer token").send({status:"TARGET_READY"}).expect(200).expect(({body})=>assert.equal(body.data.status,"TARGET_READY"));
  await request(app.getHttpServer()).patch(`/api/v1/extension-sessions/${sessionId}`).set("Authorization","Bearer token").send({status:"UNKNOWN"}).expect(400);
  const telemetry={resumeUpdatedAt:"2026-08-02T12:00:00Z",adapterId:"greenhouse",adapterVersion:"1.0.0",targetDomain:"job-boards.greenhouse.io",detectedCount:1,selectedCount:1,succeededCount:1,failedCount:0,unresolvedCount:0,fields:[{fieldKey:"candidate.email",fieldIndex:0,confidence:93,outcome:"VERIFIED",errorCode:"FIELD_VERIFIED"}]};
  await request(app.getHttpServer()).patch(`/api/v1/extension-sessions/${sessionId}/autofill-telemetry`).set("Authorization","Bearer token").send(telemetry).expect(200).expect(({body})=>assert.equal(body.data.targetDomain,"job-boards.greenhouse.io"));
  await request(app.getHttpServer()).patch(`/api/v1/extension-sessions/${sessionId}/autofill-telemetry`).set("Authorization","Bearer token").send({...telemetry,fields:[{...telemetry.fields[0],value:"secret"}]}).expect(400);
  roles=["DEVELOPER"];
  await request(app.getHttpServer()).patch(`/api/v1/extension-sessions/${sessionId}/autofill-telemetry`).set("Authorization","Bearer token").send(telemetry).expect(403);
  roles=["APPLIER"];
  await request(app.getHttpServer()).post(`/api/v1/applications/${id}/resume-access`).set("Authorization","Bearer token").send({resumeId:"223e4567-e89b-42d3-a456-426614174000"}).expect(400);
  await request(app.getHttpServer()).post(`/api/v1/applications/${id}/resume-access`).set("Authorization","Bearer token").expect(201).expect(({body})=>{assert.equal(body.data.filename,"candidate.pdf");assert.equal(body.data.fileSizeBytes,1024);});
  roles=["APPLYING_MANAGER"];
});

test("v0.8.8 Candidate Profile routes allow assigned Applier reads and manager review only",async()=>{
  const id="123e4567-e89b-42d3-a456-426614174000";
  roles=["APPLIER"];
  await request(app.getHttpServer()).get(`/api/v1/candidates/${id}/autofill-profile`).set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.reviewStatus,"NEEDS_REVIEW"));
  await request(app.getHttpServer()).patch(`/api/v1/candidates/${id}/profile`).set("Authorization","Bearer token").send({fullName:"Candidate",reviewStatus:"VERIFIED"}).expect(403);
  roles=["APPLYING_MANAGER"];
  await request(app.getHttpServer()).patch(`/api/v1/candidates/${id}/profile`).set("Authorization","Bearer token").send({fullName:"Candidate",reviewStatus:"VERIFIED",unexpected:true}).expect(400);
  await request(app.getHttpServer()).patch(`/api/v1/candidates/${id}/profile`).set("Authorization","Bearer token").send({fullName:"Candidate",reviewStatus:"VERIFIED"}).expect(200).expect(({body})=>assert.equal(body.data.reviewStatus,"VERIFIED"));
  await request(app.getHttpServer()).post(`/api/v1/candidates/${id}/employment`).set("Authorization","Bearer token").send({company:"Acme",jobTitle:"Engineer",isCurrent:true}).expect(201);
  await request(app.getHttpServer()).post(`/api/v1/candidates/${id}/education`).set("Authorization","Bearer token").send({institution:"State University"}).expect(201);
  await request(app.getHttpServer()).get(`/api/v1/resumes/${id}/autofill-profile`).set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.id,id));
  await request(app.getHttpServer()).patch(`/api/v1/resumes/${id}/autofill-profile`).set("Authorization","Bearer token").send({fullName:"Candidate",reviewStatus:"VERIFIED"}).expect(200);
  await request(app.getHttpServer()).patch(`/api/v1/resumes/${id}/structured-content`).set("Authorization","Bearer token").send({summary:"Summary",skills:"SQL",employment:[],education:[],certifications:[]}).expect(200).expect(({body})=>assert.equal(body.data.summary,"Summary"));
});

test("v0.8.9 Application Autofill context requires a validated active session identifier",async()=>{
  const id="123e4567-e89b-42d3-a456-426614174000",sessionId="323e4567-e89b-42d3-a456-426614174000";
  roles=["DEVELOPER"];
  await request(app.getHttpServer()).get(`/api/v1/applications/${id}/autofill-context?sessionId=${sessionId}`).set("Authorization","Bearer token").expect(403);
  roles=["APPLIER"];
  await request(app.getHttpServer()).get(`/api/v1/applications/${id}/autofill-context`).set("Authorization","Bearer token").expect(400);
  await request(app.getHttpServer()).get(`/api/v1/applications/${id}/autofill-context?sessionId=bad`).set("Authorization","Bearer token").expect(400);
  await request(app.getHttpServer()).get(`/api/v1/applications/${id}/autofill-context?sessionId=${sessionId}&resumeUpdatedAt=2026-07-29T00:00:00Z`).set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.values["candidate.email"],"person@example.com"));
  roles=["APPLYING_MANAGER"];
});

test("v0.9.0 Resume Answer Library is manager-only and validates fixed answer contracts",async()=>{
  const resumeId="123e4567-e89b-42d3-a456-426614174000",answerId="223e4567-e89b-42d3-a456-426614174000";
  roles=["APPLIER"];
  await request(app.getHttpServer()).get(`/api/v1/resumes/${resumeId}/application-answers`).set("Authorization","Bearer token").expect(403);
  roles=["APPLYING_MANAGER"];
  await request(app.getHttpServer()).get(`/api/v1/resumes/${resumeId}/application-answers`).set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data[0].answerKey,"authorized_to_work"));
  const valid={answerKey:"authorized_to_work",questionPatterns:["Are you legally authorized to work?"],answerType:"BOOLEAN",answerValue:true,reviewStatus:"VERIFIED",active:true};
  await request(app.getHttpServer()).post(`/api/v1/resumes/${resumeId}/application-answers`).set("Authorization","Bearer token").send(valid).expect(201);
  await request(app.getHttpServer()).patch(`/api/v1/resumes/${resumeId}/application-answers`).set("Authorization","Bearer token").send({answers:[valid,{...valid,answerKey:"requires_sponsorship",answerValue:false}]}).expect(200);
  await request(app.getHttpServer()).patch(`/api/v1/resumes/${resumeId}/application-answers`).set("Authorization","Bearer token").send({answers:[]}).expect(400);
  await request(app.getHttpServer()).patch(`/api/v1/resumes/${resumeId}/application-answers/${answerId}`).set("Authorization","Bearer token").send({...valid,unexpected:true}).expect(400);
  await request(app.getHttpServer()).post(`/api/v1/resumes/${resumeId}/application-answers`).set("Authorization","Bearer token").send({...valid,answerKey:"race"}).expect(400);
  await request(app.getHttpServer()).delete(`/api/v1/resumes/${resumeId}/application-answers/${answerId}`).set("Authorization","Bearer token").expect(200).expect(({body})=>assert.equal(body.data.active,false));
  roles=["APPLYING_MANAGER"];
});

test("v0.8 workload and bulk-assignment routes are manager-only and require idempotency",async()=>{
  const id="123e4567-e89b-42d3-a456-426614174000";
  roles=["APPLIER"];
  await request(app.getHttpServer()).get("/api/v1/appliers/workloads").set("Authorization","Bearer token").expect(403);
  await request(app.getHttpServer()).post("/api/v1/applications/bulk-assignment-preview").set("Authorization","Bearer token").send({strategy:"PROFILE",applicationIds:[id]}).expect(403);
  roles=["APPLYING_MANAGER"];
  await request(app.getHttpServer()).get("/api/v1/appliers/workloads?limit=25").set("Authorization","Bearer token").expect(200).expect(({body})=>{assert.equal(body.data.length,1);assert.equal(body.page.total,1);});
  await request(app.getHttpServer()).patch(`/api/v1/appliers/${id}/workload-settings`).set("Authorization","Bearer token").send({isAvailable:false,maxActiveApplications:10}).expect(200);
  await request(app.getHttpServer()).post("/api/v1/applications/bulk-assignment-preview").set("Authorization","Bearer token").send({strategy:"PROFILE",applicationIds:[id]}).expect(201);
  await request(app.getHttpServer()).post("/api/v1/applications/bulk-assign").set("Authorization","Bearer token").send({strategy:"PROFILE",assignments:[{applicationId:id,assignedTo:id}]}).expect(400);
  await request(app.getHttpServer()).post("/api/v1/applications/bulk-assign").set("Authorization","Bearer token").set("Idempotency-Key","assign_test_123").send({strategy:"PROFILE",assignments:[{applicationId:id,assignedTo:id}]}).expect(201);
  await request(app.getHttpServer()).get(`/api/v1/assignment-batches/${id}/results?limit=25`).set("Authorization","Bearer token").expect(200);
});

test("Profile, Admin, overview, and tailoring routes enforce the final backend boundary",async()=>{
  const id="123e4567-e89b-42d3-a456-426614174000",resumeId="223e4567-e89b-42d3-a456-426614174000";
  roles=[];
  await request(app.getHttpServer()).patch("/api/v1/profile").set("Authorization","Bearer token").send({fullName:"Name"}).expect(200);
  await request(app.getHttpServer()).get("/api/v1/admin/roles").set("Authorization","Bearer token").expect(403);
  roles=["APPLIER"];
  await request(app.getHttpServer()).get("/api/v1/business-overview?from=2026-08-13T04:00:00.000Z&to=2026-08-14T04:00:00.000Z").set("Authorization","Bearer token").expect(200);
  await request(app.getHttpServer()).get("/api/v1/tailoring-jobs?status=PENDING").set("Authorization","Bearer token").expect(200);
  await request(app.getHttpServer()).post("/api/v1/tailoring-jobs").set("Authorization","Bearer token").send({jobDescriptionId:id,matches:[{resumeId,matchScore:80,matchDetails:{eligible:true}}]}).expect(403);
  await request(app.getHttpServer()).patch(`/api/v1/tailoring-jobs/${id}/review`).set("Authorization","Bearer token").send({action:"APPROVE",expectedUpdatedAt:"2026-08-03T12:00:00.000Z",preview:{}}).expect(403);
  await request(app.getHttpServer()).get(`/api/v1/tailoring-jobs/${id}/reviews`).set("Authorization","Bearer token").expect(403);
  await request(app.getHttpServer()).post(`/api/v1/tailoring-jobs/${id}/runner-ticket`).set("Authorization","Bearer token").expect(403);
  await request(app.getHttpServer()).post("/api/v1/tailoring-jobs/bulk-request").set("Authorization","Bearer token").send({applicationIds:[id]}).expect(403);
  await request(app.getHttpServer()).post("/api/v1/tailoring-jobs/bulk-runner-tickets").set("Authorization","Bearer token").send({jobIds:[id]}).expect(403);
  await request(app.getHttpServer()).post(`/api/v1/tailoring-jobs/${id}/materialize`).set("Authorization","Bearer token").expect(403);
  await request(app.getHttpServer()).patch(`/api/v1/tailoring-jobs/${id}/format`).set("Authorization","Bearer token").send({renderFormat:"PDF",expectedUpdatedAt:"2026-08-03T12:00:00.000Z"}).expect(403);
  roles=["ADMIN"];
  await request(app.getHttpServer()).get("/api/v1/admin/roles").set("Authorization","Bearer token").expect(200);
  await request(app.getHttpServer()).get("/api/v1/admin/users?page=1&pageSize=25").set("Authorization","Bearer token").expect(200);
  await request(app.getHttpServer()).patch(`/api/v1/admin/users/${id}/profile`).set("Authorization","Bearer token").send({fullName:"Alex Applier"}).expect(200);
  await request(app.getHttpServer()).post("/api/v1/tailoring-jobs").set("Authorization","Bearer token").send({jobDescriptionId:id,matches:[{resumeId,matchScore:80,matchDetails:{eligible:true}}]}).expect(201);
  await request(app.getHttpServer()).post("/api/v1/tailoring-jobs").set("Authorization","Bearer token").send({jobDescriptionId:id,matches:[{resumeId:"bad",matchScore:101,matchDetails:{}}]}).expect(400);
  await request(app.getHttpServer()).post(`/api/v1/tailoring-jobs/application/${id}`).set("Authorization","Bearer token").expect(201);
  await request(app.getHttpServer()).post(`/api/v1/tailoring-jobs/${id}/runner-ticket`).set("Authorization","Bearer token").expect(201);
  await request(app.getHttpServer()).post("/api/v1/tailoring-jobs/bulk-request").set("Authorization","Bearer token").send({applicationIds:[id]}).expect(201);
  await request(app.getHttpServer()).post("/api/v1/tailoring-jobs/bulk-runner-tickets").set("Authorization","Bearer token").send({jobIds:[id]}).expect(201);
  await request(app.getHttpServer()).post("/api/v1/tailoring-jobs/bulk-runner-tickets").set("Authorization","Bearer token").send({jobIds:[]}).expect(400);
  await request(app.getHttpServer()).get(`/api/v1/tailoring-jobs/${id}/input`).set("Authorization","Bearer token").expect(200);
  await request(app.getHttpServer()).put(`/api/v1/tailoring-jobs/${id}/preview`).set("Authorization","Bearer token").send({generatedAt:"2026-08-03T12:00:00.000Z",result:{summary:"A valid tailored summary.",professionalExperience:[{sourceExperienceId:"experience-1",tailoredDetails:"Supported source details."}],skills:["SQL"],changeSummary:[],unsupportedRequirements:[],warnings:[]}}).expect(200);
  await request(app.getHttpServer()).patch(`/api/v1/tailoring-jobs/${id}/review`).set("Authorization","Bearer token").send({action:"APPROVE",expectedUpdatedAt:"2026-08-03T12:00:00.000Z",notes:"Reviewed",preview:{summary:"A valid tailored summary.",professionalExperience:[{sourceExperienceId:"experience-1",tailoredDetails:"Supported source details."}],skills:["SQL"],changeSummary:[],unsupportedRequirements:[],warnings:[]}}).expect(200);
  await request(app.getHttpServer()).get("/api/v1/tailoring-jobs/templates").set("Authorization","Bearer token").expect(200);
  await request(app.getHttpServer()).patch(`/api/v1/tailoring-jobs/${id}/format`).set("Authorization","Bearer token").send({renderFormat:"ZIP",expectedUpdatedAt:"2026-08-03T12:00:00.000Z"}).expect(400);
  await request(app.getHttpServer()).patch(`/api/v1/tailoring-jobs/${id}/format`).set("Authorization","Bearer token").send({renderFormat:"PDF",expectedUpdatedAt:"2026-08-03T12:00:00.000Z"}).expect(200).expect(({body})=>assert.equal(body.data.renderFormat,"PDF"));
  await request(app.getHttpServer()).post(`/api/v1/tailoring-jobs/${id}/materialize`).set("Authorization","Bearer token").expect(201).expect(({body})=>assert.equal(body.data.tailoredResumeNumber,42));
  await request(app.getHttpServer()).get(`/api/v1/tailoring-jobs/${id}/reviews`).set("Authorization","Bearer token").expect(200);
  await request(app.getHttpServer()).get(`/api/v1/tailoring-jobs/${id}`).set("Authorization","Bearer token").expect(200);
  roles=["APPLYING_MANAGER"];
});

test("v1.5 runner endpoints accept only a bounded job capability and need no user token",async()=>{
  const ticket=`trt_${"a".repeat(43)}`,preview={summary:"A valid tailored summary.",professionalExperience:[{sourceExperienceId:"experience-1",tailoredDetails:"Supported source details."}],skills:["SQL"],changeSummary:[],unsupportedRequirements:[],warnings:[]};
  await request(app.getHttpServer()).post("/api/v1/tailoring-runner/claim").send({ticket}).expect(201);
  await request(app.getHttpServer()).put("/api/v1/tailoring-runner/preview").send({ticket,generatedAt:"2026-08-03T12:00:00.000Z",result:preview}).expect(200);
  await request(app.getHttpServer()).post("/api/v1/tailoring-runner/failure").send({ticket,failureCode:"CODEX_FAILED"}).expect(201);
  await request(app.getHttpServer()).post("/api/v1/tailoring-runner/claim").send({ticket:"bad",unexpected:true}).expect(400);
});

test("v2.1 tailoring batches are manager-only while runner tickets are bounded public capabilities",async()=>{
  const id="123e4567-e89b-42d3-a456-426614174000",ticket=`trb_${"c".repeat(43)}`,lease="223e4567-e89b-42d3-a456-426614174000";
  roles=["APPLIER"];
  await request(app.getHttpServer()).get("/api/v1/tailoring-batches").set("Authorization","Bearer token").expect(403);
  await request(app.getHttpServer()).post("/api/v1/tailoring-batches").set("Authorization","Bearer token").send({applicationIds:[id]}).expect(403);
  roles=["APPLYING_MANAGER"];
  await request(app.getHttpServer()).post("/api/v1/tailoring-batches").set("Authorization","Bearer token").send({applicationIds:[id]}).expect(201).expect(({body})=>assert.equal(body.data.selected_count,2));
  await request(app.getHttpServer()).get(`/api/v1/tailoring-batches/${id}`).set("Authorization","Bearer token").expect(200);
  await request(app.getHttpServer()).post(`/api/v1/tailoring-batches/${id}/runner-ticket`).set("Authorization","Bearer token").expect(201);
  await request(app.getHttpServer()).post("/api/v1/tailoring-batches").set("Authorization","Bearer token").send({applicationIds:[]}).expect(400);
  await request(app.getHttpServer()).post("/api/v1/tailoring-batch-runner/claim").send({ticket}).expect(201);
  await request(app.getHttpServer()).post("/api/v1/tailoring-batch-runner/next").send({ticket}).expect(201).expect(({body})=>assert.equal(body.data.state,"COMPLETED"));
  await request(app.getHttpServer()).post("/api/v1/tailoring-batch-runner/failure").send({ticket,itemId:id,leaseToken:lease,stage:"CODEX_GENERATION",code:"PROVIDER_RATE_LIMIT",message:"429 retry after 60 seconds",retryable:true,rateLimited:true,retryAfterSeconds:60}).expect(201).expect(({body})=>assert.equal(body.data.status,"WAITING_RETRY"));
  await request(app.getHttpServer()).post("/api/v1/tailoring-batch-runner/claim").send({ticket:"bad"}).expect(400);
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
