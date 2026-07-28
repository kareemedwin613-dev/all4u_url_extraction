import{authenticatedApiRequest}from"../../services/api-client.js";
const qs=o=>{const p=new URLSearchParams();for(const[k,v]of Object.entries(o||{}))if(v!==undefined&&v!==null&&v!=="")p.set(k,String(v));return p.toString()};
async function request(client,baseUrl,path,options={}){const{payload}=await authenticatedApiRequest(client,{baseUrl,path,...options});return payload;}
export const appliersApi={
  async getWorkloads(client,baseUrl,filters={}){return request(client,baseUrl,`/api/v1/appliers/workloads?${qs(filters)}`)},
  async getWorkloadSettings(client,baseUrl,id){return(await request(client,baseUrl,`/api/v1/appliers/${encodeURIComponent(id)}/workload-settings`)).data},
  async updateWorkloadSettings(client,baseUrl,id,value){return(await request(client,baseUrl,`/api/v1/appliers/${encodeURIComponent(id)}/workload-settings`,{method:"PATCH",body:value})).data},
};
export const bulkAssignmentApi={
  async preview(client,baseUrl,body){return(await request(client,baseUrl,"/api/v1/applications/bulk-assignment-preview",{method:"POST",body})).data},
  async assign(client,baseUrl,body,idempotencyKey){return(await request(client,baseUrl,"/api/v1/applications/bulk-assign",{method:"POST",body,idempotencyKey,timeoutMs:30000})).data},
};
export const assignmentBatchesApi={
  async list(client,baseUrl,filters={}){return request(client,baseUrl,`/api/v1/assignment-batches?${qs(filters)}`)},
  async getById(client,baseUrl,id){return(await request(client,baseUrl,`/api/v1/assignment-batches/${encodeURIComponent(id)}`)).data},
  async getResults(client,baseUrl,id,filters={}){return request(client,baseUrl,`/api/v1/assignment-batches/${encodeURIComponent(id)}/results?${qs(filters)}`)},
};
const assignmentSelectionKey="resume-jd:bulk-assignment-selection";
export const storeAssignmentIds=(ids,storage=globalThis.sessionStorage)=>{const value=[...new Set((ids||[]).filter(Boolean))].slice(0,2000);storage?.setItem(assignmentSelectionKey,JSON.stringify(value));return value;};
export const parseAssignmentIds=(query,storage=globalThis.sessionStorage)=>{const fromQuery=[...new Set((new URLSearchParams(query||"").get("ids")||"").split(",").filter(Boolean))].slice(0,2000);if(fromQuery.length)return storeAssignmentIds(fromQuery,storage);try{return[...new Set(JSON.parse(storage?.getItem(assignmentSelectionKey)||"[]").filter(Boolean))].slice(0,2000)}catch{return[]}};
