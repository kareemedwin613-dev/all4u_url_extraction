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
// Named like the extension's Resume download: "<Candidate> Cover Letter - <Company>.<ext>", or "- App <n>" when the
// company is unknown. The API's generated letters are named "<Candidate> Cover Letter - App <n>.pdf".
const filenameWords=(value)=>String(value||"").normalize("NFKC").replace(/[^A-Za-z0-9 .-]+/g," ").replace(/\s+/g," ").replace(/^[\s.-]+|[\s.-]+$/g,"").slice(0,60).trim();
const COVER_LETTER_EXTENSIONS={"application/pdf":".pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document":".docx","text/plain":".txt"};
export function coverLetterDownloadName({candidateName,companyName,applicationNumber,mimeType,filename}={}){
  const candidate=filenameWords(candidateName)||filenameWords(String(filename||"").match(/^(.+?)\s+Cover Letter\b/i)?.[1]);
  const company=filenameWords(companyName),number=Number(applicationNumber);
  const suffix=company?` - ${company}`:Number.isSafeInteger(number)&&number>0?` - App ${number}`:"";
  return`${candidate?`${candidate} Cover Letter`:"Cover Letter"}${suffix}${COVER_LETTER_EXTENSIONS[mimeType]||".pdf"}`;
}
// Original uploads are downloaded unchanged; tailored PDFs retain their existing rendering path.
export async function downloadApplicationCoverLetterPdf(client,{id,apiBaseUrl,companyName,candidateName}){
  if(!id)throw{code:"VALIDATION_ERROR",message:"The Application reference is invalid."};
  const{payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:`/api/v1/applications/${encodeURIComponent(id)}/cover-letter`,timeoutMs:30000});
  const data=payload.data;
  const filename=coverLetterDownloadName({candidateName,companyName,applicationNumber:data.applicationNumber,mimeType:data.source==="ORIGINAL_UPLOAD"?data.mimeType:"application/pdf",filename:data.filename});
  if(data.source==="ORIGINAL_UPLOAD"){
    const url=new URL(data.signedUrl);
    if(!["https:","http:"].includes(url.protocol)||!url.pathname.startsWith("/storage/v1/object/sign/cover-letters/"))throw new Error("The original cover letter download URL is invalid.");
    const response=await fetch(url,{credentials:"omit",signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error("The original cover letter could not be downloaded. Please try again.");
    return{filename:saveBlob(await response.blob(),filename),kind:data.kind};
  }
  return {filename:saveBase64Pdf({...data,filename}),kind:data.kind};
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
