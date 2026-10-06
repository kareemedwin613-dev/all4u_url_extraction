import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { ScreenshotReviewController, ScreenshotReviewManageDto, ScreenshotReviewRunnerDto, ScreenshotReviewService } from "../src/screenshot-review/screenshot-review.module.js";
import { DtoValidationPipe } from "../src/common/validation/dto-validation.pipe.js";
import { REQUIRED_ROLES } from "../src/auth/require-roles.decorator.js";
const id="123e4567-e89b-42d3-a456-426614174000";
test("screenshot review management is manager-only; scope and 1000-item cap cannot be overridden",async()=>{
  assert.deepEqual(Reflect.getMetadata(REQUIRED_ROLES,ScreenshotReviewController),["APPLYING_MANAGER","ADMIN"]);
  const pipe=new DtoValidationPipe(ScreenshotReviewManageDto);
  await pipe.transform({operation:"create",applicationIds:[id],model:"test-vision"});
  await assert.rejects(pipe.transform({operation:"create",applicationIds:Array(1001).fill(id),model:"test-vision"}));
  await assert.rejects(pipe.transform({operation:"create",applicationIds:[id],createdBy:id}));
  await assert.rejects(pipe.transform({operation:"create",model:'test;command'}));
  await assert.rejects(new DtoValidationPipe(ScreenshotReviewRunnerDto).transform({operation:"submit",ticket:"invalid"}));
});
test("scoped anonymous runner and authenticated management use distinct RPCs",async()=>{
  const calls:any[]=[];const client={rpc:async(name:string,args:any)=>{calls.push({name,args});return {data:{done:true}};}};
  const service=new ScreenshotReviewService({anonymous:()=>client,forUser:(token:string)=>{assert.equal(token,"user-token");return client;}} as any);
  await service.call({operation:"create",applicationIds:[id],model:"test-vision"},"user-token");
  await service.call({operation:"next",ticket:"ticket"});
  assert.equal(calls[0].name,"screenshot_review_manage");assert.equal(calls[1].name,"screenshot_review_runner");assert.equal(calls[1].args.p_body.ticket,undefined);
  await assert.rejects(service.call({operation:"submit",ticket:"ticket"}),(e:any)=>e.code==="SCREENSHOT_REVIEW_INVALID");
  await assert.rejects(service.call({operation:"create",applicationIds:[id]},"user-token"),(e:any)=>e.code==="SCREENSHOT_REVIEW_INVALID");
});
test("runner errors are actionable without exposing SQL internals",async()=>{
  let error={code:"P0001",message:"SCREENSHOT_REVIEW_LEASE_EXPIRED: Retry."};
  const service=new ScreenshotReviewService({anonymous:()=>({rpc:async()=>({error})})} as any);
  await assert.rejects(service.call({operation:"next",ticket:"ticket"}),(e:any)=>e.code==="SCREENSHOT_REVIEW_LEASE_EXPIRED"&&e.getStatus()===409);
  error={code:"XX000",message:"internal private database context"};
  await assert.rejects(service.call({operation:"next",ticket:"ticket"}),(e:any)=>!e.message.includes("private"));
});
