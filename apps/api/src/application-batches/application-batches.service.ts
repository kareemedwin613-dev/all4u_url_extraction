import { createHash } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "@resume-jd/contracts";
import { ApiException } from "../common/errors/api.exception.js";
import { JsonLogger } from "../common/logging/json-logger.service.js";
import { ApplicationBatchesRepository } from "./application-batches.repository.js";
import { mapBatch, mapCreation, mapResult } from "./application-batches.mapper.js";

const timeout = async <T>(work: Promise<T>, milliseconds: number) => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([work, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new ApiException("REQUEST_TIMEOUT", "The operation timed out. Retry with the same idempotency key.", HttpStatus.REQUEST_TIMEOUT)), milliseconds); })]);
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
    const raw: any = await timeout(this.repository.rpc(user, "preview_bulk_applications", { p_selected_jd_ids: ids }, "The bulk preview could not be generated."), 10_000);
    const combinations = (raw?.combinations || []).filter((row: any) => row?.resumeType === "ORIGINAL");
    const data = { ...raw, combinations, activeResumeCount: new Set(combinations.map((row: any) => row.resumeId)).size, proposedCount: combinations.length, eligibleCount: combinations.filter((row: any) => row.eligible).length, duplicateCount: combinations.filter((row: any) => !row.eligible).length, excludedCount: combinations.filter((row: any) => !row.eligible).length + Number(raw?.invalidJds?.length || 0) };
    this.logger.log("bulk.preview.completed", { requestId, userId: user.id, selectedJdCount: ids.length, proposedCount: data?.proposedCount || 0, duplicateCount: data?.duplicateCount || 0 });
    return data;
  }
  async create(user: AuthenticatedUser, body: any, idempotencyKey: string, requestId: string) {
    const pairs = [...new Map(body.combinations.map((pair: any) => [`${pair.jobDescriptionId}:${pair.resumeId}`, pair])).values()] as any[];
    const normalized = pairs.map((pair) => ({ job_description_id: pair.jobDescriptionId, resume_id: pair.resumeId })).sort((a, b) => `${a.job_description_id}:${a.resume_id}`.localeCompare(`${b.job_description_id}:${b.resume_id}`));
    const batchName = String(body.batchName || "").trim();
    const hash = createHash("sha256").update(JSON.stringify({ batchName, combinations: normalized })).digest("hex");
    const raw: any = await timeout(this.repository.rpc(user, "create_applications_bulk_api", { p_combinations: normalized, p_batch_name: batchName || null, p_idempotency_key: idempotencyKey, p_request_hash: hash }, "The bulk Applications could not be created."), 30_000);
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
}
