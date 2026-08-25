import{HttpStatus,Inject,Injectable}from"@nestjs/common";import type{AuthenticatedUser}from"@resume-jd/contracts";import{randomUUID}from"node:crypto";import{ApiException}from"../common/errors/api.exception.js";import{SupabaseService}from"../supabase/supabase.service.js";
const safeName=(value:string)=>String(value||"file").normalize("NFKC").replace(/[^A-Za-z0-9._-]+/g,"_").replace(/^\.+/,"").slice(-180)||"file";
function failure(error:any,fallback:string):never{
  const raw=String(error?.message||"");
  if(error?.code==="PGRST202"||/could not find the function|schema cache/i.test(raw))throw new ApiException("DATABASE_MIGRATION_REQUIRED","The database schema is older than this application. Apply the pending Supabase migrations and retry.",HttpStatus.SERVICE_UNAVAILABLE);
  const known=raw.match(/^([A-Z][A-Z0-9_]+):\s*(.+)$/),code=known?.[1]||(error?.code==="42501"?"APPLICATION_ACCESS_DENIED":"DATABASE_ERROR"),message=known?.[2]||fallback,status=error?.code==="42501"||code.includes("ACCESS_DENIED")?HttpStatus.FORBIDDEN:code.includes("NOT_FOUND")?HttpStatus.NOT_FOUND:code.includes("DUPLICATE")||code.includes("UNAVAILABLE")||code==="PROFILE_REVIEW_REQUIRED"||code==="AUTOFILL_CONTEXT_STALE"?HttpStatus.CONFLICT:known?HttpStatus.BAD_REQUEST:HttpStatus.BAD_GATEWAY;
  throw new ApiException(code,message,status);
}
@Injectable()export class ApplicationService{constructor(@Inject(SupabaseService)private readonly supabase:SupabaseService){}
  private status(row:any){if(row?.status)return row.status;const application=row?.application_status||row?.applicationStatus,work=row?.work_status||row?.workStatus;if(application&&application!=="NOT_APPLIED")return application;return work==="COMPLETED"?"CLOSED":work||"UNASSIGNED";}
  private normalized(row:any){return row&&typeof row==="object"?{...row,status:this.status(row)}:row;}
  private filters(status=""){return["UNASSIGNED","ASSIGNED","IN_PROGRESS","BLOCKED","CANCELLED"].includes(status)?{work:status,application:""}:{work:"",application:status};}
  private async rpc(user:AuthenticatedUser,name:string,args:any,fallback:string){const{data,error}=await this.supabase.forUser(user.token).rpc(name,args);if(error)failure(error,fallback);return data;}
  private async extensionRpc(user:AuthenticatedUser,name:string,args:any,fallback:string){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([this.rpc(user,name,args,fallback),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ApiException("UPSTREAM_TIMEOUT","The extension request timed out. Try again.",HttpStatus.GATEWAY_TIMEOUT)),10000);})]);}finally{if(timer)clearTimeout(timer);}}
  async list(user:AuthenticatedUser,q:any){
    const f=this.filters(q.status||""),
      size=q.pageSize||25,
      page=q.page||1,
      dueFilter=q.dueFilter==="TODAY"?"DUE_TODAY":(q.dueFilter||""),
      data:any=await this.rpc(user,"list_applications_v07",{
        p_search:q.search||"",
        p_assigned_to:q.assignedTo||null,
        p_work_status:f.work,
        p_application_status:f.application,
        p_priority:q.priority||"",
        p_company:q.company||"",
        p_category_id:q.categoryId||null,
        p_due_filter:dueFilter,
        p_sort:q.sort||"updated_desc",
        p_creation_batch_id:q.creationBatchId||null,
        p_creation_mode:q.creationMode||"",
        p_limit:size,
        p_offset:(page-1)*size,
      },"Applications could not be loaded."),
      total=Number(data?.total)||0,
      pageCount=total?Math.ceil(total/size):0,
      safePage=pageCount?Math.min(page,pageCount):1;
    return{
      items:(data?.items||[]).map((x:any)=>this.normalized(x)),
      total,
      page:safePage,
      pageSize:size,
      pageCount,
      from:total?(safePage-1)*size+1:0,
      to:total?Math.min(safePage*size,total):0,
      hasPrevious:safePage>1,
      hasNext:safePage<pageCount,
    };
  }
  async mine(user:AuthenticatedUser,q:any){const data:any=await this.rpc(user,"list_my_applications_v17",{p_status:q.status||"",p_sort:q.sort||"updated_desc",p_limit:Math.min(Number(q.limit)||100,100)},"Your Applications could not be loaded.");return{...data,items:(data?.items||[]).map((x:any)=>this.normalized(x))};}
  async detail(u:AuthenticatedUser,id:string){const data:any=await this.rpc(u,"get_application_detail",{p_application_id:id},"The Application could not be loaded.");return{...data,application:this.normalized(data?.application)};}
  counts=(u:AuthenticatedUser,from:string,to:string)=>this.rpc(u,"get_application_counts_v29",{p_from:from,p_to:to},"Application counts could not be loaded.");
  appliers=(u:AuthenticatedUser,s="")=>this.rpc(u,"list_active_appliers",{p_search:s,p_limit:200},"Active Appliers could not be loaded.");
  jobs=(u:AuthenticatedUser,s="")=>this.rpc(u,"list_application_jobs",{p_search:s,p_limit:200},"Job descriptions could not be loaded.");
  async resumes(u:AuthenticatedUser,id:string,s=""){const rows:any[]=await this.rpc(u,"list_application_resumes",{p_job_description_id:id,p_search:s,p_limit:200},"Active Resumes could not be loaded.");return(rows||[]).filter(row=>String(row?.resume_type||row?.resumeType||"ORIGINAL")==="ORIGINAL");}
  create=(u:AuthenticatedUser,m:any)=>this.rpc(u,"create_application",{p_job_description_id:m.jobDescriptionId,p_resume_id:m.resumeId,p_assigned_to:m.assignedTo||null,p_priority:m.priority,p_due_at:m.dueAt||null,p_notes:m.notes||null},"The Application could not be created.");
  async extensionContext(u:AuthenticatedUser,id:string){const data:any=await this.extensionRpc(u,"get_application_extension_context_v085",{p_application_id:id},"The extension context could not be loaded.");return{...data,application:{...data?.application,status:this.status(data?.application),workStatus:undefined,applicationStatus:undefined}};}
  createExtensionSession=(u:AuthenticatedUser,id:string,m:any)=>this.extensionRpc(u,"create_application_extension_session_v085",{p_application_id:id,p_action:m.action,p_extension_version:m.extensionVersion||null},"The extension session could not be created.");
  autofillContext=(u:AuthenticatedUser,id:string,q:any)=>this.extensionRpc(u,"get_application_autofill_context_v089",{p_application_id:id,p_session_id:q.sessionId,p_expected_resume_updated_at:q.resumeUpdatedAt||null},"The Autofill context could not be loaded.");
  updateExtensionSession=(u:AuthenticatedUser,id:string,m:any)=>this.extensionRpc(u,"update_application_extension_session_v085",{p_session_id:id,p_status:m.status,p_error_code:m.errorCode||null},"The extension session could not be updated.");
  recordAutofillTelemetry=(u:AuthenticatedUser,id:string,m:any)=>this.extensionRpc(u,"record_application_autofill_telemetry_v094",{p_session_id:id,p_resume_updated_at_snapshot:m.resumeUpdatedAt,p_adapter_id:m.adapterId,p_adapter_version:m.adapterVersion,p_target_domain:m.targetDomain,p_detected_count:m.detectedCount,p_selected_count:m.selectedCount,p_succeeded_count:m.succeededCount,p_failed_count:m.failedCount,p_unresolved_count:m.unresolvedCount,p_fields:m.fields},"Autofill session feedback could not be recorded.");
  autofillRecovery=(u:AuthenticatedUser,id:string)=>this.extensionRpc(u,"get_application_autofill_recovery_v096",{p_session_id:id},"The Autofill recovery state could not be loaded.");
  updateAutofillRecovery=(u:AuthenticatedUser,id:string,m:any)=>this.extensionRpc(u,"update_application_autofill_recovery_v096",{p_session_id:id,p_target_origin:m.targetOrigin,p_step_identifier:m.stepIdentifier,p_resume_updated_at_snapshot:m.resumeUpdatedAt,p_adapter_id:m.adapterId||null,p_adapter_version:m.adapterVersion||null},"The Autofill recovery state could not be updated.");
  autofillQualityReport=(u:AuthenticatedUser,days:number)=>this.rpc(u,"get_autofill_quality_report_v098",{p_days:Math.max(1,Math.min(Number(days)||30,90))},"The Autofill quality report could not be loaded.");
  async resumeAccess(u:AuthenticatedUser,id:string){const context:any=await this.extensionContext(u,id);if(!context?.permissions?.canLoadResume||context?.resume?.status!=="ACTIVE")throw new ApiException("APPLICATION_RESUME_UNAVAILABLE","The active Resume is not available for this Application.",HttpStatus.CONFLICT);const file:any=await this.extensionRpc(u,"get_application_resume_file",{p_application_id:id},"The Resume is not available for this Application.");const mimeType=String(context.resume.mimeType||""),fileSizeBytes=Number(context.resume.fileSizeBytes),filename=String(context.resume.originalFilename||file?.filename||"");if(!["application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","text/plain"].includes(mimeType)||!Number.isSafeInteger(fileSizeBytes)||fileSizeBytes<1||fileSizeBytes>5242880||!filename||file?.filename!==filename)throw new ApiException("APPLICATION_RESUME_METADATA_INVALID","The Resume metadata is invalid or does not match this Application.",HttpStatus.CONFLICT);const expiresInSeconds=60,{data,error}=await this.supabase.forUser(u.token).storage.from(file.bucket).createSignedUrl(file.path,expiresInSeconds);if(error||!data?.signedUrl)failure(error,"The private Resume file could not be opened.");return{signedUrl:data.signedUrl,filename,mimeType,fileSizeBytes,expiresAt:new Date(Date.now()+expiresInSeconds*1000).toISOString()};}
  update=(u:AuthenticatedUser,id:string,m:any)=>this.rpc(u,"update_application_status_v101",{p_application_id:id,p_status:m.status,p_application_url:m.applicationUrl||null,p_applied_at:m.appliedAt||null,p_notes:m.notes==null?null:String(m.notes),p_priority:m.priority??null,p_due_at:m.dueAt??null},"The Application could not be updated.");
  assign=(u:AuthenticatedUser,id:string,m:any)=>this.rpc(u,"reassign_application",{p_application_id:id,p_new_assignee_id:m.newAssigneeId||null,p_reason:m.reason||null},"The assignment could not be changed.");
  preview=(u:AuthenticatedUser,m:any)=>this.rpc(u,"preview_bulk_applications",{p_selected_jd_ids:[...new Set(m.jobDescriptionIds)]},"The bulk preview could not be generated.");
  bulkCreate=(u:AuthenticatedUser,m:any)=>this.rpc(u,"create_applications_bulk",{p_combinations:m.combinations,p_batch_name:String(m.batchName||"").trim()||null},"The bulk Applications could not be created.");
  async batches(u:AuthenticatedUser,q:any){const size=q.pageSize||25,page=q.page||1,data:any=await this.rpc(u,"list_application_batches_v2",{p_search:q.search||"",p_status:q.status||"",p_sort:q.sort||"created_desc",p_limit:size,p_offset:(page-1)*size},"Application batches could not be loaded."),total=Number(data?.total)||0,pageCount=total?Math.ceil(total/size):0;return{...data,total,page:pageCount?Math.min(page,pageCount):1,pageSize:size,pageCount,from:total?(page-1)*size+1:0,to:Math.min(page*size,total),hasPrevious:page>1,hasNext:page<pageCount};}
  batchOptions=(u:AuthenticatedUser)=>this.rpc(u,"list_application_batch_options",{p_limit:200},"Batch options could not be loaded.");
  batch=(u:AuthenticatedUser,id:string)=>this.rpc(u,"get_application_batch_detail",{p_batch_id:id},"The Application batch could not be loaded.");
  async resumeUrl(u:AuthenticatedUser,id:string){const file:any=await this.rpc(u,"get_application_resume_download_v17",{p_application_id:id},"The Resume is not available for this Application."),number=Number(file?.resumeNumber),type=String(file?.resumeType||""),mime=String(file?.mimeType||""),size=Number(file?.fileSizeBytes);if(!file?.bucket||!file?.path||!file?.filename||!Number.isSafeInteger(number)||number<1||!["ORIGINAL","TAILORED"].includes(type)||!["application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","text/plain"].includes(mime)||!Number.isSafeInteger(size)||size<1||size>5242880)throw new ApiException("APPLICATION_RESUME_METADATA_INVALID","The attached Resume metadata is invalid.",HttpStatus.CONFLICT);const{data,error}=await this.supabase.forUser(u.token).storage.from(file.bucket).createSignedUrl(file.path,90);if(error||!data?.signedUrl)failure(error,"The private Resume file could not be opened.");return{signedUrl:data.signedUrl,expiresInSeconds:90,filename:file.filename,mimeType:mime,fileSizeBytes:size,resumeNumber:number,resumeType:type};}
  async screenshots(u:AuthenticatedUser,id:string){const{data,error}=await this.supabase.forUser(u.token).from("application_screenshots").select("id,storage_bucket,storage_path,original_filename,mime_type,file_size_bytes,created_at").eq("application_id",id).order("created_at",{ascending:false});if(error)failure(error,"Screenshots could not be loaded.");return data||[];}
  async addScreenshot(u:AuthenticatedUser,id:string,file:any){const allowed=["image/png","image/jpeg","image/webp","application/pdf"];if(!file||file.size<1||file.size>5242880||!allowed.includes(file.mimetype))throw new ApiException("APPLICATION_SCREENSHOT_INVALID","Use a PNG, JPG, WEBP, or PDF file between 1 byte and 5 MiB.",HttpStatus.BAD_REQUEST);const path=`${id}/${randomUUID()}-${safeName(file.originalname)}`,client=this.supabase.forUser(u.token),uploaded=await client.storage.from("application-screenshots").upload(path,file.buffer,{contentType:file.mimetype,upsert:false});if(uploaded.error)failure(uploaded.error,"The screenshot file could not be uploaded.");try{return await this.rpc(u,"attach_application_screenshot",{p_application_id:id,p_storage_path:path,p_original_filename:file.originalname,p_mime_type:file.mimetype,p_file_size_bytes:file.size},"The screenshot could not be attached.");}catch(error){await client.storage.from("application-screenshots").remove([path]);throw error;}}
  async removeScreenshot(u:AuthenticatedUser,id:string,screenshotId:string){const client=this.supabase.forUser(u.token),{data:existing,error:lookupError}=await client.from("application_screenshots").select("id").eq("application_id",id).eq("id",screenshotId).maybeSingle();if(lookupError)failure(lookupError,"The screenshot could not be loaded.");if(!existing)throw new ApiException("APPLICATION_SCREENSHOT_NOT_FOUND","The screenshot was not found.",HttpStatus.NOT_FOUND);const result:any=await this.rpc(u,"remove_application_screenshot",{p_screenshot_id:screenshotId},"The screenshot could not be removed.");if(result?.storagePath)await client.storage.from(result.storageBucket||"application-screenshots").remove([result.storagePath]);return result;}
  async screenshotUrl(u:AuthenticatedUser,id:string,screenshotId:string){const{data:row,error}=await this.supabase.forUser(u.token).from("application_screenshots").select("storage_bucket,storage_path,original_filename").eq("application_id",id).eq("id",screenshotId).maybeSingle();if(error)failure(error,"The screenshot could not be loaded.");if(!row)throw new ApiException("APPLICATION_SCREENSHOT_NOT_FOUND","The screenshot was not found.",HttpStatus.NOT_FOUND);const{data,error:storageError}=await this.supabase.forUser(u.token).storage.from(row.storage_bucket).createSignedUrl(row.storage_path,90);if(storageError||!data?.signedUrl)failure(storageError,"The private screenshot could not be opened.");return{signedUrl:data.signedUrl,expiresInSeconds:90,filename:row.original_filename};}
}
