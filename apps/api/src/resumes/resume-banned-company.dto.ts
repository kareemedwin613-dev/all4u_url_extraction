import { Transform } from "class-transformer";
import { IsString, Length } from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export class ResumeBannedCompanyDto {
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  companyName!: string;
}
