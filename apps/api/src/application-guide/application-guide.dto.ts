import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, IsUUID, Length } from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export class SaveApplicationGuideDto {
  @IsOptional()
  @IsUUID("4")
  id?: string;

  @Transform(trim)
  @IsString()
  @Length(1, 300)
  question!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 2000)
  meaning!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 4000)
  howToAnswer!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  exampleAnswer?: string;

  @Transform(trim)
  @IsIn(["DRAFT", "PUBLISHED"])
  status!: string;
}
