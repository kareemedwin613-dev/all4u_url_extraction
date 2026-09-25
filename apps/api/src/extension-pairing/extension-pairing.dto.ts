import { IsString, IsUUID, Length, Matches } from "class-validator";

export class ApproveExtensionPairingDto {
  @IsUUID("4")
  pairingId!: string;

  // SHA-256 of the extension's secret, as lowercase hex. The secret itself never reaches the dashboard.
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  challenge!: string;
}

export class RedeemExtensionPairingDto {
  @IsUUID("4")
  pairingId!: string;

  @IsString()
  @Length(32, 128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  secret!: string;
}
