import { Inject, Injectable } from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service.js";
import { evaluationArchived } from "./evaluation-archive.js";

@Injectable()
export class ApplicationMatchRunnerService {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}
  async call(operation: string, body: { ticket: string; [key: string]: unknown }) {
    return evaluationArchived();
  }
}
