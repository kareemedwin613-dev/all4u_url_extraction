import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationService } from "../src/applications/application.service.js";
import { TailoringBatchService } from "../src/platform/tailoring-batch.service.js";

const user={id:"11111111-1111-4111-8111-111111111111",token:"jwt",claims:{}},applicationId="22222222-2222-4222-8222-222222222222",jobId="33333333-3333-4333-8333-333333333333";

test("Application lists include the existing tailoring status and review job",async()=>{
  const calls:string[]=[];
  const service=new ApplicationService({forUser:()=>({rpc:async(name:string)=>{
    calls.push(name);
    if(name==="list_applications_v07")return{data:{items:[{id:applicationId,status:"ASSIGNED"}],total:1},error:null};
    return{data:[{applicationId,tailoringJobId:jobId,status:"APPROVED"}],error:null};
  }})}as any);
  const result=await service.list(user,{page:1,pageSize:25});
  assert.deepEqual(calls,["list_applications_v07","get_application_tailoring_statuses_v32"]);
  assert.equal(result.items[0].tailoring_status,"APPROVED");
  assert.equal(result.items[0].tailoring_job_id,jobId);
});

test("batch creation uses the approved-aware v3.2 RPC",async()=>{
  let call:any;
  const service=new TailoringBatchService({forUser:()=>({rpc:async(name:string,args:any)=>{call={name,args};return{data:{id:"batch"},error:null};}})}as any);
  await service.create(user,{applicationIds:[applicationId]});
  assert.equal(call.name,"create_tailoring_batch_v32");
  assert.deepEqual(call.args.p_application_ids,[applicationId]);
});
