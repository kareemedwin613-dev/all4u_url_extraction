import { createHash } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "@resume-jd/contracts";
import { ApiException } from "../common/errors/api.exception.js";
import { JsonLogger } from "../common/logging/json-logger.service.js";
import { ApplicationBatchesRepository } from "./application-batches.repository.js";
import { mapBatch, mapCreation, mapResult } from "./application-batches.mapper.js";

const timeout = async <T>(work: Promise<T>, milliseconds: number, message = "The operation timed out. Retry with the same idempotency key.") => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([work, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new ApiException("REQUEST_TIMEOUT", message, HttpStatus.REQUEST_TIMEOUT)), milliseconds); })]);
  } finally { if (timer) clearTimeout(timer); }
};
const cursor = (offset: number) => Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
const decodeCursor = (value?: string) => {
  if (!value) return undefined;
  try { const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); if (!Number.isInteger(parsed.offset) || parsed.offset < 0) throw new Error(); return parsed.offset as number; }
  catch { throw new ApiException("VALIDATION_ERROR", "The batch cursor is invalid.", HttpStatus.BAD_REQUEST, undefined, { cursor: ["Use the opaque cursor returned by the API."] }); }
};

@Injectable()
export class ApplicationBatchesService {
  constructor(@Inject(ApplicationBatchesRepository) private readonly repository: ApplicationBatchesRepository, @Inject(JsonLogger) private readonly logger: JsonLogger) {}
  async preview(user: AuthenticatedUser, body: any, requestId: string) {
    const ids = [...new Set(body.jobDescriptionIds)];
    const matchingMode = body.matchingMode || "SCORE";
    const rpc = matchingMode === "CATEGORY" ? "preview_category_application_matches_v377" : "preview_application_matches";
    const startedAt = Date.now();
    let raw: any;
    try {
      raw = await timeout(this.repository.rpc(user, rpc, { p_selected_jd_ids: ids, p_resume_ids: body.resumeIds ? [...new Set(body.resumeIds)] : null }, "The matching preview could not be refreshed. Retry the preview; if it persists, check the API log using this request ID."), 10_000, "The matching preview timed out. Please retry the preview.");
    } catch (error) {
      const diagnostic = error instanceof ApiException ? error : undefined;
      this.logger.log("bulk.preview.failed", { requestId, rpc, matchingMode, selectedJdCount: ids.length, durationMs: Date.now() - startedAt,
        code: diagnostic?.code || "UNEXPECTED_ERROR", databaseCode: (diagnostic?.details as { databaseCode?: string } | undefined)?.databaseCode });
      throw error;
    }
    const combinations = (raw?.combinations || []).filter((row: any) => row?.resumeType === "ORIGINAL");
    const data = { ...raw, combinations, activeResumeCount: raw?.activeResumeCount ?? new Set(combinations.map((row: any) => row.resumeId)).size, proposedCount: combinations.length, eligibleCount: combinations.filter((row: any) => row.eligible).length, duplicateCount: combinations.filter((row: any) => row.exclusionCode === "EXISTING_APPLICATION").length, excludedCount: combinations.filter((row: any) => !row.eligible).length + Number(raw?.invalidJds?.length || 0) };
    this.logger.log("bulk.preview.completed", { requestId, userId: user.id, matchingMode, durationMs: Date.now() - startedAt, selectedJdCount: ids.length, proposedCount: data?.proposedCount || 0, duplicateCount: data?.duplicateCount || 0 });
    return { ...data, matchingMode };
  }
  async requestMatches(user: AuthenticatedUser, body: any) {
    const pairs = [...new Map(body.combinations.map((pair: any) => [`${pair.jobDescriptionId}:${pair.resumeId}`, { job_description_id: pair.jobDescriptionId, resume_id: pair.resumeId }])).values()];
    return timeout(this.repository.rpc(user, "request_application_matches_with_ticket", { p_combinations: pairs, p_retry_failed: body.retryFailed === true }, "Matching could not be queued."), 15_000);
  }
  revokeMatchTicket(user: AuthenticatedUser, id: string) {
    return this.repository.rpc(user, "revoke_application_match_ticket", { p_ticket_id: id }, "The scoring command could not be revoked.");
  }
  async create(user: AuthenticatedUser, body: any, idempotencyKey: string, requestId: string) {
    const pairs = [...new Map(body.combinations.map((pair: any) => [`${pair.jobDescriptionId}:${pair.resumeId}`, pair])).values()] as any[];
    const normalized = pairs.map((pair) => ({ job_description_id: pair.jobDescriptionId, resume_id: pair.resumeId })).sort((a, b) => `${a.job_description_id}:${a.resume_id}`.localeCompare(`${b.job_description_id}:${b.resume_id}`));
    const batchName = String(body.batchName || "").trim();
    const matchingMode = body.matchingMode || "SCORE";
    // Preserve existing SCORE retry hashes; CATEGORY has a distinct request identity.
    const hash = createHash("sha256").update(JSON.stringify({ batchName, combinations: normalized, ...(matchingMode === "CATEGORY" ? { matchingMode } : {}) })).digest("hex");
    const raw: any = await timeout(this.repository.rpc(user, matchingMode === "CATEGORY" ? "create_category_applications_bulk_api_v377" : "create_applications_bulk_api", { p_combinations: normalized, p_batch_name: batchName || null, p_idempotency_key: idempotencyKey, p_request_hash: hash }, "The bulk Applications could not be created."), 30_000);
    if (!raw || typeof raw !== "object") throw new ApiException("DATABASE_ERROR", "The bulk Applications could not be created.", HttpStatus.BAD_GATEWAY);
    const data = mapCreation(raw);
    this.logger.log("bulk.create.completed", { requestId, userId: user.id, requestedCombinationCount: pairs.length, batchId: data.batchId, createdCount: data.createdCount, duplicateCount: data.duplicateCount, skippedCount: data.skippedCount, failedCount: data.failedCount });
    return data;
  }
  async list(user: AuthenticatedUser, query: any) {
    const size = Math.min(query.pageSize || query.limit || 25, 100), decoded = decodeCursor(query.cursor), offset = decoded ?? (Math.max(query.page || 1, 1) - 1) * size;
    const raw: any = await timeout(this.repository.rpc(user, "list_application_batches_v074", { p_search: query.search || "", p_status: query.status || "", p_created_by: query.createdBy || null, p_created_from: query.createdFrom || null, p_created_to: query.createdTo || null, p_sort: query.sort || "created_desc", p_limit: size, p_offset: offset }, "Application batches could not be loaded."), 10_000);
    const total = Number(raw?.total || 0), items = (raw?.items || []).map(mapBatch), pageNumber = Math.floor(offset / size) + 1;
    return { items, total, page: pageNumber, pageSize: size, pageCount: total ? Math.ceil(total / size) : 0, nextCursor: offset + items.length < total ? cursor(offset + items.length) : null };
  }
  async options(user: AuthenticatedUser) { return timeout(this.repository.rpc(user, "list_application_batch_options", { p_limit: 200 }, "Batch options could not be loaded."), 10_000); }
  async detail(user: AuthenticatedUser, id: string) {
    const raw: any = await timeout(this.repository.rpc(user, "get_application_batch_summary_v074", { p_batch_id: id }, "The Application batch could not be loaded."), 10_000);
    return { ...mapBatch(raw.batch), applications: (raw.applications || []).map((row: any) => ({ id: row.id, applicationNumber: Number(row.application_number), company: row.company, jobTitle: row.job_title })) };
  }
  async results(user: AuthenticatedUser, id: string, query: any) {
    const size = query.limit || 25, offset = (query.page - 1) * size;
    const raw: any = await timeout(this.repository.rpc(user, "list_application_batch_results_v074", { p_batch_id: id, p_outcome: query.outcome || "", p_company: query.company || "", p_job_title: query.jobTitle || "", p_candidate: query.candidate || "", p_resume: query.resume || "", p_limit: size, p_offset: offset }, "Batch outcomes could not be loaded."), 10_000);
    const total = Number(raw?.total || 0);
    return { items: (raw?.items || []).map(mapResult), total, page: query.page, pageSize: size, pageCount: total ? Math.ceil(total / size) : 0 };
  }
  async bulkDelete(user: AuthenticatedUser, ids: string[]) {
    const unique = [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
    if (!unique.length) throw new ApiException("VALIDATION_ERROR", "Select at least one Application batch.", HttpStatus.BAD_REQUEST);
    if (unique.length > 100) throw new ApiException("VALIDATION_ERROR", "Select no more than 100 Application batches.", HttpStatus.BAD_REQUEST);
    const raw: any = await timeout(this.repository.rpc(user, "bulk_delete_application_batches_v316", { p_batch_ids: unique }, "The selected Application batches could not be deleted."), 30_000);
    if (!raw || typeof raw !== "object") throw new ApiException("DATABASE_ERROR", "The selected Application batches could not be deleted.", HttpStatus.BAD_GATEWAY);
    this.logger.log("application_batches.bulk_delete.completed", { userId: user.id, requestedCount: unique.length, succeeded: Number(raw.succeeded) || 0, failed: Number(raw.failed) || 0 });
    return {
      total: Number(raw.total) || unique.length,
      succeeded: Number(raw.succeeded) || 0,
      failed: Number(raw.failed) || 0,
      results: Array.isArray(raw.results) ? raw.results : [],
    };
  }
}
