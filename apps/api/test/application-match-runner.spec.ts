import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { ApplicationMatchRunnerService } from "../src/application-batches/application-match-runner.service.js";
import { MatchRunnerTicketDto, MatchRunnerNextDto, MatchRunnerDocumentDto, MatchRunnerDocumentResultDto, MatchRunnerResultDto, MatchRunnerFailureDto } from "../src/application-batches/application-match-runner.dto.js";
import { JsonLogger } from "../src/common/logging/json-logger.service.js";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { ApplicationMatchRunnerController } from "../src/application-batches/application-match-runner.controller.js";
import { ApiExceptionFilter } from "../src/common/errors/api-exception.filter.js";
const ticket="mrb_"+"t".repeat(43), jobId="123e4567-e89b-42d3-a456-426614174000", leaseToken="223e4567-e89b-42d3-a456-426614174000";

test("runner DTOs require ticket, exact operation fields, valid job/document IDs and leases",async()=>{
  const good:[any,any][]=[
    [MatchRunnerTicketDto,{ticket}],
    [MatchRunnerNextDto,{ticket,modelId:"test-model",rubricVersion:"match-v1",extractorVersion:"facts-v1",scoringMode:"direct-v1"}],
    [MatchRunnerDocumentDto,{ticket,jobId,leaseToken,documentId:jobId}],
    [MatchRunnerDocumentResultDto,{ticket,jobId,leaseToken,documentId:jobId,documentLeaseToken:leaseToken,analysis:null}],
    [MatchRunnerResultDto,{ticket,jobId,leaseToken,result:{}}],
    [MatchRunnerFailureDto,{ticket,jobId,leaseToken,code:"MODEL_RATE_LIMIT",retryable:true,retryAfterSeconds:60}],
  ];
  for(const [type,body] of good) {
    const options={whitelist:true,forbidNonWhitelisted:true};
    assert.equal((await validate(plainToInstance(type,body),options)).length,0);
    assert.ok((await validate(plainToInstance(type,{...body,ticket:"bad"}),options)).length);
    assert.ok((await validate(plainToInstance(type,{...body,rawSql:"ignored",serviceKey:"forbidden"}),options)).length);
  }
  assert.ok((await validate(plainToInstance(MatchRunnerResultDto,{ticket,jobId,leaseToken:"bad",result:{}}))).length);
  assert.ok((await validate(plainToInstance(MatchRunnerNextDto,{ticket,modelId:"test-model",rubricVersion:"match-v1",extractorVersion:"facts-v1"}))).length);
  assert.ok((await validate(plainToInstance(MatchRunnerFailureDto,{ticket,jobId,leaseToken,code:"private source text",retryable:true,retryAfterSeconds:901}))).length);
});

test("archived runner refuses calls without contacting the database",async()=>{
  const calls:any[]=[];
  const service=new ApplicationMatchRunnerService({anonymous:()=>({rpc:async(name:string,args:any)=>{calls.push({name,args});return{data:{state:"WAITING"},error:null};}}),forUser:()=>{throw Error("Not the user session path");}} as any);
  const payload={ticket,jobId,leaseToken,documentId:jobId};
  await assert.rejects(service.call("document",payload), (error:any)=>error.code==="EVALUATION_ARCHIVED");
  assert.deepEqual(calls,[]);
  await assert.rejects(service.call("arbitrary_sql",payload));
  await assert.rejects(service.call("result",{ticket,result:{value:"x".repeat(160001)}}));
  assert.equal(calls.length,0);
});

test("runner errors do not expose ticket, source text or raw database diagnostics",async()=>{
  for(const [error,expected,status] of [[{message:`MATCH_TICKET_EXPIRED: ${ticket}`},"MATCH_TICKET_EXPIRED",410],
    [{message:"MATCH_TICKET_SCOPE: private source"},"MATCH_TICKET_SCOPE",403],
    [{code:"PGRST202"},"DATABASE_MIGRATION_REQUIRED",503],[{message:`raw private ${ticket}`},"MATCH_RUNNER_DATABASE_ERROR",502]] as const) {
    const service=new ApplicationMatchRunnerService({anonymous:()=>({rpc:async()=>({error})})} as any);
    await assert.rejects(service.call("claim",{ticket}),(failure:any)=>failure.code==="EVALUATION_ARCHIVED"&&failure.getStatus()===410&&!failure.message.includes(ticket)&&!failure.message.includes("private source"));
  }
});

test("structured logs redact ticket fields including nested runner responses",t=>{
  const logs:string[]=[];const original=console.log;t.after(()=>{console.log=original;});console.log=(value)=>logs.push(value);
  new JsonLogger().log("runner",{runner:{ticket},batchTicket:ticket,token:ticket});
  assert.equal(logs.length,1);assert.equal(logs[0].includes(ticket),false);
});

test("HTTP runner routes return archive errors for valid tickets and still reject malformed bodies",async t=>{
  const calls:{operation:string;body:unknown}[]=[];
  const module=await Test.createTestingModule({controllers:[ApplicationMatchRunnerController],providers:[{
    provide:ApplicationMatchRunnerService,useValue:new ApplicationMatchRunnerService({anonymous:()=>{
      throw Error("Archived runner must not access the database");
    }} as any),
  }]}).compile();
  const app=module.createNestApplication();
  app.setGlobalPrefix("api/v1");app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();t.after(()=>app.close());
  const operations:[string,Record<string,unknown>][]=[
    ["claim",{ticket}],
    ["next",{ticket,modelId:"test-model",rubricVersion:"match-v1",extractorVersion:"facts-v1",scoringMode:"direct-v1"}],
    ["document",{ticket,jobId,leaseToken,documentId:jobId}],
    ["document-result",{ticket,jobId,leaseToken,documentId:jobId,documentLeaseToken:leaseToken,analysis:null}],
    ["result",{ticket,jobId,leaseToken,result:{sufficient:false}}],
    ["failure",{ticket,jobId,leaseToken,code:"MODEL_RATE_LIMIT",retryable:true,retryAfterSeconds:60}],
  ];
  for(const [operation,body] of operations) {
    const response=await request(app.getHttpServer()).post(`/api/v1/application-match-runner/${operation}`).send(body).expect(410);
    assert.equal(response.body.code,"EVALUATION_ARCHIVED");
    await request(app.getHttpServer()).post(`/api/v1/application-match-runner/${operation}`).send({...body,ticket:"invalid"}).expect(400);
    await request(app.getHttpServer()).post(`/api/v1/application-match-runner/${operation}`).send({...body,sql:"forbidden"}).expect(400);
  }
  assert.equal(calls.length,0);
  await request(app.getHttpServer()).post("/api/v1/application-match-runner/claim").send({}).expect(400);
  await request(app.getHttpServer()).post("/api/v1/application-match-runner/arbitrary").send({ticket}).expect(404);
});
