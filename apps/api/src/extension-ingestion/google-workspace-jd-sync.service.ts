import {createHmac} from "node:crypto";
import {Inject,Injectable} from "@nestjs/common";
import type{AuthenticatedUser}from"@resume-jd/contracts";
import{JsonLogger}from"../common/logging/json-logger.service.js";
import{environment}from"../config/environment.js";
import{SupabaseService}from"../supabase/supabase.service.js";

export type WorkspaceSyncStatus={enabled:boolean;status:"DISABLED"|"PENDING"|"SUCCEEDED"|"FAILED";attemptCount?:number;errorCode?:string};
type JobRow=Record<string,any>;

function chunks(value:string,size=45000){const result:string[]=[];for(let index=0;index<value.length;index+=size)result.push(value.slice(index,index+size));return result.slice(0,5);}
function errorCode(error:unknown){const name=String((error as any)?.name||"");return name==="TimeoutError"||name==="AbortError"?"WORKSPACE_TIMEOUT":"WORKSPACE_REQUEST_FAILED";}

@Injectable()
export class GoogleWorkspaceJdSyncService{
  constructor(@Inject(SupabaseService)private readonly supabase:SupabaseService,@Inject(JsonLogger)private readonly logger:JsonLogger){}
  async sync(user:AuthenticatedUser,row:JobRow):Promise<WorkspaceSyncStatus>{
    const config=environment();
    if(!config.GOOGLE_WORKSPACE_JD_SYNC_ENABLED)return{enabled:false,status:"DISABLED"};
    const client=this.supabase.forUser(user.token);
    const begun=await client.rpc("begin_google_workspace_jd_sync",{p_job_description_id:row.id});
    if(begun.error||!begun.data){this.logger.warn("workspace.jd_sync_state_failed",{userId:user.id,jobDescriptionId:row.id,supabaseCode:begun.error?.code});return{enabled:true,status:"FAILED",errorCode:"SYNC_STATE_UNAVAILABLE"};}
    const state=begun.data as any,syncId=String(state.syncId||"");
    if(state.status==="SUCCEEDED")return{enabled:true,status:"SUCCEEDED",attemptCount:Number(state.attemptCount||0)};
    if(state.status!=="SYNCING"||!syncId)return{enabled:true,status:"PENDING",attemptCount:Number(state.attemptCount||0)};
    let succeeded=false,code="";
    try{
      const payload=JSON.stringify({
        jdId:row.id,company:row.company,jobTitle:row.job_title,categoryId:row.category_id,subcategoryId:row.subcategory_id,
        industryDomainCategoryId:row.industry_domain_category_id,seniority:row.seniority,location:row.location_text,
        workArrangement:row.work_arrangement,clearanceRequirements:row.clearance_requirements||[],travelRequired:row.travel_required,
        travelDetails:row.travel_details,salaryMin:row.salary_min,salaryMax:row.salary_max,salaryCurrency:row.salary_currency,
        salaryPeriod:row.salary_period,salaryText:row.salary_text,sourceWebsite:row.source_site,sourceUrl:row.source_url,
        detectedSkills:row.detected_skills||[],captureMethod:row.capture_method,extractionConfidence:row.extraction_confidence,
        capturedAt:row.created_at,capturedByUserId:user.id,capturedByEmail:user.email||"",descriptionChunks:chunks(String(row.description_text||"")),
      });
      const timestamp=Date.now().toString(),signature=createHmac("sha256",config.GOOGLE_WORKSPACE_JD_SYNC_SECRET).update(`${timestamp}.${payload}`).digest("hex");
      const response=await fetch(config.GOOGLE_WORKSPACE_JD_SYNC_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({timestamp,payload,signature}),redirect:"follow",signal:AbortSignal.timeout(config.GOOGLE_WORKSPACE_JD_SYNC_TIMEOUT_MS)});
      if(!response.ok)code=`WORKSPACE_HTTP_${response.status}`;
      else{const body=await response.json().catch(()=>null)as any;if(body?.ok===true&&body?.jdId===row.id)succeeded=true;else code="WORKSPACE_RESPONSE_INVALID";}
    }catch(error){code=errorCode(error);}
    const finished=await client.rpc("finish_google_workspace_jd_sync",{p_sync_id:syncId,p_succeeded:succeeded,p_error_code:succeeded?null:code});
    if(finished.error){this.logger.warn("workspace.jd_sync_finish_failed",{userId:user.id,jobDescriptionId:row.id,syncId,supabaseCode:finished.error.code});return{enabled:true,status:"FAILED",attemptCount:Number(state.attemptCount||0),errorCode:"SYNC_STATE_UNAVAILABLE"};}
    if(!succeeded)this.logger.warn("workspace.jd_sync_failed",{userId:user.id,jobDescriptionId:row.id,syncId,errorCode:code});
    return{enabled:true,status:succeeded?"SUCCEEDED":"FAILED",attemptCount:Number((finished.data as any)?.attemptCount||state.attemptCount||0),...(succeeded?{}:{errorCode:code})};
  }
}
