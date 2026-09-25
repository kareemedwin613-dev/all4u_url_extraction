import { IsString, MaxLength } from "class-validator";

export class ResumeHeadlineDto {
  // An empty string clears the fallback headline.
  @IsString()
  @MaxLength(80)
  headline!: string;
}
