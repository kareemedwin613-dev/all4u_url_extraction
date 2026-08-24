import{authenticatedApiRequest}from"./api-client.js";
export const SIGNED_URL_SECONDS=90;
export async function createResumeSignedUrl(client,{id,apiBaseUrl}){
  if(!id)throw{code:"SIGNED_URL_FAILED",message:"The Resume file reference is invalid."};
  const{payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:`/api/v1/resumes/${encodeURIComponent(id)}/file-url`});
  return payload.data.signedUrl;
}
export async function createCoverLetterSignedUrl(client,{id,apiBaseUrl}){
  if(!id)throw{code:"SIGNED_URL_FAILED",message:"The cover letter file reference is invalid."};
  const{payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:`/api/v1/resumes/${encodeURIComponent(id)}/cover-letter/file-url`});
  return payload.data.signedUrl;
}
export async function uploadResumeCoverLetter(client,{id,apiBaseUrl,file}){
  if(!id||!file)throw{code:"VALIDATION_ERROR",message:"Choose a cover letter file to upload."};
  const body=new FormData();
  body.append("file",file);
  const{payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:`/api/v1/resumes/${encodeURIComponent(id)}/cover-letter`,method:"POST",body,timeoutMs:60000});
  return payload.data;
}
export async function removeResumeCoverLetter(client,{id,apiBaseUrl}){
  if(!id)throw{code:"VALIDATION_ERROR",message:"The Resume reference is invalid."};
  const{payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:`/api/v1/resumes/${encodeURIComponent(id)}/cover-letter`,method:"DELETE"});
  return payload.data;
}
