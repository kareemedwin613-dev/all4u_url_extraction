import {AppError} from "../shared/errors.js";import {apiRequest} from "./api-client.js";
async function token(client){const{data,error}=await client.auth.getSession();if(error||!data.session?.access_token)throw new AppError("SESSION_EXPIRED","Your session has expired. Sign in again.");return data.session.access_token;}
async function call(client,baseUrl,path,options={}){return(await apiRequest({baseUrl,path,token:await token(client),...options})).data;}
function storageErrorDetail(error){return String(error?.message||error?.details||error?.hint||error?.error||"");}
function isRetryableStorageError(error){
  const detail=storageErrorDetail(error),status=Number(error?.statusCode||error?.status||0);
  return status===544||status===503||status===504||/fetch|network|timeout|unreachable|connection to the database timed out|database.?timeout|temporar|try again/i.test(detail);
}
function databaseError(error,code,message){
  const detail=storageErrorDetail(error);
  const match=detail.match(/([A-Z][A-Z0-9_]+):\s*([^\n]+)/);
  const retryable=isRetryableStorageError(error)||/fetch|network|timeout|unreachable/i.test(detail);
  if(retryable&&/UPLOAD/i.test(code)){
    return new AppError("APPLICATION_SCREENSHOT_UPLOAD_TIMEOUT","The screenshot upload timed out. Try again in a moment.",detail,true);
  }
  return new AppError(String(match?.[1]||error?.code||code),String(match?.[2]||message),detail,retryable);
}
function delay(ms){return new Promise((resolve)=>setTimeout(resolve,ms));}
function missingRpc(error,name){return new RegExp(`PGRST202|${name}|could not find the function`,`i`).test(`${error?.code||""} ${error?.message||""} ${error?.details||""}`);}
function normalizeMineResumes(rows){
  return (Array.isArray(rows)?rows:[]).map((row)=>({
    id:String(row?.id||row?.resumeId||row?.resume_id||""),
    resumeName:String(row?.resumeName||row?.resume_name||"").trim(),
    resumeNumber:Number(row?.resumeNumber||row?.resume_number)||null,
    candidateName:String(row?.candidateName||row?.candidate_name||"").trim(),
    applicationCount:Number(row?.applicationCount||row?.application_count)||0,
  })).filter((row)=>row.id&&row.resumeName);
}
function formatMineResumeLabel(resume){
  const name=resume.resumeName||`Resume #${resume.resumeNumber||"?"}`,
    prefix=resume.candidateName?`${resume.candidateName} · `:"";
  return `${prefix}${name}${resume.resumeNumber?` #${resume.resumeNumber}`:""}`;
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
  // This is the extension's hottest read. Go straight to Postgres with the
  // signed-in user's JWT; the security-definer RPC still enforces Applier scope.
  try{return await listMyApplicationsViaRpc(client,{status,resumeId,sort,limit});}
  catch(error){
    // Keep a narrow compatibility fallback while older environments are migrated.
    if(!baseUrl||!missingRpc(error,"list_my_applications_v20"))throw error;
    const q=new URLSearchParams({status,sort,limit:String(limit)});
    if(resumeId)q.set("resumeId",resumeId);
    return normalizeMinePayload(await call(client,baseUrl,`/api/v1/applications/mine?${q}`),limit);
  }
}
export const getApplicationExtensionContext=(client,baseUrl,applicationId)=>call(client,baseUrl,`/api/v1/applications/${applicationId}/extension-context`);
export const getApplicationAutofillContext=(client,baseUrl,applicationId,sessionId,resumeUpdatedAt="")=>{const query=new URLSearchParams({sessionId});if(resumeUpdatedAt)query.set("resumeUpdatedAt",resumeUpdatedAt);return call(client,baseUrl,`/api/v1/applications/${applicationId}/autofill-context?${query}`);};
export const createApplicationExtensionSession=(client,baseUrl,applicationId,action)=>call(client,baseUrl,`/api/v1/applications/${applicationId}/extension-sessions`,{method:"POST",body:{action,extensionVersion:chrome.runtime.getManifest().version}});
export const updateApplicationExtensionSession=(client,baseUrl,sessionId,status,errorCode)=>call(client,baseUrl,`/api/v1/extension-sessions/${sessionId}`,{method:"PATCH",body:{status,...(errorCode?{errorCode}:{})}});
export const recordApplicationAutofillTelemetry=(client,baseUrl,sessionId,telemetry)=>call(client,baseUrl,`/api/v1/extension-sessions/${sessionId}/autofill-telemetry`,{method:"PATCH",body:telemetry});
export const getApplicationAutofillRecovery=(client,baseUrl,sessionId)=>call(client,baseUrl,`/api/v1/extension-sessions/${sessionId}/autofill-recovery`);
export const updateApplicationAutofillRecovery=(client,baseUrl,sessionId,recovery)=>call(client,baseUrl,`/api/v1/extension-sessions/${sessionId}/autofill-recovery`,{method:"PATCH",body:recovery});
export async function updateApplicationProgress(client,_baseUrl,id,{status,applicationUrl,notes}){
  const{data,error}=await client.rpc("update_application_status_v101",{
    p_application_id:id,p_status:status,p_application_url:applicationUrl||null,p_applied_at:null,
    p_notes:notes==null?null:String(notes),p_priority:null,p_due_at:null,
  });
  if(error)throw databaseError(error,"APPLICATION_UPDATE_FAILED","The Application could not be updated.");
  return data;
}
export function formatMineResumeOptionLabel(resume){return formatMineResumeLabel(resume);}
const safeDownloadName=(value)=>String(value||"resume").normalize("NFKC").replace(/[^A-Za-z0-9._ -]+/g,"_").replace(/^\.+/,"").trim().slice(-180)||"resume";
export function buildApplicationResumeDownloadFilename({ candidateName, resumeName, filename, mimeType, applicationNumber } = {}) {
  const ext = mimeType === "application/pdf"
    ? ".pdf"
    : mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ? ".docx"
      : mimeType === "text/plain"
        ? ".txt"
        : (String(filename || "").match(/\.[^.]+$/) || [".pdf"])[0];
  const base = String(candidateName || "").trim()
    ? `${String(candidateName).trim()} Resume`
    : String(resumeName || "").trim() || String(filename || "Resume").replace(/\.[^.]+$/, "") || "Resume";
  const appSuffix = Number.isSafeInteger(Number(applicationNumber)) && Number(applicationNumber) > 0
    ? ` - App ${Number(applicationNumber)}`
    : "";
  return safeDownloadName(`${base}${appSuffix}${ext}`);
}
export async function downloadApplicationResume(client,baseUrl,applicationId,downloadImpl=chrome.downloads.download){
  const data=await call(client,baseUrl,`/api/v1/applications/${encodeURIComponent(applicationId)}/resume-file-url`),url=new URL(String(data?.signedUrl||"")),number=Number(data?.resumeNumber),type=String(data?.resumeType||"");
  if(url.protocol!=="https:"||!Number.isSafeInteger(number)||number<1||!["ORIGINAL","TAILORED"].includes(type))throw new AppError("APPLICATION_RESUME_METADATA_INVALID","The attached Resume download metadata is invalid.");
  const downloadName=buildApplicationResumeDownloadFilename({
    candidateName:data?.candidateName||data?.candidate_name,
    resumeName:data?.resumeName||data?.resume_name,
    filename:data?.filename,
    mimeType:data?.mimeType||data?.mime_type,
    applicationNumber:data?.applicationNumber||data?.application_number,
  });
  const downloadId=await downloadImpl({url:url.toString(),filename:downloadName,saveAs:true,conflictAction:"uniquify"});
  if(!Number.isInteger(downloadId))throw new AppError("APPLICATION_RESUME_DOWNLOAD_FAILED","Chrome could not start the Resume download.");
  return{...data,downloadId};
}
export async function listApplicationScreenshots(client,_baseUrl,applicationId){
  const{data,error}=await client.from("application_screenshots")
    .select("id,storage_bucket,storage_path,original_filename,mime_type,file_size_bytes,created_at")
    .eq("application_id",applicationId).order("created_at",{ascending:false});
  if(error)throw databaseError(error,"APPLICATION_SCREENSHOTS_LOAD_FAILED","Screenshots could not be loaded.");
  return data||[];
}
const SCREENSHOT_MIME_TYPES=new Set(["image/png","image/jpeg","image/webp","application/pdf"]),SCREENSHOT_MIME_BY_EXT=Object.freeze({png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",pdf:"application/pdf"}),MAX_SCREENSHOT_SIZE=5*1024*1024,MIN_SCREENSHOT_COMPRESSION_SIZE=200*1024,MAX_SCREENSHOT_EDGE=1800,SCREENSHOT_WEBP_QUALITY=.72,SCREENSHOT_UPLOAD_ATTEMPTS=3,SCREENSHOT_UPLOAD_RETRY_BASE_MS=500;
function inferScreenshotMime(file){if(file?.type&&SCREENSHOT_MIME_TYPES.has(file.type))return file.type;const ext=String(file?.name||"").split(".").pop()?.toLowerCase();return SCREENSHOT_MIME_BY_EXT[ext]||"";}
function screenshotUploadFile(file){const mime=inferScreenshotMime(file);if(!mime) return null;if(file?.type===mime) return file;return new File([file],file.name,{type:mime});}
function safeScreenshotName(value){return String(value||"screenshot").normalize("NFKC").replace(/[^A-Za-z0-9._-]+/g,"_").replace(/^\.+/,"").slice(-180)||"screenshot";}
function webpName(value){const base=safeScreenshotName(value).replace(/\.[^.]+$/,"")||"screenshot";return `${base}.webp`;}
export function validateApplicationScreenshotFile(file){const errors={};const mime=inferScreenshotMime(file);if(!file)errors.file="Choose a screenshot file.";else if(!mime)errors.file="Use a PNG, JPG, WEBP, or PDF file.";else if(!file.size||file.size>MAX_SCREENSHOT_SIZE)errors.file="Screenshot must be between 1 byte and 5 MiB.";return{valid:!Object.keys(errors).length,errors,mime};}
export async function prepareApplicationScreenshot(file,{createBitmap=globalThis.createImageBitmap,Canvas=globalThis.OffscreenCanvas}={}){
  const uploadFile=screenshotUploadFile(file),mime=inferScreenshotMime(uploadFile);
  if(!uploadFile||mime==="application/pdf"||uploadFile.size<MIN_SCREENSHOT_COMPRESSION_SIZE||typeof createBitmap!=="function"||typeof Canvas!=="function")return uploadFile;
  let bitmap;
  try{
    bitmap=await createBitmap(uploadFile);
    const scale=Math.min(1,MAX_SCREENSHOT_EDGE/Math.max(bitmap.width,bitmap.height));
    const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
    const canvas=new Canvas(width,height),context=canvas.getContext("2d");
    if(!context||typeof canvas.convertToBlob!=="function")return uploadFile;
    context.drawImage(bitmap,0,0,width,height);
    const blob=await canvas.convertToBlob({type:"image/webp",quality:SCREENSHOT_WEBP_QUALITY});
    if(!blob?.size||blob.size>=uploadFile.size||blob.size>MAX_SCREENSHOT_SIZE)return uploadFile;
    return new File([blob],webpName(uploadFile.name),{type:"image/webp",lastModified:Date.now()});
  }catch{return uploadFile;}finally{bitmap?.close?.();}
}
export async function attachApplicationScreenshot(client,_baseUrl,applicationId,file){
  const check=validateApplicationScreenshotFile(file);
  if(!check.valid)throw new AppError("APPLICATION_SCREENSHOT_INVALID",Object.values(check.errors).join(" "));
  const uploadFile=await prepareApplicationScreenshot(file);
  if(!uploadFile)throw new AppError("APPLICATION_SCREENSHOT_INVALID","Use a PNG, JPG, WEBP, or PDF file.");
  const path=`${applicationId}/${crypto.randomUUID()}-${safeScreenshotName(uploadFile.name)}`,bucket="application-screenshots";
  let uploadError=null;
  for(let attempt=0;attempt<SCREENSHOT_UPLOAD_ATTEMPTS;attempt+=1){
    const result=await client.storage.from(bucket).upload(path,uploadFile,{contentType:uploadFile.type,upsert:false,cacheControl:"3600"});
    uploadError=result?.error||null;
    if(!uploadError)break;
    // A prior attempt may have committed before the client saw the timeout.
    if(/already exists|duplicate|resource already exists/i.test(storageErrorDetail(uploadError))){uploadError=null;break;}
    if(!isRetryableStorageError(uploadError)||attempt===SCREENSHOT_UPLOAD_ATTEMPTS-1)break;
    await delay(SCREENSHOT_UPLOAD_RETRY_BASE_MS*(2**attempt));
  }
  if(uploadError)throw databaseError(uploadError,"APPLICATION_SCREENSHOT_UPLOAD_FAILED","The screenshot file could not be uploaded.");
  try{
    const{data,error}=await client.rpc("attach_application_screenshot",{p_application_id:applicationId,p_storage_path:path,p_original_filename:uploadFile.name,p_mime_type:uploadFile.type,p_file_size_bytes:uploadFile.size});
    if(error)throw databaseError(error,"APPLICATION_SCREENSHOT_ATTACH_FAILED","The screenshot could not be attached.");
    return data;
  }catch(error){await client.storage.from(bucket).remove([path]).catch(()=>{});throw error;}
}
export async function removeApplicationScreenshot(client,_baseUrl,_applicationId,screenshot){
  const{data,error}=await client.rpc("remove_application_screenshot",{p_screenshot_id:screenshot.id});
  if(error)throw databaseError(error,"APPLICATION_SCREENSHOT_REMOVE_FAILED","The screenshot could not be removed.");
  const bucket=String(data?.storageBucket||screenshot.storage_bucket||"application-screenshots"),path=String(data?.storagePath||screenshot.storage_path||"");
  if(path)await client.storage.from(bucket).remove([path]).catch(()=>{});
  return data;
}
export async function openApplicationScreenshot(client,_baseUrl,_applicationId,screenshot){
  const{data,error}=await client.storage.from(screenshot.storage_bucket||"application-screenshots").createSignedUrl(screenshot.storage_path,90);
  if(error||!data?.signedUrl)throw databaseError(error,"APPLICATION_SCREENSHOT_OPEN_FAILED","The private screenshot could not be opened.");
  const a=document.createElement("a");a.href=data.signedUrl;a.download=screenshot.original_filename||"application-screenshot";a.target="_blank";a.rel="noopener";a.click();
}
