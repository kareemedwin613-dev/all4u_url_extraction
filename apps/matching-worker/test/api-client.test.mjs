import test from "node:test";
import assert from "node:assert/strict";
import { createMatchingApiClient, matchingApiBase } from "../src/api-client.mjs";
import { readRunnerArguments, readMatchingConfiguration, matchingErrorMessage } from "../src/configuration.mjs";
const ticket="mrb_"+"x".repeat(43),id="123e4567-e89b-42d3-a456-426614174000";

test("runner configuration takes the dashboard command, not Supabase credentials",()=>{
  assert.deepEqual(readRunnerArguments(["--batch-ticket",ticket,"--api-base-url","https://api.example.com/"],{}),{ticket,apiBaseUrl:"https://api.example.com",once:false});
  assert.equal(readRunnerArguments(["--once"],{MATCHING_BATCH_TICKET:ticket,MATCHING_API_BASE_URL:"http://localhost:3000"}).once,true);
  assert.equal(readMatchingConfiguration({}).providerName,"codex");
  for(const args of [[],["--batch-ticket"],["--batch-ticket","bad"],["--api-base-url","https://api.example.com","--unknown","x"],
    ["--batch-ticket",ticket,"--batch-ticket",ticket]]) assert.throws(()=>readRunnerArguments(args,{}));
  for(const url of ["http://api.example.com","https://api.example.com/path","https://user:password@api.example.com","https://api.example.com?token=x",'https://api.example.com/`run`']) assert.throws(()=>matchingApiBase(url));
});

test("ticket transport puts capabilities in JSON bodies only and rejects redirects",async()=>{
  const calls=[];
  const api=createMatchingApiClient({apiBaseUrl:"https://api.example.com",ticket,fetchImpl:async(url,options)=>{
    calls.push({url,options});return new Response(JSON.stringify({data:true}));
  }});
  await api.claim();
  await api.rpc("claim_application_match_document",{p_id:id},{id,leaseToken:id});
  await api.rpc("complete_application_match_document",{p_id:id,p_lease_token:id,p_analysis:null},{id,leaseToken:id});
  await api.rpc("complete_application_match",{p_id:id,p_lease_token:id,p_result:{sufficient:false}});
  await api.rpc("fail_application_match",{p_id:id,p_lease_token:id,p_code:"MODEL_TIMEOUT",p_retryable:true,p_retry_after:30});
  for(const {url,options} of calls) {
    assert.equal(url.includes(ticket),false);assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.apikey,undefined);
    assert.equal(options.redirect,"error");assert.equal(JSON.parse(options.body).ticket,ticket);
  }
  assert.deepEqual(JSON.parse(calls[1].options.body),{ticket,jobId:id,leaseToken:id,documentId:id});
  await assert.rejects(api.rpc("claim_application_match_document",{p_id:id}),/MATCH_TICKET_SCOPE/);
  await assert.rejects(api.rpc("arbitrary_sql",{}),/MATCH_INVALID_REQUEST/);
  assert.equal(calls.length,5);
});

test("next distinguishes waiting/retry from a finished selection",async()=>{
  const states=[{state:"WAITING",retryAfterSeconds:900},{state:"COMPLETED",pendingCount:0,failedCount:1}];
  const api=createMatchingApiClient({apiBaseUrl:"https://api.example.com",ticket,fetchImpl:async()=>new Response(JSON.stringify({data:states.shift()}))});
  assert.equal(await api.rpc("claim_application_match",{}),null);assert.equal(api.finished,false);assert.equal(api.retryAfterSeconds,60);
  assert.equal(await api.rpc("claim_application_match",{}),null);assert.equal(api.finished,true);assert.equal(api.receipt.failedCount,1);
});

test("expired/invalid tickets stop processing while transport failures remain retryable and sanitized",async()=>{
  for(const [status,code,retryable,stops] of [[410,"MATCH_TICKET_EXPIRED",false,true],[403,"MATCH_TICKET_SCOPE",false,true],
    [409,"MATCH_WORKER_VERSION_MISMATCH",false,true],[429,"MATCH_API_RATE_LIMIT",true,false],[503,"MATCH_API_ERROR",true,false]]) {
    const api=createMatchingApiClient({apiBaseUrl:"https://api.example.com",ticket,fetchImpl:async()=>new Response(JSON.stringify({code,message:`private ${ticket}`}),{status,headers:{"retry-after":"30"}})});
    await assert.rejects(api.claim(),error=>error.code===code&&error.retryable===retryable&&Boolean(error.stopWorker)===stops&&!matchingErrorMessage(error).includes(ticket));
  }
  const api=createMatchingApiClient({apiBaseUrl:"https://api.example.com",ticket,fetchImpl:async()=>{throw Error(ticket);}});
  await assert.rejects(api.claim(),error=>error.code==="MATCH_API_NETWORK_ERROR"&&error.retryable&&!error.message.includes(ticket));
});
