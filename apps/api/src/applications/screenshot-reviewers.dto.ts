import { Transform, Type } from "class-transformer";
import { IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from "class-validator";

const emptyToNull = ({ value }: { value: unknown }) => {
  const text = String(value ?? "").trim();
  return text ? text : null;
};

export class SetScreenshotReviewersDto {
  @Transform(emptyToNull)
  @IsOptional()
  @IsUUID("4")
  primaryReviewerId?: string | null;

  @Transform(emptyToNull)
  @IsOptional()
  @IsUUID("4")
  secondaryReviewerId?: string | null;
}

export class ScreenshotReviewAssignmentsQueryDto {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;
}

export class ProfileScreenshotApplicationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
