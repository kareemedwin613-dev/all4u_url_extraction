import { Transform, Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;
const JOB_SORTS = ["company_asc","company_desc","title_asc","title_desc","category_asc","category_desc","subcategory_asc","subcategory_desc","seniority_asc","seniority_desc","source_asc","source_desc","capturer_asc","capturer_desc","status_asc","status_desc","created_asc","created_desc"];
const SENIORITIES = ["INTERN","ENTRY","JUNIOR","MID","SENIOR","LEAD","PRINCIPAL","MANAGER","DIRECTOR","EXECUTIVE","UNSPECIFIED"];

export class JobDescriptionQueryDto {
  @Transform(trim) @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsIn(SENIORITIES) seniority?: string;
  @IsOptional() @IsIn(["ACTIVE", "ARCHIVED"]) status?: string;
  @IsOptional() @IsDateString() capturedFrom?: string;
  @IsOptional() @IsDateString() capturedTo?: string;
  @IsOptional() @IsIn(JOB_SORTS) sort?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @IsIn([10, 25, 50]) pageSize?: number;
}

export class JobCountQueryDto {
  @IsOptional() @IsIn(["ACTIVE", "ARCHIVED"]) status?: string;
}

export class RecentJobsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) limit?: number;
}
