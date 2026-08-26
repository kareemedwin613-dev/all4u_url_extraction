import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsUUID } from "class-validator";

const toArray = ({ value }: { value: unknown }) => (Array.isArray(value) ? value : value == null ? [] : [value]);

export class SetApplierResumeProfilesDto {
  @Transform(toArray)
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID("4", { each: true })
  @Type(() => String)
  resumeIds!: string[];
}
