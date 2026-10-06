import {AppError} from "../shared/errors.js";import {MESSAGE_TYPES} from "../shared/messages.js";import {apiRequest} from "./api-client.js";
import {buildApplicationQaPrompt} from "../shared/application-qa-prompt.js";
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
async function listMyApplicationsViaRpc(client,{status="",resumeId="",screenshotFeedback="",sort="assigned_asc",limit=100}={}){
  const {data,error}=await client.rpc("list_my_applications_v20",{
    p_status:status||"",
    p_sort:sort||"assigned_asc",
    p_limit:Math.min(Number(limit)||100,500),
    p_resume_id:resumeId||null,
    p_screenshot_feedback:screenshotFeedback||"",
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
export async function listMyApplications(client,baseUrl,{status="",resumeId="",screenshotFeedback="",sort="assigned_asc",limit=100}={}){
  // This is the extension's hottest read. Go straight to Postgres with the
  // signed-in user's JWT; the security-definer RPC still enforces Applier scope.
  try{return await listMyApplicationsViaRpc(client,{status,resumeId,screenshotFeedback,sort,limit});}
  catch(error){
    // Keep a narrow compatibility fallback while older environments are migrated.
    if(!baseUrl||!missingRpc(error,"list_my_applications_v20"))throw error;
    const q=new URLSearchParams({status,sort,limit:String(limit)});
    if(resumeId)q.set("resumeId",resumeId);
    if(screenshotFeedback)q.set("screenshotFeedback",screenshotFeedback);
    return normalizeMinePayload(await call(client,baseUrl,`/api/v1/applications/mine?${q}`),limit);
  }
}
export const getApplicationExtensionContext=(client,baseUrl,applicationId)=>call(client,baseUrl,`/api/v1/applications/${applicationId}/extension-context`);
export const getApplicationAutofillContext=(client,baseUrl,applicationId,sessionId,resumeUpdatedAt="")=>{const query=new URLSearchParams({sessionId});if(resumeUpdatedAt)query.set("resumeUpdatedAt",resumeUpdatedAt);return call(client,baseUrl,`/api/v1/applications/${applicationId}/autofill-context?${query}`);};
export const createApplicationExtensionSession=(client,baseUrl,applicationId,action)=>call(client,baseUrl,`/api/v1/applications/${applicationId}/extension-sessions`,{method:"POST",body:{action,extensionVersion:chrome.runtime.getManifest().version}});
export const updateApplicationExtensionSession=(client,baseUrl,sessionId,status,errorCode)=>call(client,baseUrl,`/api/v1/extension-sessions/${sessionId}`,{method:"PATCH",body:{status,...(errorCode?{errorCode}:{})}});
export const recordApplicationAutofillTelemetry=(client,baseUrl,sessionId,telemetry)=>call(client,baseUrl,`/api/v1/extension-sessions/${sessionId}/autofill-telemetry`,{method:"PATCH",body:telemetry});
export const recordApplicationResumeAttachment=(client,baseUrl,sessionId,outcome)=>call(client,baseUrl,`/api/v1/extension-sessions/${sessionId}/resume-attachment`,{method:"PATCH",body:outcome});
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
const RESUME_DOWNLOAD_MIMES=new Set(["application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","text/plain"]),RESUME_SIGNED_URL_ATTEMPTS=3,RESUME_SIGNED_URL_RETRY_BASE_MS=400;
async function createResumeSignedUrl(client,bucket,path){
  let storageError=null;
  for(let attempt=0;attempt<RESUME_SIGNED_URL_ATTEMPTS;attempt+=1){
    const result=await client.storage.from(bucket).createSignedUrl(path,90);
    if(!result?.error&&result?.data?.signedUrl)return result.data.signedUrl;
    storageError=result?.error||null;
    if(!isRetryableStorageError(storageError)||attempt===RESUME_SIGNED_URL_ATTEMPTS-1)break;
    await delay(RESUME_SIGNED_URL_RETRY_BASE_MS*(2**attempt));
  }
  throw databaseError(storageError,"APPLICATION_RESUME_OPEN_FAILED","The private Resume file could not be opened.");
}
async function applicationResumeDownloadViaRpc(client,applicationId){
  const{data:file,error}=await client.rpc("get_application_resume_download_v17",{p_application_id:applicationId});
  if(error)throw databaseError(error,"APPLICATION_RESUME_UNAVAILABLE","The Resume is not available for this Application.");
  const number=Number(file?.resumeNumber),type=String(file?.resumeType||""),mime=String(file?.mimeType||""),size=Number(file?.fileSizeBytes);
  if(!file?.bucket||!file?.path||!file?.filename||!Number.isSafeInteger(number)||number<1||!["ORIGINAL","TAILORED"].includes(type)||!RESUME_DOWNLOAD_MIMES.has(mime)||!Number.isSafeInteger(size)||size<1||size>5242880){
    throw new AppError("APPLICATION_RESUME_METADATA_INVALID","The attached Resume download metadata is invalid.");
  }
  const signedUrl=await createResumeSignedUrl(client,file.bucket,file.path);
  return{
    signedUrl,
    expiresInSeconds:90,
    filename:file.filename,
    mimeType:mime,
    fileSizeBytes:size,
    resumeNumber:number,
    resumeType:type,
    candidateName:file.candidateName||null,
    resumeName:file.resumeName||null,
    applicationNumber:Number(file?.applicationNumber)||null,
  };
}
// Resolves the Resume currently attached to the Application (the TAILORED child once materialized)
// with a short-lived signed URL. Shared by Download Resume and in-page attachment so both deliver
// the same file under the same candidate-facing filename.
export async function getApplicationResumeAccess(client,baseUrl,applicationId){
  const requestedAt=Date.now();
  let data;
  try{
    data=await applicationResumeDownloadViaRpc(client,applicationId);
  }catch(error){
    // Keep a narrow Nest fallback while older environments lack the download RPC.
    if(!baseUrl||!missingRpc(error,"get_application_resume_download_v17"))throw error;
    data=await call(client,baseUrl,`/api/v1/applications/${encodeURIComponent(applicationId)}/resume-file-url`,{timeoutMs:30000});
  }
  const url=new URL(String(data?.signedUrl||"")),number=Number(data?.resumeNumber),type=String(data?.resumeType||""),expiresInSeconds=Number(data?.expiresInSeconds)||90;
  if(url.protocol!=="https:"||!Number.isSafeInteger(number)||number<1||!["ORIGINAL","TAILORED"].includes(type))throw new AppError("APPLICATION_RESUME_METADATA_INVALID","The attached Resume download metadata is invalid.");
  const downloadName=buildApplicationResumeDownloadFilename({
    candidateName:data?.candidateName||data?.candidate_name,
    resumeName:data?.resumeName||data?.resume_name,
    filename:data?.filename,
    mimeType:data?.mimeType||data?.mime_type,
    applicationNumber:data?.applicationNumber||data?.application_number,
  });
  // Expiry is measured from before the request so the extension never trusts a URL longer than Storage does.
  return{...data,signedUrl:url.toString(),downloadName,expiresAt:new Date(requestedAt+expiresInSeconds*1000).toISOString()};
}
export async function downloadApplicationResume(client,baseUrl,applicationId,downloadImpl=chrome.downloads.download){
  const data=await getApplicationResumeAccess(client,baseUrl,applicationId),{downloadName}=data;
  // Avoid Chrome's Save As dialog: with a large Downloads folder it can take
  // 10–30s to open. The generated filename already includes candidate + App ID.
  const downloadId=await downloadImpl({url:data.signedUrl,filename:downloadName,saveAs:false,conflictAction:"uniquify"});
  if(!Number.isInteger(downloadId))throw new AppError("APPLICATION_RESUME_DOWNLOAD_FAILED","Chrome could not start the Resume download.");
  return{...data,downloadId,downloadName};
}
// Loads the Application's attached Resume (original or TAILORED) into service-worker memory for in-page
// attachment. The signed URL lives ~90s, so one fresh URL is requested if it expires before the fetch.
export async function loadApplicationResumeForSession(client,baseUrl,session,sendMessage=(message)=>chrome.runtime.sendMessage(message)){
  for(let attempt=0;attempt<2;attempt+=1){
    const access=await getApplicationResumeAccess(client,baseUrl,session.applicationId);
    const loaded=await sendMessage({type:MESSAGE_TYPES.LOAD_APPLICATION_RESUME,payload:{sessionId:session.id,applicationId:session.applicationId,access:{signedUrl:access.signedUrl,expiresAt:access.expiresAt,filename:access.downloadName,mimeType:access.mimeType,fileSizeBytes:access.fileSizeBytes}}});
    if(loaded?.ok)return loaded.data;
    if(loaded?.error?.code!=="RESUME_ACCESS_EXPIRED"||attempt===1)throw new AppError(loaded?.error?.code||"RESUME_LOAD_FAILED",loaded?.error?.message||"The private Resume could not be loaded.");
  }
  return null;
}
// Original uploads use a private signed URL; tailored letters retain the generated PDF download.
export async function downloadApplicationCoverLetter(client,baseUrl,applicationId,downloadImpl=chrome.downloads.download){
  const data=await call(client,baseUrl,`/api/v1/applications/${encodeURIComponent(applicationId)}/cover-letter`,{timeoutMs:30000});
  let downloadUrl;
  if(data?.source==="ORIGINAL_UPLOAD"){
    let url;try{url=new URL(data.signedUrl);}catch{/* Rejected by metadata validation below. */}
    if(data.kind!=="BASE"||!url||!["https:","http:"].includes(url.protocol)||!url.pathname.startsWith("/storage/v1/object/sign/cover-letters/")||!data.filename||!["application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","text/plain"].includes(data.mimeType))throw new AppError("APPLICATION_COVER_LETTER_METADATA_INVALID","The cover letter download metadata is invalid.");
    downloadUrl=url.toString();
  }else{
    if(data?.mimeType!=="application/pdf"||!/^[A-Za-z0-9+/]+={0,2}$/.test(String(data?.contentBase64||""))||!["TAILORED","BASE"].includes(data?.kind))throw new AppError("APPLICATION_COVER_LETTER_METADATA_INVALID","The cover letter download metadata is invalid.");
    downloadUrl=`data:application/pdf;base64,${data.contentBase64}`;
  }
  const downloadName=safeDownloadName(data.filename||"Cover Letter.pdf");
  const downloadId=await downloadImpl({url:downloadUrl,filename:downloadName,saveAs:false,conflictAction:"uniquify"});
  if(!Number.isInteger(downloadId))throw new AppError("APPLICATION_COVER_LETTER_DOWNLOAD_FAILED","Chrome could not start the cover letter download.");
  return{kind:data.kind,downloadId,downloadName};
}
export async function copyApplicationCoverLetter(client,baseUrl,applicationId,writeText=text=>navigator.clipboard.writeText(text),extractText=async(buffer,mimeType)=>(await import("./cover-letter-parser.js")).extractCoverLetterText(buffer,mimeType)){
  const data=await call(client,baseUrl,`/api/v1/applications/${encodeURIComponent(applicationId)}/cover-letter/text`,{timeoutMs:30000});
  if(!["BASE","TAILORED"].includes(data?.kind))throw new AppError("APPLICATION_COVER_LETTER_METADATA_INVALID","The cover letter text metadata is invalid.");
  let text=data.text;
  if(data.source==="ORIGINAL_UPLOAD"){
    let url;try{url=new URL(data.signedUrl);}catch{/* Validate before fetching the private file. */}
    if(data.kind!=="BASE"||!url||!["https:","http:"].includes(url.protocol)||!url.pathname.startsWith("/storage/v1/object/sign/cover-letters/")||!["application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","text/plain"].includes(data.mimeType)||!Number.isSafeInteger(data.fileSizeBytes)||data.fileSizeBytes<1||data.fileSizeBytes>5242880)throw new AppError("APPLICATION_COVER_LETTER_METADATA_INVALID","The cover letter file metadata is invalid.");
    const response=await fetch(url.toString(),{credentials:"omit",signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new AppError("COVER_LETTER_READ_FAILED","The original cover letter could not be read. Click Copy Cover Letter to try again.");
    const buffer=await response.arrayBuffer();
    if(buffer.byteLength>5242880)throw new AppError("COVER_LETTER_READ_FAILED","The cover letter exceeds the supported file size.");
    text=await extractText(buffer,data.mimeType);
  }
  if(typeof text!=="string"||!text.trim())throw new AppError("COVER_LETTER_NO_READABLE_TEXT","This cover letter has no readable text to copy.");
  const plainText=text.replace(/\r\n?/g,"\n").replace(/\0/g,"").trim();
  if(!plainText)throw new AppError("COVER_LETTER_NO_READABLE_TEXT","This cover letter has no readable text to copy.");
  try{await writeText(plainText);}catch{throw new AppError("COVER_LETTER_COPY_FAILED","Clipboard access failed. Keep the extension panel focused, then click Copy Cover Letter again.");}
  return{kind:data.kind};
}
export async function copyApplicationQaPrompt(client,baseUrl,applicationId,writeText=text=>navigator.clipboard.writeText(text)){
  const context=await call(client,baseUrl,`/api/v1/applications/${encodeURIComponent(applicationId)}/qa-context`,{timeoutMs:30000});
  const prompt=buildApplicationQaPrompt(context);
  try{await writeText(prompt);}catch{throw new AppError("APPLICATION_PROMPT_COPY_FAILED","Clipboard access failed. Keep the extension panel focused, then click Copy Q&A Prompt again.");}
  return{resumeType:context.resumeType};
}
export async function listApplicationScreenshots(client,_baseUrl,applicationId){
  const{data,error}=await client.from("application_screenshots")
    .select("id,storage_bucket,storage_path,original_filename,mime_type,file_size_bytes,created_at")
    .eq("application_id",applicationId).order("created_at",{ascending:false});
  if(error)throw databaseError(error,"APPLICATION_SCREENSHOTS_LOAD_FAILED","Screenshots could not be loaded.");
  return data||[];
}
const SCREENSHOT_MIME_TYPES=new Set(["image/png","image/jpeg","image/webp","application/pdf"]),SCREENSHOT_MIME_BY_EXT=Object.freeze({png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",pdf:"application/pdf"}),MAX_SCREENSHOT_SIZE=5*1024*1024,SCREENSHOT_UPLOAD_ATTEMPTS=3,SCREENSHOT_UPLOAD_RETRY_BASE_MS=500;
function inferScreenshotMime(file){if(file?.type&&SCREENSHOT_MIME_TYPES.has(file.type))return file.type;const ext=String(file?.name||"").split(".").pop()?.toLowerCase();return SCREENSHOT_MIME_BY_EXT[ext]||"";}
function screenshotUploadFile(file){const mime=inferScreenshotMime(file);if(!mime) return null;if(file?.type===mime) return file;return new File([file],file.name,{type:mime});}
function screenshotExtension(file){const ext=String(file?.name||"").split(".").pop()?.toLowerCase();if(["png","jpg","jpeg","webp","pdf"].includes(ext))return ext;return {png:"png",jpg:"jpg",jpeg:"jpg",webp:"webp",pdf:"pdf"}[String(inferScreenshotMime(file)).split("/").pop()]||"";}
export function applicationScreenshotFileName(applicationNumber,file){const ext=screenshotExtension(file),number=String(applicationNumber??"").trim();if(!/^\d+$/.test(number)||!ext)return String(file?.name||"screenshot");return `Application ${number}.${ext}`;}
function safeScreenshotName(value){return String(value||"screenshot").normalize("NFKC").replace(/[^A-Za-z0-9._-]+/g,"_").replace(/^\.+/,"").slice(-180)||"screenshot";}
export function validateApplicationScreenshotFile(file){const errors={};const mime=inferScreenshotMime(file);if(!file)errors.file="Choose a screenshot file.";else if(!mime)errors.file="Use a PNG, JPG, WEBP, or PDF file.";else if(!file.size||file.size>MAX_SCREENSHOT_SIZE)errors.file="Screenshot must be between 1 byte and 5 MiB.";return{valid:!Object.keys(errors).length,errors,mime};}
export async function prepareApplicationScreenshot(file){
  // Upload the original file as-is (MIME normalized only). No resize/WebP conversion.
  return screenshotUploadFile(file);
}
export async function attachApplicationScreenshot(client,_baseUrl,applicationId,file,applicationNumber){
  const check=validateApplicationScreenshotFile(file);
  if(!check.valid)throw new AppError("APPLICATION_SCREENSHOT_INVALID",Object.values(check.errors).join(" "));
  const prepared=await prepareApplicationScreenshot(file);
  if(!prepared)throw new AppError("APPLICATION_SCREENSHOT_INVALID","Use a PNG, JPG, WEBP, or PDF file.");
  const filename=applicationScreenshotFileName(applicationNumber,prepared);
  const uploadFile=filename===prepared.name?prepared:new File([prepared],filename,{type:prepared.type});
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
