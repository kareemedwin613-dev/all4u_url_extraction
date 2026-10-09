import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, Matches, ValidateNested } from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

// An Admin's correction of a learned wording: a standard answer, a Resume answer, a contact field, or no standard
// answer with the kind of question. The database checks that the target exists.
export class CorrectLearnedWordingDto {
  @IsString()
  @Matches(/^(guide\.[0-9a-f-]{36}|answer\.[a-z_]{2,40}|field\.[A-Za-z0-9]{2,40}|none)$/)
  targetKey!: string;

  @IsOptional()
  @IsIn(["SAME_FOR_EVERYONE", "DEPENDS_ON_PROFILE", "ESSAY", "NOT_A_QUESTION"])
  answerKind?: string;
}

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
