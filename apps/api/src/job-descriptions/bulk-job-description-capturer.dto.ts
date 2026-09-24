import { Transform } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;

export class BulkJobDescriptionCapturerDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  jobDescriptionIds!: string[];

  @IsUUID("4")
  newUserId!: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(1000)
  reason?: string;
}
