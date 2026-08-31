import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUrl, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";

const APPLICATION_STATUSES=["UNASSIGNED","ASSIGNED","IN_PROGRESS","BLOCKED","APPLIED","SCREENING","INTERVIEW_SCHEDULED","OFFER_RECEIVED","REJECTED","WITHDRAWN","CLOSED","CANCELLED"];
const APPLIER_MINE_STATUSES=["","ASSIGNED","APPLIED","BLOCKED"] as const;
const PRIORITIES=["LOW","NORMAL","HIGH","URGENT"];

export class ApplicationListQueryDto{
  @IsOptional()@IsString()@MaxLength(100)search="";
  @IsOptional()@IsUUID("4")assignedTo?:string;
  @IsOptional()@IsIn(["",...APPLICATION_STATUSES])status="";
  @IsOptional()@IsIn(["",...PRIORITIES])priority="";
  @IsOptional()@IsString()@MaxLength(100)company="";
  @IsOptional()@IsUUID("4")categoryId?:string;
  @IsOptional()@IsIn(["","TODAY","DUE_TODAY","OVERDUE","NEXT_7_DAYS","NO_DUE_DATE"])dueFilter="";
  @IsOptional()@IsUUID("4")creationBatchId?:string;
  @IsOptional()@IsIn(["","BULK","INDIVIDUAL"])creationMode="";
  @IsOptional()@IsIn(["updated_desc","updated_asc","company_asc","company_desc","title_asc","title_desc","number_asc","number_desc","priority_asc","priority_desc","due_asc","due_desc","captured_asc","captured_desc","category_asc","category_desc","assignee_asc","assignee_desc","batch_asc","batch_desc"])sort="updated_desc";
  @IsOptional()@Type(()=>Number)@IsInt()@Min(1)page=1;
  @IsOptional()@Type(()=>Number)@IsInt()@IsIn([25,50,100,500,1000,5000])pageSize=25;
}
export class MyApplicationQueryDto{
  @IsOptional()@IsIn(APPLIER_MINE_STATUSES)status="";
  @IsOptional()@IsUUID("4")resumeId?:string;
  @IsOptional()@IsIn(["updated_desc","updated_asc","company_asc","company_desc","title_asc","title_desc","captured_asc","captured_desc"])sort="updated_desc";
  @IsOptional()@Type(()=>Number)@IsInt()@Min(1)@Max(500)limit=100;
}
export class SearchOptionsQueryDto{@IsOptional()@IsString()@MaxLength(100)search="";}
export class ResumeOptionsQueryDto extends SearchOptionsQueryDto{@IsUUID("4")jobDescriptionId!:string;}
export class CreateApplicationDto{
  @IsUUID("4")jobDescriptionId!:string;@IsUUID("4")resumeId!:string;
  @IsOptional()@IsUUID("4")assignedTo?:string;@IsIn(PRIORITIES)priority!:string;
  @IsOptional()@IsISO8601()dueAt?:string;@IsOptional()@IsString()@MaxLength(10000)notes?:string;
}
export class UpdateApplicationDto{
  @IsIn(APPLICATION_STATUSES)status!:string;
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
export class ApplicationCountQueryDto{@IsISO8601()from!:string;@IsISO8601()to!:string;}
export class ApplicationAutofillFieldTelemetryDto{
  @IsString()@MaxLength(100)@Matches(/^(candidate|screening|employment|education)\.[A-Za-z0-9][A-Za-z0-9_.-]{0,96}$/)fieldKey!:string;
  @Type(()=>Number)@IsInt()@Min(0)@Max(99)fieldIndex!:number;
  @Type(()=>Number)@IsInt()@Min(0)@Max(100)confidence!:number;
  @IsIn(["DETECTED","VERIFIED","FAILED","SKIPPED"])outcome!:string;
  @IsOptional()@IsString()@MaxLength(80)@Matches(/^[A-Z][A-Z0-9_]{0,79}$/)errorCode?:string;
}
export class RecordApplicationAutofillTelemetryDto{
  @IsISO8601({strict:true})resumeUpdatedAt!:string;
  @IsString()@MaxLength(80)@Matches(/^[a-z0-9][a-z0-9-]{0,79}$/)adapterId!:string;
  @IsString()@MaxLength(40)@Matches(/^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$/)adapterVersion!:string;
  @IsString()@MaxLength(253)@Matches(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/)targetDomain!:string;
  @Type(()=>Number)@IsInt()@Min(0)@Max(100)detectedCount!:number;
  @Type(()=>Number)@IsInt()@Min(0)@Max(100)selectedCount!:number;
  @Type(()=>Number)@IsInt()@Min(0)@Max(100)succeededCount!:number;
  @Type(()=>Number)@IsInt()@Min(0)@Max(100)failedCount!:number;
  @Type(()=>Number)@IsInt()@Min(0)@Max(100)unresolvedCount!:number;
  @IsArray()@ArrayMaxSize(100)@ValidateNested({each:true})@Type(()=>ApplicationAutofillFieldTelemetryDto)fields!:ApplicationAutofillFieldTelemetryDto[];
}
export class UpdateApplicationAutofillRecoveryDto{
  @IsUrl({protocols:["http","https"],require_protocol:true,require_tld:false})@MaxLength(300)targetOrigin!:string;
  @IsIn(["NEW","DETECTED","FILLING","PARTIAL","FILLED"])stepIdentifier!:string;
  @IsISO8601({strict:true})resumeUpdatedAt!:string;
  @IsOptional()@IsString()@MaxLength(80)@Matches(/^[a-z0-9][a-z0-9-]{0,79}$/)adapterId?:string;
  @IsOptional()@IsString()@MaxLength(40)@Matches(/^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$/)adapterVersion?:string;
}
export class ResumeAccessDto {}
export class ApplicationAutofillContextQueryDto {
  @IsUUID("4") sessionId!: string;
  @IsOptional() @IsISO8601({ strict: true }) resumeUpdatedAt?: string;
}
export class BulkPreviewDto{@IsArray()@ArrayMinSize(1)@ArrayMaxSize(1000)@IsUUID("4",{each:true})jobDescriptionIds!:string[];}
export class BulkCombinationDto{@IsUUID("4")job_description_id!:string;@IsUUID("4")resume_id!:string;}
export class BulkCreateDto{
  @IsArray()@ArrayMinSize(1)@ArrayMaxSize(5000)@ValidateNested({each:true})@Type(()=>BulkCombinationDto)combinations!:BulkCombinationDto[];
  @IsOptional()@IsString()@MaxLength(120)batchName?:string;
}
export class BatchListQueryDto{
  @IsOptional()@IsString()@MaxLength(100)search="";@IsOptional()@IsIn(["","PROCESSING","COMPLETED","COMPLETED_WITH_WARNINGS","FAILED"])status="";
  @IsOptional()@IsIn(["created_desc","created_asc","name_asc","name_desc","status_asc","status_desc","created_count_asc","created_count_desc"])sort="created_desc";
  @IsOptional()@Type(()=>Number)@IsInt()@Min(1)page=1;@IsOptional()@Type(()=>Number)@IsInt()@IsIn([25,50,100])pageSize=25;
}
