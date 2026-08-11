import { IsIn, IsOptional } from "class-validator";

export class JobDescriptionStatusDto {
  @IsIn(["ACTIVE", "ARCHIVED"])
  status!: "ACTIVE" | "ARCHIVED";

  @IsOptional()
  @IsIn(["NOT_APPLICABLE", "EXPIRED", "DUPLICATE", "OTHER"])
  reason?: "NOT_APPLICABLE" | "EXPIRED" | "DUPLICATE" | "OTHER";
}
