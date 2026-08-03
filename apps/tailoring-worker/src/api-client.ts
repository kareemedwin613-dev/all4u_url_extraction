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

export async function loadTailoringJobInput(apiBaseUrl:string,accessToken:string,jobId:string,fetcher:Fetcher=fetch):Promise<TailoringInput>{
  const data=await call(apiBaseUrl,accessToken,`/tailoring-jobs/${encodeURIComponent(jobId)}/input`,{},fetcher);
  if(data?.jobId!==jobId)throw new Error("Tailoring API returned a mismatched job ID.");
  return validateTailoringInput(data?.input);
}

export async function submitTailoringJobPreview(apiBaseUrl:string,accessToken:string,jobId:string,preview:TailoringPreview,fetcher:Fetcher=fetch){
  return call(apiBaseUrl,accessToken,`/tailoring-jobs/${encodeURIComponent(jobId)}/preview`,{method:"PUT",body:JSON.stringify({generatedAt:preview.generatedAt,result:preview.result})},fetcher);
}
