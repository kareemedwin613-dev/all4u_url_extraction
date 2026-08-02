import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUrl, IsUUID, Matches, MaxLength, Min, ValidateNested } from "class-validator";

const WORK_STATUSES=["UNASSIGNED","ASSIGNED","IN_PROGRESS","BLOCKED","COMPLETED","CANCELLED"];
const APPLICATION_STATUSES=["NOT_APPLIED","APPLIED","SCREENING","INTERVIEW_SCHEDULED","OFFER_RECEIVED","REJECTED","WITHDRAWN","CLOSED"];
const PRIORITIES=["LOW","NORMAL","HIGH","URGENT"];

export class ApplicationListQueryDto{
  @IsOptional()@IsString()@MaxLength(100)search="";
  @IsOptional()@IsUUID("4")assignedTo?:string;
  @IsOptional()@IsIn(["",...WORK_STATUSES])workStatus="";
  @IsOptional()@IsIn(["",...APPLICATION_STATUSES])applicationStatus="";
  @IsOptional()@IsIn(["",...PRIORITIES])priority="";
  @IsOptional()@IsString()@MaxLength(100)company="";
  @IsOptional()@IsUUID("4")categoryId?:string;
  @IsOptional()@IsIn(["","TODAY","OVERDUE","NEXT_7_DAYS","NO_DUE_DATE"])dueFilter="";
  @IsOptional()@IsUUID("4")creationBatchId?:string;
  @IsOptional()@IsIn(["","BULK","INDIVIDUAL"])creationMode="";
  @IsOptional()@IsISO8601()cursorUpdatedAt?:string;
  @IsOptional()@IsUUID("4")cursorId?:string;
  @IsOptional()@Type(()=>Number)@IsInt()@IsIn([25,50,100])pageSize=25;
}
export class MyApplicationQueryDto{
  @IsOptional()@IsIn(["",...APPLICATION_STATUSES])applicationStatus="";
  @IsOptional()@IsIn(["updated_desc","updated_asc","company_asc","company_desc","title_asc","title_desc","captured_asc","captured_desc"])sort="updated_desc";
  @IsOptional()@Type(()=>Number)@IsInt()@Min(1)limit=100;
}
export class SearchOptionsQueryDto{@IsOptional()@IsString()@MaxLength(100)search="";}
export class ResumeOptionsQueryDto extends SearchOptionsQueryDto{@IsUUID("4")jobDescriptionId!:string;}
export class CreateApplicationDto{
  @IsUUID("4")jobDescriptionId!:string;@IsUUID("4")resumeId!:string;
  @IsOptional()@IsUUID("4")assignedTo?:string;@IsIn(PRIORITIES)priority!:string;
  @IsOptional()@IsISO8601()dueAt?:string;@IsOptional()@IsString()@MaxLength(10000)notes?:string;
}
export class UpdateApplicationDto{
  @IsIn(WORK_STATUSES)workStatus!:string;@IsIn(APPLICATION_STATUSES)applicationStatus!:string;
  @IsOptional()@IsUrl({protocols:["http","https"],require_protocol:true,require_tld:false})@MaxLength(4000)applicationUrl?:string;
  @IsOptional()@IsISO8601()appliedAt?:string;@IsOptional()@IsString()@MaxLength(10000)notes?:string;
  @IsOptional()@IsIn(PRIORITIES)priority?:string;@IsOptional()@IsISO8601()dueAt?:string;
}
export class ReassignApplicationDto{@IsOptional()@IsUUID("4")newAssigneeId?:string;@IsOptional()@IsString()@MaxLength(2000)reason?:string;}
export class CreateApplicationExtensionSessionDto{
  @IsIn(["LOAD_RESUME","AUTOFILL"])action!:string;
  @IsOptional()@IsString()@MaxLength(40)extensionVersion?:string;
}
export class UpdateApplicationExtensionSessionDto{
  @IsIn(["RECEIVED","TARGET_READY","COMPLETED","CANCELLED","FAILED"])status!:string;
  @IsOptional()@IsString()@MaxLength(80)@Matches(/^[A-Z][A-Z0-9_]{0,79}$/)errorCode?:string;
}
export class ResumeAccessDto {}
export class ApplicationAutofillContextQueryDto {
  @IsUUID("4") sessionId!: string;
  @IsOptional() @IsISO8601({ strict: true }) resumeUpdatedAt?: string;
}
export class BulkPreviewDto{@IsArray()@ArrayMinSize(1)@ArrayMaxSize(100)@IsUUID("4",{each:true})jobDescriptionIds!:string[];}
export class BulkCombinationDto{@IsUUID("4")job_description_id!:string;@IsUUID("4")resume_id!:string;}
export class BulkCreateDto{
  @IsArray()@ArrayMinSize(1)@ArrayMaxSize(2000)@ValidateNested({each:true})@Type(()=>BulkCombinationDto)combinations!:BulkCombinationDto[];
  @IsOptional()@IsString()@MaxLength(120)batchName?:string;
}
export class BatchListQueryDto{
  @IsOptional()@IsString()@MaxLength(100)search="";@IsOptional()@IsIn(["","PROCESSING","COMPLETED","COMPLETED_WITH_WARNINGS","FAILED"])status="";
  @IsOptional()@IsIn(["created_desc","created_asc","name_asc","name_desc","status_asc","status_desc","created_count_asc","created_count_desc"])sort="created_desc";
  @IsOptional()@Type(()=>Number)@IsInt()@Min(1)page=1;@IsOptional()@Type(()=>Number)@IsInt()@IsIn([25,50,100])pageSize=25;
}
