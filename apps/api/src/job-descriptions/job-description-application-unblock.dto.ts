import { IsOptional, IsString, MaxLength } from "class-validator";

export class JobDescriptionApplicationUnblockDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
