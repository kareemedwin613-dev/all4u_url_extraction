import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsNumber, IsOptional, IsString, IsUrl, IsUUID, Length, Matches, Max, MaxLength, Min, MinLength } from "class-validator";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;
const nullableTrim = ({ value }: { value: unknown }) => value == null || value === "" ? null : typeof value === "string" ? value.trim() : value;
export enum SeniorityDto { INTERN="INTERN", ENTRY="ENTRY", JUNIOR="JUNIOR", MID="MID", SENIOR="SENIOR", LEAD="LEAD", PRINCIPAL="PRINCIPAL", MANAGER="MANAGER", DIRECTOR="DIRECTOR", EXECUTIVE="EXECUTIVE", UNSPECIFIED="UNSPECIFIED" }
export enum WorkArrangementDto { REMOTE="REMOTE", HYBRID="HYBRID", ONSITE="ONSITE", UNSPECIFIED="UNSPECIFIED" }

export class CreateJobDescriptionDto {
  @Transform(trim) @IsUrl({ protocols: ["http", "https"], require_protocol: true }) @MaxLength(4000) sourceUrl!: string;
  @Transform(trim) @IsString() @MaxLength(255) @IsOptional() sourceWebsite?: string;
  @Transform(trim) @IsString() @Length(1, 200) company!: string;
  @Transform(trim) @IsString() @Length(1, 200) jobTitle!: string;
  @Transform(trim) @IsString() @MinLength(100) @MaxLength(200000) descriptionText!: string;
  @IsUUID() categoryId!: string;
  @IsOptional() @IsUUID() subcategoryId?: string | null;
  @IsOptional() @IsUUID() industryDomainCategoryId?: string | null;
  @IsOptional() @IsEnum(SeniorityDto) seniority?: SeniorityDto;
  @Transform(nullableTrim) @IsOptional() @IsString() @MaxLength(300) locationText?: string | null;
  @IsOptional() @IsEnum(WorkArrangementDto) workArrangement?: WorkArrangementDto;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsIn(["PUBLIC_TRUST","DOD_SECRET","TOP_SECRET","TS_SCI","OTHER_SECURITY_CLEARANCE"], { each: true }) clearanceRequirements?: string[];
  @IsOptional() @IsBoolean() travelRequired?: boolean | null;
  @Transform(nullableTrim) @IsOptional() @IsString() @MaxLength(500) travelDetails?: string | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(999999999999.99) salaryMin?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(999999999999.99) salaryMax?: number | null;
  @Transform(nullableTrim) @IsOptional() @Matches(/^[A-Z]{3}$/) salaryCurrency?: string | null;
  @IsOptional() @IsIn(["HOUR","DAY","WEEK","MONTH","YEAR","OTHER"]) salaryPeriod?: string | null;
  @Transform(nullableTrim) @IsOptional() @IsString() @MaxLength(500) salaryText?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(250) @IsString({ each: true }) @MaxLength(100, { each: true }) detectedSkills?: string[];
  @IsOptional() @IsIn(["json-ld","site-specific","dom","selected-text","manual"]) captureMethod?: string;
  @IsOptional() @IsIn(["high","medium","low"]) extractionConfidence?: string;
  @IsOptional() @IsDateString() capturedAt?: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(50) extensionVersion?: string;
}
