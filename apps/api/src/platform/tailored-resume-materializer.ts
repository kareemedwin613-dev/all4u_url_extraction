import{createHash}from"node:crypto";
import{HttpStatus}from"@nestjs/common";
import{ApiException}from"../common/errors/api.exception.js";
import{renderTailoredResumePdf}from"./tailored-resume-pdf.renderer.js";
import{renderTailoredResumeDocx}from"./tailored-resume.renderer.js";

type Phase="RENDER_FAILED"|"UPLOAD_FAILED"|"FINALIZE_FAILED";
interface MaterializationCallbacks{
  finalize:(details:{materializationToken:string;storagePath:string;filename:string;mimeType:string;fileSizeBytes:number;fileSha256:string})=>Promise<any>;
  fail:(phase:Phase,materializationToken:string)=>Promise<unknown>;
}

export async function materializeTailoredResumeArtifact(client:any,started:any,callbacks:MaterializationCallbacks){
  if(started?.alreadyMaterialized)return started;
  let uploaded=false,phase:Phase="RENDER_FAILED";
  try{
    if(!["DOCX","PDF"].includes(started?.renderFormat))throw new ApiException("TAILORING_FORMAT_INVALID","The reserved artifact format is invalid.",HttpStatus.BAD_GATEWAY);
    const isPdf=started.renderFormat==="PDF",mimeType=isPdf?"application/pdf":"application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const bytes=isPdf?await renderTailoredResumePdf(started):await renderTailoredResumeDocx(started);
    if(!bytes.length||bytes.length>5242880)throw new ApiException("TAILORING_ARTIFACT_INVALID",`The rendered ${isPdf?"PDF":"DOCX"} must be between 1 byte and 5 MiB.`,HttpStatus.BAD_GATEWAY);
    phase="UPLOAD_FAILED";
    await client.storage.from(started.targetBucket).remove([started.targetPath]);
    const upload=await client.storage.from(started.targetBucket).upload(started.targetPath,bytes,{contentType:mimeType,upsert:false});
    if(upload.error)throw new ApiException("UPLOAD_FAILED","The private tailored Resume could not be uploaded.",HttpStatus.BAD_GATEWAY);
    uploaded=true;phase="FINALIZE_FAILED";
    return await callbacks.finalize({materializationToken:started.materializationToken,storagePath:started.targetPath,filename:started.filename,mimeType,fileSizeBytes:bytes.length,fileSha256:createHash("sha256").update(bytes).digest("hex")});
  }catch(error){
    if(uploaded)await client.storage.from(started.targetBucket).remove([started.targetPath]);
    try{await callbacks.fail(phase,started.materializationToken);}catch{}
    if(error instanceof ApiException)throw error;
    throw new ApiException(phase,"Automatic Resume creation failed. The approved content remains available for retry.",HttpStatus.BAD_GATEWAY);
  }
}
