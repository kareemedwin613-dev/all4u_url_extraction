import{authenticatedApiRequest}from"../../services/api-client.js";
const request=async(client,baseUrl,path,options={})=>(await authenticatedApiRequest(client,{baseUrl,path,...options})).payload.data;
const root=id=>`/api/v1/resumes/${encodeURIComponent(id)}/application-answers`;
export const listResumeAnswers=(client,baseUrl,resumeId)=>request(client,baseUrl,root(resumeId));
export const createResumeAnswer=(client,baseUrl,resumeId,body)=>request(client,baseUrl,root(resumeId),{method:"POST",body});
export const saveResumeAnswers=(client,baseUrl,resumeId,answers)=>request(client,baseUrl,root(resumeId),{method:"PATCH",body:{answers}});
export const updateResumeAnswer=(client,baseUrl,resumeId,answerId,body)=>request(client,baseUrl,`${root(resumeId)}/${encodeURIComponent(answerId)}`,{method:"PATCH",body});
export const archiveResumeAnswer=(client,baseUrl,resumeId,answerId)=>request(client,baseUrl,`${root(resumeId)}/${encodeURIComponent(answerId)}`,{method:"DELETE"});
