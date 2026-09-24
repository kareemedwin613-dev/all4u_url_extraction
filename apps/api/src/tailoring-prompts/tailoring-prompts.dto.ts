import { Transform } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, Matches, IsObject } from "class-validator";

export class PromptBodyDto {
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString() @Length(1, 120) name!: string;
  @IsString() @Length(1, 20000) @Matches(/\S/) instructions!: string;
  @IsInt() @Min(0) @Max(100000) priority = 0;
}
export class CreatePromptDto extends PromptBodyDto {
  @IsIn(["GENERIC", "PRIMARY", "SUBTYPE"]) scope!: "GENERIC" | "PRIMARY" | "SUBTYPE";
  @IsOptional() @IsUUID("4") primaryCategoryId?: string | null;
  @IsOptional() @IsUUID("4") subcategoryId?: string | null;
}
export class SavePromptDto extends PromptBodyDto {
  @IsInt() @Min(1) @Max(2147483647) expectedRevision!: number;
}
export class PromptRevisionDto {
  @IsInt() @Min(1) @Max(2147483647) expectedRevision!: number;
}
export class RestorePromptDto extends PromptRevisionDto {
  @IsInt() @Min(1) @Max(2147483647) version!: number;
}
export class PreviewPromptDto {
  @IsUUID("4") jobDescriptionId!: string;
}
export class CreatePromptTestDto extends PromptRevisionDto {
  @IsUUID("4") applicationId!: string;
}
export class PromptTestRunnerDto {
  @IsString() @Matches(/^tpt_[0-9a-f]{64}$/) ticket!: string;
  @IsIn(["CLAIM", "SUBMIT", "FAIL"]) action!: string;
  @IsOptional() @IsObject() result?: Record<string, unknown>;
  @IsOptional() @IsString() @Matches(/^[A-Z_]{1,80}$/) failureCode?: string;
}
