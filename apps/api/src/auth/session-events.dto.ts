import { IsIn } from "class-validator";

export class RecordLoginEventDto {
  @IsIn(["DASHBOARD", "EXTENSION"])
  clientType!: "DASHBOARD" | "EXTENSION";
}
