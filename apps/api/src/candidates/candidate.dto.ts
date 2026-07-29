import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUrl, Max, MaxLength, Min, ValidateNested } from "class-validator";

export class CandidateAddressDto {
  @IsOptional() @IsString() @MaxLength(200) addressLine1?: string;
  @IsOptional() @IsString() @MaxLength(200) addressLine2?: string;
  @IsOptional() @IsString() @MaxLength(120) city?: string;
  @IsOptional() @IsString() @MaxLength(120) stateRegion?: string;
  @IsOptional() @IsString() @MaxLength(40) postalCode?: string;
  @IsOptional() @IsString() @MaxLength(120) country?: string;
}
export class CandidateLinkDto {
  @IsIn(["LINKEDIN", "GITHUB", "PORTFOLIO", "OTHER"]) linkType!: string;
  @IsOptional() @IsString() @MaxLength(120) label?: string;
  @IsUrl({ protocols: ["https"], require_protocol: true, require_valid_protocol: true }) @MaxLength(2000) url!: string;
}

export class UpdateCandidateProfileDto {
  @IsString() @MaxLength(200) fullName!: string;
  @IsOptional() @IsString() @MaxLength(100) firstName?: string;
  @IsOptional() @IsString() @MaxLength(100) middleName?: string;
  @IsOptional() @IsString() @MaxLength(100) lastName?: string;
  @IsOptional() @IsEmail() @MaxLength(320) email?: string;
  @IsOptional() @IsString() @MaxLength(60) phone?: string;
  @IsIn(["NEEDS_REVIEW", "VERIFIED"]) reviewStatus!: "NEEDS_REVIEW" | "VERIFIED";
  @IsOptional() @IsObject() @ValidateNested() @Type(() => CandidateAddressDto) primaryAddress?: CandidateAddressDto;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => CandidateLinkDto) links?: CandidateLinkDto[];
}

export class CandidateEmploymentDto {
  @IsString() @MaxLength(200) company!: string;
  @IsString() @MaxLength(200) jobTitle!: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
  @IsOptional() @IsISO8601({ strict: true }) startDate?: string | null;
  @IsOptional() @IsISO8601({ strict: true }) endDate?: string | null;
  @IsBoolean() isCurrent = false;
  @IsOptional() @IsString() @MaxLength(30000) experienceDetails?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) displayOrder = 0;
}

export class CandidateEducationDto {
  @IsString() @MaxLength(240) institution!: string;
  @IsOptional() @IsString() @MaxLength(200) degree?: string;
  @IsOptional() @IsString() @MaxLength(200) fieldOfStudy?: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
  @IsOptional() @IsISO8601({ strict: true }) startDate?: string | null;
  @IsOptional() @IsISO8601({ strict: true }) endDate?: string | null;
  @IsOptional() @IsString() @MaxLength(40) gpa?: string;
  @IsOptional() @IsString() @MaxLength(10000) details?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) displayOrder = 0;
}
