import{Type}from"class-transformer";import{ArrayMaxSize,ArrayMinSize,ArrayUnique,IsArray,IsIn,IsInt,IsISO8601,IsNumber,IsObject,IsOptional,IsString,IsUUID,Max,MaxLength,Min,ValidateNested}from"class-validator";
export const ROLE_CODES=["APPLIER","APPLYING_MANAGER","DEVELOPER","DEVELOPMENT_MANAGER","ADMIN"];
export class UserListQueryDto{@IsOptional()@IsString()@MaxLength(100)search="";@IsOptional()@IsIn(["ACTIVE","INACTIVE"])status?:string;@IsOptional()@IsIn(ROLE_CODES)roleCode?:string;@IsOptional()@IsIn(["name_asc","name_desc","email_asc","email_desc","status_asc","status_desc","roles_asc","roles_desc","created_asc","created_desc"])sort="created_desc";@IsOptional()@Type(()=>Number)@IsInt()@Min(1)page=1;@IsOptional()@Type(()=>Number)@IsInt()@IsIn([25,50,100])pageSize=25;}
export class RoleMutationDto{@IsIn(ROLE_CODES)roleCode!:string;}
export class UserStatusDto{@IsIn(["ACTIVE","INACTIVE"])status!:string;}
export class ProfileUpdateDto{@IsString()@MaxLength(200)fullName!:string;}
export class TailoringMatchDto{@IsUUID("4")resumeId!:string;@IsNumber()@Min(0)@Max(100)matchScore!:number;@IsObject()matchDetails!:Record<string,unknown>;}
export class TailoringCreateDto{@IsUUID("4")jobDescriptionId!:string;@IsArray()@ArrayMinSize(1)@ArrayMaxSize(100)@ValidateNested({each:true})@Type(()=>TailoringMatchDto)matches!:TailoringMatchDto[];}
export class TailoringListQueryDto{@IsOptional()@IsIn(["ALL","PENDING","PROCESSING","NEEDS_REVIEW","APPROVED","REJECTED","COMPLETED","FAILED","CANCELLED"])status="ALL";}
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
