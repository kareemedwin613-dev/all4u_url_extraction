import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from "class-validator";

export const ASSIGNMENT_STRATEGIES = ["PROFILE"] as const;
/** Historical batch strategies still appear in list/detail filters. */
export const ASSIGNMENT_BATCH_STRATEGY_FILTER = ["", "PROFILE", "MANUAL", "EVEN", "CAPACITY_AWARE"] as const;

export class ManualAssignmentDto {
  @IsUUID("4") applicationId!: string;
  @IsUUID("4") assignedTo!: string;
}

export class BulkAssignmentPreviewDto {
  @IsIn(ASSIGNMENT_STRATEGIES) strategy!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5000) @IsUUID("4", { each: true }) applicationIds!: string[];
}

export class BulkAssignDto {
  @IsOptional() @IsString() @MaxLength(120) batchName?: string;
  @IsIn(ASSIGNMENT_STRATEGIES) strategy!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => ManualAssignmentDto) assignments!: ManualAssignmentDto[];
}

const bool = ({ value }: { value: unknown }) => value === "true" ? true : value === "false" ? false : value;

export class WorkloadListQueryDto {
  @IsOptional() @IsString() @MaxLength(100) search = "";
  @IsOptional() @Transform(bool) @IsBoolean() isAvailable?: boolean;
  @IsOptional() @Transform(bool) @IsBoolean() hasCapacity?: boolean;
  @IsOptional() @IsString() @MaxLength(500) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
}

export class UpdateWorkloadSettingsDto {
  @IsBoolean() isAvailable!: boolean;
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) maxActiveApplications!: number;
}

export class AssignmentBatchListQueryDto {
  @IsOptional() @IsString() @MaxLength(500) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsIn(["", "PROCESSING", "COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED"]) status = "";
  @IsOptional() @IsIn(ASSIGNMENT_BATCH_STRATEGY_FILTER) strategy = "";
  @IsOptional() @IsUUID("4") createdBy?: string;
  @IsOptional() @IsISO8601() createdFrom?: string;
  @IsOptional() @IsISO8601() createdTo?: string;
  @IsOptional() @IsString() @MaxLength(100) search = "";
}

export class AssignmentBatchResultsQueryDto {
  @IsOptional() @IsString() @MaxLength(500) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsIn(["", "ASSIGNED", "SKIPPED", "FAILED"]) outcome = "";
}
