import {authenticatedApiRequest} from "./api-client.js";

const params=value=>{const query=new URLSearchParams();for(const [key,item] of Object.entries(value||{}))if(item!==""&&item!==null&&item!==undefined)query.set(key,String(item));const text=query.toString();return text?`?${text}`:"";};
const request=async(client,apiBaseUrl,path)=>{const {payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path});return payload.data;};

export const listJobs=(client,apiBaseUrl,filters)=>request(client,apiBaseUrl,`/api/v1/job-descriptions${params(filters)}`);
export const getJob=(client,apiBaseUrl,id)=>request(client,apiBaseUrl,`/api/v1/job-descriptions/${encodeURIComponent(id)}`);
export const jobCount=(client,apiBaseUrl,status="")=>request(client,apiBaseUrl,`/api/v1/job-descriptions/count${params({status})}`);
export const recentJobs=(client,apiBaseUrl,limit=5)=>request(client,apiBaseUrl,`/api/v1/job-descriptions/recent${params({limit})}`);
