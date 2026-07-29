import {authenticatedApiRequest} from "../../services/api-client.js";
const request=async(client,baseUrl,path,options={})=>(await authenticatedApiRequest(client,{baseUrl,path,...options})).payload.data;
export const getCandidateProfile=(client,baseUrl,id)=>request(client,baseUrl,`/api/v1/candidates/${encodeURIComponent(id)}/autofill-profile`);
export const updateCandidateProfile=(client,baseUrl,id,body)=>request(client,baseUrl,`/api/v1/candidates/${encodeURIComponent(id)}/profile`,{method:"PATCH",body});
export const createCandidateEmployment=(client,baseUrl,id,body)=>request(client,baseUrl,`/api/v1/candidates/${encodeURIComponent(id)}/employment`,{method:"POST",body});
export const updateCandidateEmployment=(client,baseUrl,id,employmentId,body)=>request(client,baseUrl,`/api/v1/candidates/${encodeURIComponent(id)}/employment/${encodeURIComponent(employmentId)}`,{method:"PATCH",body});
export const createCandidateEducation=(client,baseUrl,id,body)=>request(client,baseUrl,`/api/v1/candidates/${encodeURIComponent(id)}/education`,{method:"POST",body});
export const updateCandidateEducation=(client,baseUrl,id,educationId,body)=>request(client,baseUrl,`/api/v1/candidates/${encodeURIComponent(id)}/education/${encodeURIComponent(educationId)}`,{method:"PATCH",body});
