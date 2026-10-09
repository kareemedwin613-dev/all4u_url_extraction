import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";

// One employer question the Autofill rules could not answer: its wording and, for choice controls, the
// option labels. Never answers, candidate values, Resume or JD content.
export class AutofillAiQuestionDto {
  @IsString() @MaxLength(300) @Matches(/\S/) question!: string;
  @IsIn(["input", "select", "textarea", "radio", "checkbox", "combobox"]) controlType!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(25) @IsString({ each: true }) @MaxLength(120, { each: true }) options?: string[];
}

export class RecognizeAutofillQuestionsDto {
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => AutofillAiQuestionDto) questions!: AutofillAiQuestionDto[];
}

// Admin settings. Model names are also checked against the model list in model-catalog.ts.
export class SaveAutofillAiSettingsDto {
  @IsBoolean() enabled!: boolean;
  @IsIn(["openai", "xai"]) provider!: "openai" | "xai";
  @IsString() @Matches(/^[a-z0-9][a-z0-9.-]{1,60}$/) recognitionModel!: string;
  @IsString() @Matches(/^[a-z0-9][a-z0-9.-]{1,60}$/) draftingModel!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10000) monthlyCapUsd!: number;
}

// An Admin's choice for one person: Off, Match questions, or Match and draft answers.
export class SetAutofillAiAccessDto {
  @IsIn(["OFF", "MATCH", "DRAFT"]) level!: "OFF" | "MATCH" | "DRAFT";
}

export class TestAutofillAiModelDto {
  @IsIn(["openai", "xai"]) provider!: "openai" | "xai";
  @IsString() @Matches(/^[a-z0-9][a-z0-9.-]{1,60}$/) model!: string;
}

// An open-ended question to draft an answer for: wording and field type only.
export class AutofillDraftQuestionDto {
  @IsString() @MaxLength(300) @Matches(/\S/) question!: string;
  @IsIn(["input", "textarea"]) controlType!: "input" | "textarea";
  @IsOptional() @IsInt() @Min(1) @Max(20000) maxLength?: number;
}

export class DraftAutofillAnswersDto {
  @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => AutofillDraftQuestionDto) questions!: AutofillDraftQuestionDto[];
}
