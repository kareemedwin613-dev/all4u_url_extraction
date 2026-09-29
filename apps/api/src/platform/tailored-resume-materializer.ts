import{createHash}from"node:crypto";
import{HttpStatus}from"@nestjs/common";
import{ApiException}from"../common/errors/api.exception.js";

type Phase="RENDER_FAILED"|"UPLOAD_FAILED"|"FINALIZE_FAILED";
interface MaterializationCallbacks{
  finalize:(details:{materializationToken:string;storagePath:string;filename:string;mimeType:string;fileSizeBytes:number;fileSha256:string})=>Promise<any>;
  fail:(phase:Phase,materializationToken:string)=>Promise<unknown>;
}

export async function materializeTailoredResumeArtifact(client:any,started:any,callbacks:MaterializationCallbacks){
  if(started?.alreadyMaterialized)return started;
  let phase:Phase="RENDER_FAILED";
  try{
    if(started?.renderFormat!=="PDF")throw new ApiException("TAILORING_FORMAT_INVALID","Tailored Resumes can only be created as PDF files.",HttpStatus.BAD_GATEWAY);
    const mimeType="application/pdf";
    const{renderTailoredResumePdf}=await import("./tailored-resume-pdf.renderer.js"),bytes=await renderTailoredResumePdf(started);
    if(!bytes.length||bytes.length>5242880)throw new ApiException("TAILORING_ARTIFACT_INVALID","The rendered PDF must be between 1 byte and 5 MiB.",HttpStatus.BAD_GATEWAY);
    phase="UPLOAD_FAILED";
    // A unique attempt path is supplied by the database. Never remove an older
    // archived file to make room, and never overwrite on an upload conflict.
    const upload=await client.storage.from(started.targetBucket).upload(started.targetPath,bytes,{contentType:mimeType,upsert:false});
    if(upload.error)throw new ApiException("UPLOAD_FAILED","The private tailored Resume could not be uploaded.",HttpStatus.BAD_GATEWAY,undefined,undefined,{stage:"UPLOAD_FAILED",storageError:{name:upload.error.name,statusCode:upload.error.statusCode,message:upload.error.message}});
    phase="FINALIZE_FAILED";
    return await callbacks.finalize({materializationToken:started.materializationToken,storagePath:started.targetPath,filename:started.filename,mimeType,fileSizeBytes:bytes.length,fileSha256:createHash("sha256").update(bytes).digest("hex")});
  }catch(error){
    // A lost finalize response may mean the transaction committed. Preserve the
    // object rather than risking deletion of an active Resume; retry reconciles it.
    try{await callbacks.fail(phase,started.materializationToken);}catch{}
    if(error instanceof ApiException)throw error;
    throw new ApiException(phase,"Automatic Resume creation failed. The approved content remains available for retry.",HttpStatus.BAD_GATEWAY);
  }
}
