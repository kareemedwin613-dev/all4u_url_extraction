import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from "class-validator";

export class BulkPreviewDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID("4", { each: true })
  jobDescriptionIds!: string[];
}

export class BulkCreatePairDto {
  @IsUUID("4") jobDescriptionId!: string;
  @IsUUID("4") resumeId!: string;
}

export class BulkCreateDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => BulkCreatePairDto)
  combinations!: BulkCreatePairDto[];
  @IsOptional() @IsString() @MaxLength(120) batchName?: string;
}

const BATCH_STATUSES = ["", "PROCESSING", "COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED"];
const BATCH_SORTS = ["created_desc", "created_asc", "name_asc", "name_desc", "creator_asc", "creator_desc", "selected_asc", "selected_desc", "requested_asc", "requested_desc", "created_count_asc", "created_count_desc", "duplicate_asc", "duplicate_desc", "skipped_asc", "skipped_desc", "failed_asc", "failed_desc", "status_asc", "status_desc"];

export class BatchListQueryDto {
  @IsOptional() @IsString() @MaxLength(500) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit = 25;
  @IsOptional() @IsIn(BATCH_STATUSES) status = "";
  @IsOptional() @IsUUID("4") createdBy?: string;
  @IsOptional() @IsISO8601() createdFrom?: string;
  @IsOptional() @IsISO8601() createdTo?: string;
  @IsOptional() @IsString() @MaxLength(100) search = "";
  @IsOptional() @IsIn(BATCH_SORTS) sort = "created_desc";
  // Retained for the existing Ant Design numbered paginator.
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @IsIn([25, 50, 100]) pageSize?: number;
}

export class BatchResultsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @IsIn([25, 50, 100]) limit = 25;
  @IsOptional() @IsIn(["", "CREATED", "DUPLICATE", "SKIPPED", "FAILED"]) outcome = "";
  @IsOptional() @IsString() @MaxLength(100) company = "";
  @IsOptional() @IsString() @MaxLength(100) jobTitle = "";
  @IsOptional() @IsString() @MaxLength(100) candidate = "";
  @IsOptional() @IsString() @MaxLength(100) resume = "";
}
