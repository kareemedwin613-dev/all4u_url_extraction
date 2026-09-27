import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SupabaseModule } from "../supabase/supabase.module.js";
import { ExtensionPairingController } from "./extension-pairing.controller.js";
import { ExtensionPairingService } from "./extension-pairing.service.js";
import { ExtensionSessionMinter } from "./extension-session-minter.js";

@Module({ imports: [AuthModule, SupabaseModule], controllers: [ExtensionPairingController], providers: [ExtensionPairingService, ExtensionSessionMinter] })
export class ExtensionPairingModule {}
