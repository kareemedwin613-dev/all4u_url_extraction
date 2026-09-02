import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID } from "class-validator";

export class BulkApplicationDeleteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  applicationIds!: string[];
}
