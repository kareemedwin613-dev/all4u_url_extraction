import {authenticatedApiRequest} from "./api-client.js";

const params=value=>{const query=new URLSearchParams();for(const [key,item] of Object.entries(value||{}))if(item!==""&&item!==null&&item!==undefined)query.set(key,String(item));const text=query.toString();return text?`?${text}`:"";};
const request=async(client,apiBaseUrl,path)=>{const {payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path});return payload.data;};

const localMidnight=value=>new Date(value.getFullYear(),value.getMonth(),value.getDate());
export function capturedDateBounds(filters={},now=new Date()){
  const window=filters.capturedWindow;if(!window)return{};let from,to;
  if(window==="TODAY"){from=localMidnight(now);to=new Date(from);to.setDate(to.getDate()+1);}
  else if(window==="THIS_WEEK"){from=localMidnight(now);from.setDate(from.getDate()-((from.getDay()+6)%7));to=new Date(from);to.setDate(to.getDate()+7);}
  else if(window==="THIS_MONTH"){from=new Date(now.getFullYear(),now.getMonth(),1);to=new Date(now.getFullYear(),now.getMonth()+1,1);}
  else if(window==="CUSTOM"&&filters.capturedFrom&&filters.capturedTo){const[startYear,startMonth,startDay]=filters.capturedFrom.split("-").map(Number),[endYear,endMonth,endDay]=filters.capturedTo.split("-").map(Number);from=new Date(startYear,startMonth-1,startDay);to=new Date(endYear,endMonth-1,endDay);to.setDate(to.getDate()+1);}
  return from&&to?{capturedFrom:from.toISOString(),capturedTo:to.toISOString()}:{};
}
export const listJobs=(client,apiBaseUrl,filters)=>{const{capturedWindow:_,capturedFrom:__,capturedTo:___,...query}=filters||{};return request(client,apiBaseUrl,`/api/v1/job-descriptions${params({...query,...capturedDateBounds(filters)})}`);};
export const getJob=(client,apiBaseUrl,id)=>request(client,apiBaseUrl,`/api/v1/job-descriptions/${encodeURIComponent(id)}`);
export const jobCount=(client,apiBaseUrl,status="")=>request(client,apiBaseUrl,`/api/v1/job-descriptions/count${params({status})}`);
export const recentJobs=(client,apiBaseUrl,limit=5)=>request(client,apiBaseUrl,`/api/v1/job-descriptions/recent${params({limit})}`);
export const listJobCapturers=(client,apiBaseUrl)=>request(client,apiBaseUrl,"/api/v1/job-descriptions/capturers");
export const setJobStatus=async(client,apiBaseUrl,id,status,reason)=>(await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:`/api/v1/job-descriptions/${encodeURIComponent(id)}/status`,method:"PATCH",body:{status,...(reason?{reason}:{})}})).payload.data;
export const reviewJob=async(client,apiBaseUrl,id,decision)=>(await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:`/api/v1/job-descriptions/${encodeURIComponent(id)}/review`,method:"PATCH",body:decision})).payload.data;
export const updateOwnJob=async(client,apiBaseUrl,id,body)=>(await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:`/api/v1/job-descriptions/${encodeURIComponent(id)}/correction`,method:"PATCH",body})).payload.data;
