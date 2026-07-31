import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsDefined, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, Validate, ValidatorConstraint, type ValidationArguments, type ValidatorConstraintInterface } from "class-validator";

export const RESUME_ANSWER_KEYS = ["authorized_to_work","requires_sponsorship","willing_to_relocate","available_start_date","desired_salary","years_of_experience","remote_work_preference"] as const;
export const RESUME_ANSWER_TYPES = ["BOOLEAN","NUMBER","DATE","TEXT","SINGLE_SELECT"] as const;
const prohibited=/\b(race|racial|ethnicity|ethnic|gender|sex|sexual|orientation|religion|religious|disability|disabled|medical|veteran|military status|criminal|conviction|arrest|marital|pregnan\w*|genetic)\b/i;

@ValidatorConstraint({name:"safeQuestionPatterns",async:false})
class SafeQuestionPatterns implements ValidatorConstraintInterface{
  validate(value:unknown){return Array.isArray(value)&&value.every(item=>typeof item==="string"&&!prohibited.test(item));}
  defaultMessage(){return"Question patterns cannot contain prohibited sensitive categories.";}
}

@ValidatorConstraint({name:"typedResumeAnswer",async:false})
class TypedResumeAnswer implements ValidatorConstraintInterface{
  validate(value:unknown,args:ValidationArguments){const body=args.object as SaveResumeAnswerDto;switch(body.answerType){case"BOOLEAN":return typeof value==="boolean";case"NUMBER":return typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<=100;case"DATE":return typeof value==="string"&&/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`));case"TEXT":return typeof value==="string"&&value.trim().length>=1&&value.trim().length<=500;case"SINGLE_SELECT":return typeof value==="string"&&["REMOTE","HYBRID","ONSITE","FLEXIBLE","NO_PREFERENCE"].includes(value.toUpperCase());default:return false;}}
  defaultMessage(){return"Answer value does not match the selected answer type.";}
}

export class SaveResumeAnswerDto {
  @IsIn(RESUME_ANSWER_KEYS) answerKey!: typeof RESUME_ANSWER_KEYS[number];
  @IsArray() @ArrayMaxSize(20) @IsString({each:true}) @MaxLength(300,{each:true}) @Validate(SafeQuestionPatterns) questionPatterns!: string[];
  @IsIn(RESUME_ANSWER_TYPES) answerType!: typeof RESUME_ANSWER_TYPES[number];
  @IsDefined() @Validate(TypedResumeAnswer) answerValue!: unknown;
  @IsIn(["NEEDS_REVIEW","VERIFIED"]) reviewStatus!: "NEEDS_REVIEW"|"VERIFIED";
  @IsOptional() @IsBoolean() active = true;
}

// Kept separate so numeric coercion is never applied to answerValue.
export class ResumeAnswerListQueryDto {
  @IsOptional() @Type(()=>Number) @IsNumber() @Min(1) @Max(100) limit = 100;
}
