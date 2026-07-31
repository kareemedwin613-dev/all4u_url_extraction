import {HttpStatus,Inject,Injectable} from "@nestjs/common";
import type {AuthenticatedUser} from "@resume-jd/contracts";
import {ApiException} from "../common/errors/api.exception.js";
import {SupabaseService} from "../supabase/supabase.service.js";
import type {SaveResumeAnswerDto} from "./resume-answer.dto.js";

function failure(error:any,fallback:string):never{
  const raw=String(error?.message||""),known=raw.match(/^([A-Z][A-Z0-9_]+):\s*(.+)$/),code=known?.[1]||(error?.code==="42501"?"RESUME_ANSWER_ACCESS_DENIED":"DATABASE_ERROR");
  const status=error?.code==="42501"||code.includes("ACCESS_DENIED")?HttpStatus.FORBIDDEN:code.includes("NOT_FOUND")?HttpStatus.NOT_FOUND:code.includes("DUPLICATE")?HttpStatus.CONFLICT:known?HttpStatus.BAD_REQUEST:HttpStatus.BAD_GATEWAY;
  throw new ApiException(code,known?.[2]||fallback,status);
}

@Injectable()
export class ResumeAnswerService{
  constructor(@Inject(SupabaseService)private readonly supabase:SupabaseService){}
  private async rpc(user:AuthenticatedUser,name:string,args:Record<string,unknown>,fallback:string){
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{const result:any=await Promise.race([this.supabase.forUser(user.token).rpc(name,args),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ApiException("UPSTREAM_TIMEOUT","The Resume Answer Library request timed out. Try again.",HttpStatus.GATEWAY_TIMEOUT)),10000);})]);if(result.error)failure(result.error,fallback);return result.data;}finally{if(timer)clearTimeout(timer);}
  }
  list=(user:AuthenticatedUser,resumeId:string)=>this.rpc(user,"list_resume_application_answers_v090",{p_resume_id:resumeId},"Resume answers could not be loaded.");
  save=(user:AuthenticatedUser,resumeId:string,value:SaveResumeAnswerDto,answerId?:string)=>this.rpc(user,"save_resume_application_answer_v090",{p_resume_id:resumeId,p_answer_id:answerId||null,p_answer_key:value.answerKey,p_question_patterns:value.questionPatterns.map(item=>item.trim()).filter(Boolean),p_answer_type:value.answerType,p_answer_value:value.answerValue,p_review_status:value.reviewStatus,p_active:value.active!==false},"The Resume answer could not be saved.");
  saveAll=(user:AuthenticatedUser,resumeId:string,values:SaveResumeAnswerDto[])=>this.rpc(user,"save_resume_application_answers_v091",{p_resume_id:resumeId,p_answers:values.map(value=>({answerKey:value.answerKey,questionPatterns:value.questionPatterns.map(item=>item.trim()).filter(Boolean),answerType:value.answerType,answerValue:value.answerValue,reviewStatus:value.reviewStatus,active:value.active!==false}))},"The Resume answers could not be saved.");
  archive=(user:AuthenticatedUser,resumeId:string,answerId:string)=>this.rpc(user,"archive_resume_application_answer_v090",{p_resume_id:resumeId,p_answer_id:answerId},"The Resume answer could not be archived.");
}
