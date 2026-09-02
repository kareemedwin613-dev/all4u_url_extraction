import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID } from "class-validator";

export class BulkApplicationBatchDeleteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  batchIds!: string[];
}
