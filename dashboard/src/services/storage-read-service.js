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
export async function saveResumeCoverLetterText(client,{id,apiBaseUrl,text}){
  if(!id)throw{code:"VALIDATION_ERROR",message:"The Resume reference is invalid."};
  const{payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:`/api/v1/resumes/${encodeURIComponent(id)}/cover-letter/text`,method:"PUT",body:{text:String(text||"")}});
  return payload.data;
}
export async function downloadCoverLetterPdf(client,{id,apiBaseUrl}){
  if(!id)throw{code:"VALIDATION_ERROR",message:"The Resume reference is invalid."};
  const{payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:`/api/v1/resumes/${encodeURIComponent(id)}/cover-letter/pdf`,timeoutMs:30000});
  const{filename,mimeType,contentBase64}=payload.data,bytes=Uint8Array.from(atob(contentBase64),character=>character.charCodeAt(0));
  const url=URL.createObjectURL(new Blob([bytes],{type:mimeType||"application/pdf"})),link=document.createElement("a");
  link.href=url;link.download=filename||"Cover_Letter.pdf";document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
  return filename;
}
export async function saveResumeHeadline(client,{id,apiBaseUrl,headline}){
  if(!id)throw{code:"VALIDATION_ERROR",message:"The Resume reference is invalid."};
  const{payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:`/api/v1/resumes/${encodeURIComponent(id)}/headline`,method:"PUT",body:{headline:String(headline||"")}});
  return payload.data;
}
export async function approveExtensionPairing(client,{apiBaseUrl,pairingId,challenge}){
  const{payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:"/api/v1/extension-pairings/approve",method:"POST",body:{pairingId,challenge}});
  return payload.data;
}
