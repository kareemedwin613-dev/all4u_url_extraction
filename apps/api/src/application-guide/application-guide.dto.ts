import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, ValidateNested } from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export const GUIDE_AUTOFILL_SOURCES = [
  "candidate.currentLocation", "candidate.postalCode", "candidate.city", "candidate.state", "candidate.country",
  "candidate.email", "candidate.phone", "candidate.fullName", "candidate.linkedInUrl", "candidate.addressLine1",
  "gender", "pronouns", "salaryExpectation", "startAvailability", "gpa", "totalYearsOfExperience",
] as const;

// How Autofill treats the question: NONE guidance only, FIXED answer, DERIVED from the Resume or JD, NEVER a person answers.
export class GuideAutofillRuleDto {
  @IsIn(["NONE", "FIXED", "DERIVED", "NEVER"])
  mode!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(0, 500)
  value?: string;

  @IsOptional()
  @IsIn([...GUIDE_AUTOFILL_SOURCES])
  source?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 300, { each: true })
  patterns?: string[];

  @IsOptional()
  @IsBoolean()
  sensitive?: boolean;
}

export class SaveApplicationGuideDto {
  @IsOptional()
  @IsUUID("4")
  id?: string;

  @Transform(trim)
  @IsString()
  @Length(1, 300)
  question!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 2000)
  meaning!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 4000)
  howToAnswer!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  exampleAnswer?: string;

  @Transform(trim)
  @IsIn(["DRAFT", "PUBLISHED"])
  status!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GuideAutofillRuleDto)
  autofill?: GuideAutofillRuleDto;
}
