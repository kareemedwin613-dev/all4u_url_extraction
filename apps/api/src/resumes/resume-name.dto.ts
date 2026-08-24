import { IsString, MaxLength, MinLength } from "class-validator";

export class ResumeNameDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  resumeName!: string;
}
