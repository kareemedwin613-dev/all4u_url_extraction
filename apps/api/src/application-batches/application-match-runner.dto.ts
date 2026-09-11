import { IsBoolean, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, IsInt, IsIn, Min, Max } from "class-validator";

export class MatchRunnerTicketDto {
  @IsString() @Matches(/^mrb_[A-Za-z0-9_-]{43}$/) ticket!: string;
}
export class MatchRunnerNextDto extends MatchRunnerTicketDto {
  @IsString() @Matches(/^[a-z0-9][a-z0-9._-]{0,100}$/i) modelId!: string;
  @IsString() @MaxLength(80) rubricVersion!: string;
  @IsString() @MaxLength(80) extractorVersion!: string;
  @IsIn(["direct-v1"]) scoringMode!: string;
}
export class MatchRunnerJobDto extends MatchRunnerTicketDto {
  @IsUUID("4") jobId!: string;
  @IsUUID("4") leaseToken!: string;
}
export class MatchRunnerDocumentDto extends MatchRunnerJobDto {
  @IsUUID("4") documentId!: string;
}
export class MatchRunnerDocumentResultDto extends MatchRunnerDocumentDto {
  @IsUUID("4") documentLeaseToken!: string;
  // Legacy transport shape; v3.76 rejects extraction operations with a worker-update error.
  @IsOptional() @IsObject() analysis!: Record<string, unknown> | null;
}
export class MatchRunnerResultDto extends MatchRunnerJobDto {
  @IsObject() result!: Record<string, unknown>;
}
export class MatchRunnerFailureDto extends MatchRunnerJobDto {
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{0,79}$/) code!: string;
  @IsBoolean() retryable!: boolean;
  @IsInt() @Min(1) @Max(900) retryAfterSeconds!: number;
}
