import{authenticatedApiRequest}from"../../services/api-client.js";
const errorMessages={TAILORING_REVIEW_CONFLICT:"This preview changed after it was loaded. Refresh before reviewing.",TAILORING_REVIEW_UNAVAILABLE:"Only a generated preview awaiting review can be changed.",TAILORING_PREVIEW_INVALID:"Review the tailored content. It no longer matches the original Resume.",TAILORING_JOB_NOT_FOUND:"The tailoring job was not found or is inaccessible."};
async function api(client,baseUrl,path,{method="GET",body}={}){try{const{payload}=await authenticatedApiRequest(client,{baseUrl,path,method,body});return payload.data;}catch(error){throw{...error,message:errorMessages[error?.code]||error?.message||"The tailoring request could not be completed."};}}
export const listTailoringJobs=(client,baseUrl,status="ALL")=>api(client,baseUrl,`/api/v1/tailoring-jobs?status=${encodeURIComponent(status)}`);
export const getTailoringJob=(client,baseUrl,id)=>api(client,baseUrl,`/api/v1/tailoring-jobs/${encodeURIComponent(id)}`);
export const getTailoringReviews=(client,baseUrl,id)=>api(client,baseUrl,`/api/v1/tailoring-jobs/${encodeURIComponent(id)}/reviews`);
export const requestApplicationTailoring=(client,baseUrl,applicationId)=>api(client,baseUrl,`/api/v1/tailoring-jobs/application/${encodeURIComponent(applicationId)}`,{method:"POST"});
export const createTailoringRunnerTicket=(client,baseUrl,id)=>api(client,baseUrl,`/api/v1/tailoring-jobs/${encodeURIComponent(id)}/runner-ticket`,{method:"POST"});
export const reviewTailoringPreview=(client,baseUrl,id,{action,preview,notes,expectedUpdatedAt})=>api(client,baseUrl,`/api/v1/tailoring-jobs/${encodeURIComponent(id)}/review`,{method:"PATCH",body:{action,preview,notes,expectedUpdatedAt}});
