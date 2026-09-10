import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class BulkJobSubcategoryUpdateItemDto {
  @IsUUID("4") jobDescriptionId!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsUUID("4", { each: true }) subcategoryIds?: string[];
  @IsOptional() @IsString() @MaxLength(2000) subcategories?: string;
}

export class BulkJobSubcategoryImportDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => BulkJobSubcategoryUpdateItemDto)
  updates!: BulkJobSubcategoryUpdateItemDto[];
}
