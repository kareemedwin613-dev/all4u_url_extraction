import { IsString, MaxLength } from "class-validator";

export class ResumeCoverLetterTextDto {
  // An empty string clears the base letter.
  @IsString()
  @MaxLength(20000)
  text!: string;
}
