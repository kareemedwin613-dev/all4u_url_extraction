import{Type}from"class-transformer";import{ArrayMaxSize,ArrayMinSize,ArrayUnique,IsArray,IsIn,IsInt,IsISO8601,IsNumber,IsObject,IsOptional,IsString,IsUUID,Matches,Max,MaxLength,Min,ValidateNested}from"class-validator";
export const ROLE_CODES=["APPLIER","APPLYING_MANAGER","DEVELOPER","DEVELOPMENT_MANAGER","JD_FINDER","ADMIN"];
export class UserListQueryDto{@IsOptional()@IsString()@MaxLength(100)search="";@IsOptional()@IsIn(["ACTIVE","INACTIVE"])status?:string;@IsOptional()@IsIn(ROLE_CODES)roleCode?:string;@IsOptional()@IsIn(["name_asc","name_desc","email_asc","email_desc","status_asc","status_desc","roles_asc","roles_desc","created_asc","created_desc"])sort="created_desc";@IsOptional()@Type(()=>Number)@IsInt()@Min(1)page=1;@IsOptional()@Type(()=>Number)@IsInt()@IsIn([25,50,100])pageSize=25;}
export class RoleMutationDto{@IsIn(ROLE_CODES)roleCode!:string;}
export class UserStatusDto{@IsIn(["ACTIVE","INACTIVE"])status!:string;}
export class ProfileUpdateDto{@IsString()@MaxLength(200)fullName!:string;}
export class OverviewQueryDto{@IsISO8601()from!:string;@IsISO8601()to!:string;}
export class TailoringMatchDto{@IsUUID("4")resumeId!:string;@IsNumber()@Min(0)@Max(100)matchScore!:number;@IsObject()matchDetails!:Record<string,unknown>;}
export class TailoringCreateDto{@IsUUID("4")jobDescriptionId!:string;@IsArray()@ArrayMinSize(1)@ArrayMaxSize(100)@ValidateNested({each:true})@Type(()=>TailoringMatchDto)matches!:TailoringMatchDto[];}
export class TailoringListQueryDto{@IsOptional()@IsIn(["ALL","PENDING","PROCESSING","NEEDS_REVIEW","APPROVED","MATERIALIZING","REJECTED","COMPLETED","FAILED","CANCELLED"])status="ALL";}
export class TailoredExperienceDto{@IsString()@MaxLength(120)sourceExperienceId!:string;@IsString()@MaxLength(12000)tailoredDetails!:string;}
export class TailoringPreviewResultDto{
  @IsString()@MaxLength(4000)summary!:string;
  @IsArray()@ArrayMinSize(1)@ArrayMaxSize(30)@ValidateNested({each:true})@Type(()=>TailoredExperienceDto)professionalExperience!:TailoredExperienceDto[];
  @IsArray()@ArrayMaxSize(250)@ArrayUnique(value=>String(value).toLowerCase())@IsString({each:true})@MaxLength(120,{each:true})skills!:string[];
  @IsArray()@ArrayMaxSize(100)@IsString({each:true})@MaxLength(500,{each:true})changeSummary!:string[];
  @IsArray()@ArrayMaxSize(100)@IsString({each:true})@MaxLength(500,{each:true})unsupportedRequirements!:string[];
  @IsArray()@ArrayMaxSize(100)@IsString({each:true})@MaxLength(500,{each:true})warnings!:string[];
}
export class SubmitTailoringPreviewDto{@IsISO8601()generatedAt!:string;@ValidateNested()@Type(()=>TailoringPreviewResultDto)result!:TailoringPreviewResultDto;}
export class ReviewTailoringPreviewDto{@IsIn(["SAVE_DRAFT","APPROVE","REJECT"])action!:"SAVE_DRAFT"|"APPROVE"|"REJECT";@ValidateNested()@Type(()=>TailoringPreviewResultDto)preview!:TailoringPreviewResultDto;@IsOptional()@IsString()@MaxLength(1000)notes="";@IsISO8601()expectedUpdatedAt!:string;}
export class SelectTailoringTemplateDto{@IsIn(["CLASSIC_V1","MODERN_V1","COMPACT_V1"])renderTemplateKey!:"CLASSIC_V1"|"MODERN_V1"|"COMPACT_V1";@IsISO8601()expectedUpdatedAt!:string;}
export class SelectTailoringFormatDto{@IsIn(["DOCX","PDF"])renderFormat!:"DOCX"|"PDF";@IsISO8601()expectedUpdatedAt!:string;}
export class TailoringRunnerTicketDto{@IsString()@Matches(/^trt_[A-Za-z0-9_-]{43}$/)ticket!:string;}
export class BulkApplicationTailoringDto{@IsArray()@ArrayMinSize(1)@ArrayMaxSize(100)@IsUUID("4",{each:true})applicationIds!:string[];}
export class BulkTailoringRunnerTicketsDto{@IsArray()@ArrayMinSize(1)@ArrayMaxSize(5)@IsUUID("4",{each:true})jobIds!:string[];}
export class SubmitTailoringRunnerPreviewDto extends TailoringRunnerTicketDto{@IsISO8601()generatedAt!:string;@ValidateNested()@Type(()=>TailoringPreviewResultDto)result!:TailoringPreviewResultDto;}
export class FailTailoringRunnerDto extends TailoringRunnerTicketDto{@IsIn(["CODEX_FAILED","VALIDATION_FAILED","API_SUBMISSION_FAILED","WORKER_FAILED"])failureCode!:string;}
