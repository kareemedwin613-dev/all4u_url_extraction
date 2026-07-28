export const SYSTEM_ROLES = [
  "APPLIER",
  "APPLYING_MANAGER",
  "DEVELOPER",
  "DEVELOPMENT_MANAGER",
  "ADMIN",
] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export interface AuthenticatedUser {
  id: string;
  email?: string;
  token: string;
  claims: Record<string, unknown>;
}

export interface ApiErrorResponse {
  code: string;
  message: string;
  requestId: string;
  details?: unknown;
  fieldErrors?: Record<string, string[]>;
}

export interface RequestMetadata {
  requestId: string;
}

export interface PaginationMetadata {
  page: number;
  pageSize: number;
  total: number;
}

export interface JobDescriptionListQuery {
  search?: string;
  categoryId?: string;
  seniority?: Seniority;
  status?: "ACTIVE" | "ARCHIVED";
  sort?: string;
  page?: number;
  pageSize?: 10 | 25 | 50;
}

export interface CategoryLookupItem {
  id: string;
  slug: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  active: boolean;
}

export interface IndustryDomainLookupItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sort_order: number;
}

export interface HealthResponse {
  status: "ok";
  service: "resume-platform-api";
  version: "0.7.2";
}

export type WorkArrangement = "REMOTE" | "HYBRID" | "ONSITE" | "UNSPECIFIED";
export type Seniority = "INTERN" | "ENTRY" | "JUNIOR" | "MID" | "SENIOR" | "LEAD" | "PRINCIPAL" | "MANAGER" | "DIRECTOR" | "EXECUTIVE" | "UNSPECIFIED";
export type CaptureMethod = "json-ld" | "site-specific" | "dom" | "selected-text" | "manual";
export type ExtractionConfidence = "high" | "medium" | "low";
export type SalaryPeriod = "HOUR" | "DAY" | "WEEK" | "MONTH" | "YEAR" | "OTHER";
export type ClearanceRequirement = "PUBLIC_TRUST" | "DOD_SECRET" | "TOP_SECRET" | "TS_SCI" | "OTHER_SECURITY_CLEARANCE";

export interface CreateJobDescriptionRequest {
  sourceUrl: string;
  sourceWebsite?: string;
  company: string;
  jobTitle: string;
  descriptionText: string;
  categoryId: string;
  subcategoryId?: string | null;
  industryDomainCategoryId?: string | null;
  seniority?: Seniority;
  locationText?: string | null;
  workArrangement?: WorkArrangement;
  clearanceRequirements?: ClearanceRequirement[];
  travelRequired?: boolean | null;
  travelDetails?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  salaryPeriod?: SalaryPeriod | null;
  salaryText?: string | null;
  detectedSkills?: string[];
  captureMethod?: CaptureMethod;
  extractionConfidence?: ExtractionConfidence;
  capturedAt?: string;
  extensionVersion?: string;
}

export interface JobDescriptionIngestionData {
  id: string;
  company: string;
  jobTitle: string;
  sourceUrl: string;
  createdAt: string;
  duplicate: boolean;
  duplicateReason: "SOURCE_URL" | "COMPANY_JOB_TITLE" | null;
  categoryId: string;
  subcategoryId: string | null;
  industryDomainCategoryId: string | null;
  seniority: Seniority;
  locationText: string | null;
  workArrangement: WorkArrangement;
  clearanceRequirements: ClearanceRequirement[];
  travelRequired: boolean | null;
  travelDetails: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  salaryText: string | null;
  sourceWebsite: string;
  descriptionText: string;
  detectedSkills: string[];
  captureMethod: CaptureMethod;
  extractionConfidence: ExtractionConfidence;
}

export interface JobDescriptionIngestionResponse extends RequestMetadata {
  data: JobDescriptionIngestionData;
}

export interface BulkPreviewRequest { jobDescriptionIds: string[]; }
export interface BulkCombination {
  key: string; jobDescriptionId: string; resumeId: string; company: string; jobTitle: string;
  jobCategoryId: string; jobCategoryName: string; candidateName: string; resumeName: string;
  resumeCategoryId: string; resumeCategoryName: string; eligible: boolean;
  existingApplicationId: string | null; exclusionCode: string | null; exclusionReason: string | null;
}
export interface InvalidJobDescription { jobDescriptionId: string; company: string; jobTitle: string; code: string; reason: string; }
export interface BulkPreviewData {
  selectedJdCount: number; validJdCount: number; invalidJdCount: number; activeResumeCount: number;
  proposedCount: number; eligibleCount: number; duplicateCount: number; excludedCount: number;
  combinations: BulkCombination[]; invalidJds: InvalidJobDescription[];
}
export interface BulkPreviewResponse extends RequestMetadata { data: BulkPreviewData; }
export interface BulkCreatePair { jobDescriptionId: string; resumeId: string; }
export interface BulkCreateRequest { batchName?: string; combinations: BulkCreatePair[]; }
export type BulkCreateOutcome = "CREATED" | "DUPLICATE" | "SKIPPED" | "FAILED";
export interface BulkCreateRowResult {
  key: string; jobDescriptionId: string; resumeId: string; applicationId: string | null;
  company: string | null; jobTitle: string | null; candidateName: string | null; resumeName: string | null;
  outcome: BulkCreateOutcome; errorCode: string | null; message: string;
}
export interface BulkCreateData {
  batchId: string; batchName: string; status: string; selectedJdCount: number; requestedCount: number;
  createdCount: number; duplicateCount: number; skippedCount: number; failedCount: number;
  replayed: boolean; results: BulkCreateRowResult[];
}
export interface BulkCreateResponse extends RequestMetadata { data: BulkCreateData; }
export interface ApplicationBatchSummary {
  id: string; name: string; status: string; creatorId: string; creatorName: string;
  selectedJdCount: number; requestedCount: number; createdCount: number; duplicateCount: number;
  skippedCount: number; failedCount: number; createdAt: string; completedAt: string | null;
}
export interface ApplicationBatchDetail extends ApplicationBatchSummary {
  applications: Array<{ id: string; applicationNumber: number; company: string; jobTitle: string }>;
}
export interface ApplicationBatchResult extends BulkCreateRowResult { id: string; createdAt: string; }
export interface CursorPage { nextCursor: string | null; pageSize: number; total?: number; }
