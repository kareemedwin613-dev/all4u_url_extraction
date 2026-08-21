import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;

export class JobDescriptionReviewDto {
  @IsIn(["NEEDS_REVIEW", "APPROVED", "NEEDS_CORRECTION", "DECLINED"])
  reviewStatus!: "NEEDS_REVIEW" | "APPROVED" | "NEEDS_CORRECTION" | "DECLINED";

  @IsOptional()
  @IsIn(["EXPIRED", "NOT_ELIGIBLE", "DUPLICATE", "INVALID_URL", "OTHER"])
  declineReason?: "EXPIRED" | "NOT_ELIGIBLE" | "DUPLICATE" | "INVALID_URL" | "OTHER";

  @Transform(trim) @IsOptional() @IsString() @MaxLength(1000)
  comment?: string;
}
