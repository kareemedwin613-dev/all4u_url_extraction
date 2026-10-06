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
  return saveBase64Pdf(payload.data);
}
// Original uploads are downloaded unchanged; tailored PDFs retain their existing rendering path.
export async function downloadApplicationCoverLetterPdf(client,{id,apiBaseUrl}){
  if(!id)throw{code:"VALIDATION_ERROR",message:"The Application reference is invalid."};
  const{payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:`/api/v1/applications/${encodeURIComponent(id)}/cover-letter`,timeoutMs:30000});
  const data=payload.data;
  if(data.source==="ORIGINAL_UPLOAD"){
    const url=new URL(data.signedUrl);
    if(!["https:","http:"].includes(url.protocol)||!url.pathname.startsWith("/storage/v1/object/sign/cover-letters/"))throw new Error("The original cover letter download URL is invalid.");
    const response=await fetch(url,{credentials:"omit",signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error("The original cover letter could not be downloaded. Please try again.");
    return{filename:saveBlob(await response.blob(),data.filename),kind:data.kind};
  }
  return {filename:saveBase64Pdf(data),kind:data.kind};
}
function saveBase64Pdf({filename,mimeType,contentBase64}){
  const bytes=Uint8Array.from(atob(contentBase64),character=>character.charCodeAt(0));
  return saveBlob(new Blob([bytes],{type:mimeType||"application/pdf"}),filename);
}
function saveBlob(blob,filename){
  const url=URL.createObjectURL(blob),link=document.createElement("a");
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
