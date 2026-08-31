import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class BulkApplicationCancelDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  applicationIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  notes?: string;
}
