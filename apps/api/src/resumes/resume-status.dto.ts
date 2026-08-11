import { IsIn } from "class-validator";

export class ResumeStatusDto {
  @IsIn(["ACTIVE", "ARCHIVED"])
  status!: "ACTIVE" | "ARCHIVED";
}
