import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";

Object.assign(process.env, {
  NODE_ENV:"test",PORT:"3003",API_BASE_PATH:"api/v1",CORS_ORIGINS:"http://localhost:4173",
  SUPABASE_URL:"https://example.supabase.co",SUPABASE_ANON_OR_PUBLISHABLE_KEY:"publishable-test-key-with-safe-length",
  SUPABASE_JWT_ISSUER:"https://example.supabase.co/auth/v1",SUPABASE_JWKS_URL:"https://example.supabase.co/auth/v1/.well-known/jwks.json",
  RATE_LIMIT_TTL_MS:"60000",RATE_LIMIT_MAX:"60",INGESTION_RATE_LIMIT_MAX:"20",LOG_LEVEL:"info",SWAGGER_ENABLED:"true",
});

const { BulkCreateDto, BulkPreviewDto, BatchListQueryDto } = await import("../src/application-batches/application-batches.dto.js");
const { ApplicationBatchesService } = await import("../src/application-batches/application-batches.service.js");
const jd="123e4567-e89b-42d3-a456-426614174000",resume="223e4567-e89b-42d3-a456-426614174000",user={id:"user",token:"jwt",claims:{}};

test("v0.7.4 DTOs bound IDs, pairs, cursors, and reject protected unknown fields",async()=>{
  assert.equal((await validate(plainToInstance(BulkPreviewDto,{jobDescriptionIds:[jd]}))).length,0);
  assert.ok((await validate(plainToInstance(BulkPreviewDto,{jobDescriptionIds:Array(101).fill(jd)}))).length);
  assert.equal((await validate(plainToInstance(BulkCreateDto,{combinations:[{jobDescriptionId:jd,resumeId:resume}]}))).length,0);
  assert.ok((await validate(plainToInstance(BulkCreateDto,{combinations:[{jobDescriptionId:"bad",resumeId:resume}]}))).length);
  assert.ok((await validate(plainToInstance(BatchListQueryDto,{sort:"raw_sql"}))).length);
});

test("bulk service deduplicates pairs and hashes normalized payload for one idempotent RPC",async()=>{
  let call:any;
  const repository={rpc:async(_user:any,name:string,args:any)=>{call={name,args};return{batchId:jd,batchName:"Batch",status:"COMPLETED",selectedJdCount:1,requestedCount:1,createdCount:1,duplicateCount:0,skippedCount:0,failedCount:0,replayed:false,results:[]};}};
  const service=new ApplicationBatchesService(repository as any,{log:()=>{}} as any);
  const result=await service.create(user as any,{batchName:" Batch ",combinations:[{jobDescriptionId:jd,resumeId:resume},{jobDescriptionId:jd,resumeId:resume}]},"bulk_request_1","req_1");
  assert.equal(call.name,"create_applications_bulk_api");assert.equal(call.args.p_combinations.length,1);assert.match(call.args.p_request_hash,/^[0-9a-f]{64}$/);assert.equal(result.createdCount,1);
});

test("opaque cursor validation rejects tampering before a database call",async()=>{
  const service=new ApplicationBatchesService({rpc:async()=>{throw new Error("should not run");}} as any,{log:()=>{}} as any);
  await assert.rejects(()=>service.list(user as any,{cursor:"not-a-cursor",limit:25,page:1}),(error:any)=>error.code==="VALIDATION_ERROR");
});
