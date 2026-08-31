import {AppError} from "../shared/errors.js";import {apiRequest} from "./api-client.js";
async function token(client){const{data,error}=await client.auth.getSession();if(error||!data.session?.access_token)throw new AppError("SESSION_EXPIRED","Your session has expired. Sign in again.");return data.session.access_token;}
async function call(client,baseUrl,path,options={}){return(await apiRequest({baseUrl,path,token:await token(client),...options})).data;}
function normalizeMineResumes(rows){
  return (Array.isArray(rows)?rows:[]).map((row)=>({
    id:String(row?.id||row?.resumeId||row?.resume_id||""),
    resumeName:String(row?.resumeName||row?.resume_name||"").trim(),
    resumeNumber:Number(row?.resumeNumber||row?.resume_number)||null,
  })).filter((row)=>row.id&&row.resumeName);
}
function normalizeMinePayload(data,limit=100){
  return{
    items:data?.items||[],
    resumes:normalizeMineResumes(data?.resumes),
    total:Number(data?.total)||0,
    limit:Number(data?.limit)||limit,
  };
}
async function listMyApplicationsViaRpc(client,{status="",resumeId="",sort="updated_desc",limit=100}={}){
  const {data,error}=await client.rpc("list_my_applications_v20",{
    p_status:status||"",
    p_sort:sort||"updated_desc",
    p_limit:Math.min(Number(limit)||100,500),
    p_resume_id:resumeId||null,
  });
  if(error){
    const detail=String(error.message||error.details||error.hint||"");
    throw new AppError(
      String(error.code||"APPLICATIONS_LOAD_FAILED"),
      detail.includes("list_my_applications_v20")||/could not find the function/i.test(detail)
        ? "Apply the latest database migrations, then reload the extension."
        : "Your Applications could not be loaded.",
      detail,
    );
  }
  return normalizeMinePayload(data,limit);
}
export async function listMyApplications(client,baseUrl,{status="",resumeId="",sort="updated_desc",limit=100}={}){
  // Prefer Nest when it returns status-scoped resume options. Otherwise use the
  // already-migrated RPC so options are never derived from the truncated page.
  if(baseUrl){
    try{
      const q=new URLSearchParams({status,sort,limit:String(limit)});
      if(resumeId)q.set("resumeId",resumeId);
      const data=await call(client,baseUrl,`/api/v1/applications/mine?${q}`);
      if(Object.prototype.hasOwnProperty.call(data||{},"resumes"))return normalizeMinePayload(data,limit);
    }catch(error){
      if(!(error instanceof AppError))throw error;
      // Older Nest builds omit resume options / reject resumeId — use RPC instead.
    }
  }
  return listMyApplicationsViaRpc(client,{status,resumeId,sort,limit});
}
export const getApplicationExtensionContext=(client,baseUrl,applicationId)=>call(client,baseUrl,`/api/v1/applications/${applicationId}/extension-context`);
export const getApplicationAutofillContext=(client,baseUrl,applicationId,sessionId,resumeUpdatedAt="")=>{const query=new URLSearchParams({sessionId});if(resumeUpdatedAt)query.set("resumeUpdatedAt",resumeUpdatedAt);return call(client,baseUrl,`/api/v1/applications/${applicationId}/autofill-context?${query}`);};
export const createApplicationExtensionSession=(client,baseUrl,applicationId,action)=>call(client,baseUrl,`/api/v1/applications/${applicationId}/extension-sessions`,{method:"POST",body:{action,extensionVersion:chrome.runtime.getManifest().version}});
export const updateApplicationExtensionSession=(client,baseUrl,sessionId,status,errorCode)=>call(client,baseUrl,`/api/v1/extension-sessions/${sessionId}`,{method:"PATCH",body:{status,...(errorCode?{errorCode}:{})}});
export const recordApplicationAutofillTelemetry=(client,baseUrl,sessionId,telemetry)=>call(client,baseUrl,`/api/v1/extension-sessions/${sessionId}/autofill-telemetry`,{method:"PATCH",body:telemetry});
export const getApplicationAutofillRecovery=(client,baseUrl,sessionId)=>call(client,baseUrl,`/api/v1/extension-sessions/${sessionId}/autofill-recovery`);
export const updateApplicationAutofillRecovery=(client,baseUrl,sessionId,recovery)=>call(client,baseUrl,`/api/v1/extension-sessions/${sessionId}/autofill-recovery`,{method:"PATCH",body:recovery});
export const updateApplicationProgress=(client,baseUrl,id,{status,applicationUrl,notes})=>call(client,baseUrl,`/api/v1/applications/${id}/progress`,{method:"PATCH",body:{status,applicationUrl:applicationUrl||undefined,notes:notes==null?undefined:String(notes)}});
const safeDownloadName=(value)=>String(value||"resume").normalize("NFKC").replace(/[^A-Za-z0-9._ -]+/g,"_").replace(/^\.+/,"").trim().slice(-180)||"resume";
export async function downloadApplicationResume(client,baseUrl,applicationId,downloadImpl=chrome.downloads.download){
  const data=await call(client,baseUrl,`/api/v1/applications/${encodeURIComponent(applicationId)}/resume-file-url`),url=new URL(String(data?.signedUrl||"")),number=Number(data?.resumeNumber),type=String(data?.resumeType||"");
  if(url.protocol!=="https:"||!Number.isSafeInteger(number)||number<1||!["ORIGINAL","TAILORED"].includes(type))throw new AppError("APPLICATION_RESUME_METADATA_INVALID","The attached Resume download metadata is invalid.");
  const downloadId=await downloadImpl({url:url.toString(),filename:safeDownloadName(data.filename),saveAs:true,conflictAction:"uniquify"});
  if(!Number.isInteger(downloadId))throw new AppError("APPLICATION_RESUME_DOWNLOAD_FAILED","Chrome could not start the Resume download.");
  return{...data,downloadId};
}
export const listApplicationScreenshots=(client,baseUrl,applicationId)=>call(client,baseUrl,`/api/v1/applications/${applicationId}/screenshots`);
const SCREENSHOT_MIME_TYPES=new Set(["image/png","image/jpeg","image/webp","application/pdf"]),SCREENSHOT_MIME_BY_EXT=Object.freeze({png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",pdf:"application/pdf"}),MAX_SCREENSHOT_SIZE=5*1024*1024,SCREENSHOT_UPLOAD_TIMEOUT_MS=60000;
function inferScreenshotMime(file){if(file?.type&&SCREENSHOT_MIME_TYPES.has(file.type))return file.type;const ext=String(file?.name||"").split(".").pop()?.toLowerCase();return SCREENSHOT_MIME_BY_EXT[ext]||"";}
function screenshotUploadFile(file){const mime=inferScreenshotMime(file);if(!mime) return null;if(file?.type===mime) return file;return new File([file],file.name,{type:mime});}
export function validateApplicationScreenshotFile(file){const errors={};const mime=inferScreenshotMime(file);if(!file)errors.file="Choose a screenshot file.";else if(!mime)errors.file="Use a PNG, JPG, WEBP, or PDF file.";else if(!file.size||file.size>MAX_SCREENSHOT_SIZE)errors.file="Screenshot must be between 1 byte and 5 MiB.";return{valid:!Object.keys(errors).length,errors,mime};}
export async function attachApplicationScreenshot(client,baseUrl,applicationId,file){const check=validateApplicationScreenshotFile(file);if(!check.valid)throw new AppError("APPLICATION_SCREENSHOT_INVALID",Object.values(check.errors).join(" "));const uploadFile=screenshotUploadFile(file);if(!uploadFile)throw new AppError("APPLICATION_SCREENSHOT_INVALID","Use a PNG, JPG, WEBP, or PDF file.");const body=new FormData();body.append("file",uploadFile,uploadFile.name);return call(client,baseUrl,`/api/v1/applications/${applicationId}/screenshots`,{method:"POST",body,timeoutMs:SCREENSHOT_UPLOAD_TIMEOUT_MS});}
export const removeApplicationScreenshot=(client,baseUrl,applicationId,screenshot)=>call(client,baseUrl,`/api/v1/applications/${applicationId}/screenshots/${screenshot.id}`,{method:"DELETE"});
export async function openApplicationScreenshot(client,baseUrl,applicationId,screenshot){const data=await call(client,baseUrl,`/api/v1/applications/${applicationId}/screenshots/${screenshot.id}/file-url`),a=document.createElement("a");a.href=data.signedUrl;a.download=screenshot.original_filename||"application-screenshot";a.target="_blank";a.rel="noopener";a.click();}
