import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { JdReviewController, JdReviewManageDto, JdReviewRunnerDto, JdReviewService } from "../src/job-descriptions/jd-review.controller.js";
import { DtoValidationPipe } from "../src/common/validation/dto-validation.pipe.js";
import { REQUIRED_ROLES } from "../src/auth/require-roles.decorator.js";
const id="123e4567-e89b-42d3-a456-426614174000";
test("manager-only review control, DTO input caps and forbidden overrides", async () => {
  assert.deepEqual(Reflect.getMetadata(REQUIRED_ROLES,JdReviewController),["APPLYING_MANAGER","ADMIN"]);
  const pipe=new DtoValidationPipe(JdReviewManageDto);
  await pipe.transform({operation:"create",jobDescriptionIds:[id]});
  await assert.rejects(pipe.transform({operation:"create",jobDescriptionIds:Array(1001).fill(id)}));
  await assert.rejects(pipe.transform({operation:"create",jobDescriptionIds:[id],createdBy:id}));
  await assert.rejects(new DtoValidationPipe(JdReviewRunnerDto).transform({operation:"submit",ticket:"invalid"}));
});
test("runner uses anonymous scoped RPC and managers use their own user token", async () => {
  const calls:any[]=[];
  const client={rpc:async(name:string,args:any)=>{calls.push({name,args});return {data:{ok:true}};}};
  const service=new JdReviewService({anonymous:()=>client,forUser:(token:string)=>{assert.equal(token,"user-token");return client;}} as any);
  await service.call({operation:"create",jobDescriptionIds:[id]},"user-token");
  await service.call({operation:"next",ticket:"ticket"});
  assert.equal(calls[0].name,"jd_review_manage"); assert.equal(calls[1].name,"jd_review_runner");
  assert.equal(calls[1].args.p_ticket,"ticket"); assert.equal(calls[1].args.p_body.ticket,undefined);
  await assert.rejects(service.call({operation:"submit",ticket:"ticket"}), (e:any)=>e.code==="JD_REVIEW_INVALID");
});
test("known errors preserve actionable codes but do not leak database internals", async () => {
  let error={code:"P0001",message:"JD_REVIEW_LEASE_EXPIRED: Retry the item."};
  const service=new JdReviewService({anonymous:()=>({rpc:async()=>({error})})} as any);
  await assert.rejects(service.call({operation:"next",ticket:"ticket"}),(e:any)=>e.code==="JD_REVIEW_LEASE_EXPIRED" && e.getStatus()===409);
  error={code:"XX000",message:"internal sensitive database context"};
  await assert.rejects(service.call({operation:"next",ticket:"ticket"}),(e:any)=>!e.message.includes("sensitive"));
});
