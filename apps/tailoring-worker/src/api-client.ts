import type{TailoringInput,TailoringPreview}from"./types.js";
import{validateTailoringInput}from"./validation.js";

type Fetcher=typeof fetch;
const base=(value:string)=>{const url=new URL(value);if(url.protocol!=="https:"&&!(url.protocol==="http:"&&["localhost","127.0.0.1"].includes(url.hostname)))throw new Error("Tailoring API base URL must use HTTPS, except for localhost development.");return url.href.replace(/\/$/,"");};
async function call(apiBaseUrl:string,accessToken:string,path:string,init:RequestInit={},fetcher:Fetcher=fetch){
  if(accessToken.trim().length<20)throw new Error("TAILORING_ACCESS_TOKEN is missing or invalid.");
  const response=await fetcher(`${base(apiBaseUrl)}/api/v1${path}`,{...init,headers:{Accept:"application/json",Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json",...(init.headers||{})},signal:AbortSignal.timeout(30000)});
  const body:any=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(`${body?.code||"TAILORING_API_ERROR"}: ${body?.message||`Tailoring API returned HTTP ${response.status}.`}${body?.requestId?` Request ID: ${body.requestId}`:""}`);
  return body?.data;
}
async function ticketCall(apiBaseUrl:string,path:string,body:Record<string,unknown>,method:"POST"|"PUT",fetcher:Fetcher=fetch){
  const response=await fetcher(`${base(apiBaseUrl)}/api/v1${path}`,{method,headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const payload:any=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(`${payload?.code||"TAILORING_RUNNER_ERROR"}: ${payload?.message||`Tailoring runner API returned HTTP ${response.status}.`}${payload?.requestId?` Request ID: ${payload.requestId}`:""}`);
  return payload?.data;
}

export async function loadTailoringJobInput(apiBaseUrl:string,accessToken:string,jobId:string,fetcher:Fetcher=fetch):Promise<TailoringInput>{
  const data=await call(apiBaseUrl,accessToken,`/tailoring-jobs/${encodeURIComponent(jobId)}/input`,{},fetcher);
  if(data?.jobId!==jobId)throw new Error("Tailoring API returned a mismatched job ID.");
  return validateTailoringInput(data?.input);
}

export async function submitTailoringJobPreview(apiBaseUrl:string,accessToken:string,jobId:string,preview:TailoringPreview,fetcher:Fetcher=fetch){
  return call(apiBaseUrl,accessToken,`/tailoring-jobs/${encodeURIComponent(jobId)}/preview`,{method:"PUT",body:JSON.stringify({generatedAt:preview.generatedAt,result:preview.result})},fetcher);
}

export async function claimTailoringRunnerTicket(apiBaseUrl:string,ticket:string,fetcher:Fetcher=fetch):Promise<{jobId:string;input:TailoringInput;runExpiresAt:string}>{
  if(!/^trt_[A-Za-z0-9_-]{43}$/.test(ticket))throw new Error("The tailoring runner ticket is invalid.");
  const data=await ticketCall(apiBaseUrl,"/tailoring-runner/claim",{ticket},"POST",fetcher);
  if(typeof data?.jobId!=="string")throw new Error("Tailoring runner API returned an invalid job.");
  return{jobId:data.jobId,input:validateTailoringInput(data.input),runExpiresAt:String(data.runExpiresAt||"")};
}
export const submitTailoringRunnerPreview=(apiBaseUrl:string,ticket:string,preview:TailoringPreview,fetcher:Fetcher=fetch)=>ticketCall(apiBaseUrl,"/tailoring-runner/preview",{ticket,generatedAt:preview.generatedAt,result:preview.result},"PUT",fetcher);
export const reportTailoringRunnerFailure=(apiBaseUrl:string,ticket:string,failureCode:string,fetcher:Fetcher=fetch)=>ticketCall(apiBaseUrl,"/tailoring-runner/failure",{ticket,failureCode},"POST",fetcher);

export interface TailoringBatchJob {
  state:"JOB";
  batchId:string;
  itemId:string;
  jobId:string;
  leaseToken:string;
  leaseExpiresAt:string;
  attemptNumber:number;
  input:TailoringInput;
}
export type TailoringBatchNext=TailoringBatchJob|{state:string;[key:string]:unknown};

export async function claimTailoringBatchTicket(apiBaseUrl:string,ticket:string,fetcher:Fetcher=fetch){
  if(!/^trb_[A-Za-z0-9_-]{43}$/.test(ticket))throw new Error("The tailoring batch runner ticket is invalid.");
  return ticketCall(apiBaseUrl,"/tailoring-batch-runner/claim",{ticket},"POST",fetcher);
}
export async function nextTailoringBatchItem(apiBaseUrl:string,ticket:string,fetcher:Fetcher=fetch):Promise<TailoringBatchNext>{
  const data=await ticketCall(apiBaseUrl,"/tailoring-batch-runner/next",{ticket},"POST",fetcher);
  if(data?.state==="JOB")return{...data,input:validateTailoringInput(data.input)};
  if(typeof data?.state!=="string")throw new Error("Tailoring batch runner returned an invalid state.");
  return data;
}
export const submitTailoringBatchPreview=(apiBaseUrl:string,ticket:string,itemId:string,leaseToken:string,preview:TailoringPreview,fetcher:Fetcher=fetch)=>ticketCall(apiBaseUrl,"/tailoring-batch-runner/preview",{ticket,itemId,leaseToken,generatedAt:preview.generatedAt,result:preview.result},"POST",fetcher);
export const reportTailoringBatchFailure=(apiBaseUrl:string,ticket:string,itemId:string,leaseToken:string,failure:{stage:string;code:string;message:string;retryable:boolean;rateLimited:boolean;retryAfterSeconds?:number},fetcher:Fetcher=fetch)=>ticketCall(apiBaseUrl,"/tailoring-batch-runner/failure",{ticket,itemId,leaseToken,...failure},"POST",fetcher);
