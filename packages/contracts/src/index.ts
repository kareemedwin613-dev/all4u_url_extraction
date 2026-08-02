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

export type BulkAssignmentStrategy = "MANUAL" | "EVEN" | "CAPACITY_AWARE";
export interface ApplierWorkload {
  userId: string; fullName: string; email: string; isAvailable: boolean;
  activeApplicationCount: number; maxActiveApplications: number; remainingCapacity: number;
}
export interface ApplierWorkloadSettings {
  userId: string; fullName: string; email: string; isAvailable: boolean;
  maxActiveApplications: number; usesDefaultSettings: boolean; updatedBy: string | null;
  createdAt: string | null; updatedAt: string | null;
}
export interface UpdateWorkloadSettingsRequest { isAvailable: boolean; maxActiveApplications: number; }
export interface ManualAssignment { applicationId: string; assignedTo: string; }
export interface BulkAssignmentPreviewRequest {
  strategy: BulkAssignmentStrategy; applicationIds?: string[]; applierIds?: string[]; assignments?: ManualAssignment[];
}
export interface AssignmentProposal {
  applicationId: string; company: string; jobTitle: string; candidateName?: string | null; resumeName: string;
  proposedAssigneeId: string; proposedAssigneeName: string; currentApplierWorkload: number;
  proposedAdditionalCount: number; projectedFinalWorkload: number; maxCapacity: number; remainingCapacityAfter: number;
}
export interface ApplierAssignmentSummary {
  userId: string; fullName: string; currentWorkload: number; proposedCount: number;
  projectedWorkload: number; maxCapacity: number; remainingCapacityAfter: number; eligible: boolean;
}
export interface ExcludedApplication { applicationId: string; code: string; reason: string; }
export interface BulkAssignmentPreviewData {
  strategy: BulkAssignmentStrategy; selectedApplicationCount: number; eligibleApplicationCount: number;
  excludedApplicationCount: number; selectedApplierCount: number; proposals: AssignmentProposal[];
  applierSummaries: ApplierAssignmentSummary[]; excludedApplications: ExcludedApplication[];
}
export interface BulkAssignmentPreviewResponse extends RequestMetadata { data: BulkAssignmentPreviewData; }
export interface BulkAssignRequest { batchName?: string; strategy: BulkAssignmentStrategy; assignments: ManualAssignment[]; }
export type BulkAssignmentOutcome = "ASSIGNED" | "SKIPPED" | "FAILED";
export interface BulkAssignmentRowResult {
  id: string; applicationId: string; previousAssigneeId: string | null; newAssigneeId: string | null;
  outcome: BulkAssignmentOutcome; errorCode: string | null; message: string; createdAt: string;
}
export interface BulkAssignData {
  batchId: string; batchName: string; strategy: BulkAssignmentStrategy; requestedCount: number;
  assignedCount: number; skippedCount: number; failedCount: number; status: string; replayed: boolean;
  results: BulkAssignmentRowResult[];
}
export interface BulkAssignResponse extends RequestMetadata { data: BulkAssignData; }
export interface AssignmentBatchSummary {
  id: string; name: string; strategy: BulkAssignmentStrategy; selectedApplicationCount: number;
  requestedCount: number; assignedCount: number; skippedCount: number; failedCount: number;
  status: string; createdBy: string; creatorName: string; createdAt: string; completedAt: string | null;
}
export type AssignmentBatchDetail = AssignmentBatchSummary;
export interface AssignmentBatchResult extends BulkAssignmentRowResult {
  applicationNumber: number | null; company: string | null; jobTitle: string | null; newAssigneeName: string | null;
}

export type ApplicationExtensionAction = "LOAD_RESUME" | "AUTOFILL";
export type ApplicationExtensionSessionStatus = "CREATED" | "RECEIVED" | "TARGET_READY" | "COMPLETED" | "CANCELLED" | "FAILED" | "EXPIRED";
export interface ApplicationExtensionContext {
  application: { id: string; applicationNumber: number | null; workStatus: string; applicationStatus: string; assignedTo: string | null };
  job: { id: string; company: string; jobTitle: string; sourceUrl: string };
  candidate: { displayName: string; profileId: string | null; profileAvailable: boolean };
  resume: { id: string; resumeName: string; originalFilename: string; mimeType: string; fileSizeBytes: number; status: string };
  permissions: { canLoadResume: boolean; canAutofill: boolean };
}
export interface CreateApplicationExtensionSessionRequest { action: ApplicationExtensionAction; extensionVersion?: string; }
export interface UpdateApplicationExtensionSessionRequest { status: Exclude<ApplicationExtensionSessionStatus, "CREATED" | "EXPIRED">; errorCode?: string; }
export interface ApplicationExtensionSession {
  id: string; applicationId: string; action: ApplicationExtensionAction; status: ApplicationExtensionSessionStatus;
  targetUrl?: string | null; expiresAt: string; createdAt?: string; updatedAt?: string;
}
export interface ApplicationExtensionContextResponse extends RequestMetadata { data: ApplicationExtensionContext; }
export interface ApplicationExtensionSessionResponse extends RequestMetadata { data: ApplicationExtensionSession; }
export interface ApplicationResumeAccess {
  signedUrl: string;
  filename: string;
  mimeType: string;
  fileSizeBytes: number;
  expiresAt: string;
}
export interface ApplicationResumeAccessResponse extends RequestMetadata { data: ApplicationResumeAccess; }

export type CandidateProfileReviewStatus = "NEEDS_REVIEW" | "VERIFIED";
export interface CandidateAddress {
  id: string; addressType: "PRIMARY" | "MAILING" | "OTHER"; addressLine1: string | null;
  addressLine2: string | null; city: string | null; stateRegion: string | null;
  postalCode: string | null; country: string | null; isPrimary: boolean;
}
export interface CandidateEmployment {
  id: string; company: string; jobTitle: string; location: string | null; startDate: string | null;
  endDate: string | null; isCurrent: boolean; experienceDetails: string | null; displayOrder: number;
  source: "RESUME_METADATA";
}
export interface CandidateEducation {
  id: string; institution: string; degree: string | null; fieldOfStudy: string | null;
  location: string | null; startDate: string | null; endDate: string | null; gpa: string | null;
  details: string | null; displayOrder: number; source: "RESUME_METADATA";
}
export interface CandidateCertification {
  id: string; name: string; issuer: string | null; issuedDate: string | null; expirationDate: string | null;
  credentialId: string | null; credentialUrl: string | null; source: "RESUME_METADATA";
}
export interface CandidateLink { id: string; linkType: "LINKEDIN" | "GITHUB" | "PORTFOLIO" | "OTHER"; label: string | null; url: string; }
export interface CandidateAutofillProfile {
  id: string; resumeId: string; fullName: string; firstName: string | null; middleName: string | null;
  lastName: string | null; email: string | null; phone: string | null; reviewStatus: CandidateProfileReviewStatus;
  reviewedBy: string | null; reviewedAt: string | null; createdAt: string; updatedAt: string;
  addresses: CandidateAddress[]; employment: CandidateEmployment[]; education: CandidateEducation[];
  certifications: CandidateCertification[]; links: CandidateLink[]; summary?: string; skills?: string;
  educationLegacyText?: string;
}
export interface CandidateAutofillProfileResponse extends RequestMetadata { data: CandidateAutofillProfile; }
export interface UpdateCandidateProfileRequest {
  fullName: string; firstName?: string; middleName?: string; lastName?: string;
  email?: string; phone?: string; reviewStatus: CandidateProfileReviewStatus;
  primaryAddress?: Omit<CandidateAddress, "id" | "addressType" | "isPrimary">;
  links?: Array<Pick<CandidateLink, "linkType" | "url"> & { label?: string }>;
}
export interface CandidateEmploymentRequest {
  company: string; jobTitle: string; location?: string; startDate?: string | null; endDate?: string | null;
  isCurrent: boolean; experienceDetails?: string; displayOrder?: number;
}
export interface CandidateEducationRequest {
  institution: string; degree?: string; fieldOfStudy?: string; location?: string;
  startDate?: string | null; endDate?: string | null; gpa?: string; details?: string; displayOrder?: number;
}
export interface UpdateResumeStructuredContentRequest {
  summary?: string; skills?: string;
  employment: Array<CandidateEmploymentRequest & { id?: string }>;
  education: Array<CandidateEducationRequest & { id?: string }>;
  certifications: Array<Omit<CandidateCertification, "source" | "id"> & { id?: string }>;
}

/** Canonical v0.8.9 names; Candidate-prefixed names remain compatibility aliases. */
export type ResumeAutofillReviewStatus = CandidateProfileReviewStatus;
export type ResumeAutofillAddress = CandidateAddress;
export type ResumeAutofillEmployment = CandidateEmployment;
export type ResumeAutofillEducation = CandidateEducation;
export type ResumeAutofillCertification = CandidateCertification;
export type ResumeAutofillLink = CandidateLink;
export type ResumeAutofillProfile = CandidateAutofillProfile;
export type ResumeAutofillProfileResponse = CandidateAutofillProfileResponse;
export type UpdateResumeAutofillProfileRequest = UpdateCandidateProfileRequest;
export type ResumeAutofillEmploymentRequest = CandidateEmploymentRequest;
export type ResumeAutofillEducationRequest = CandidateEducationRequest;

export interface ApplicationAutofillContext {
  applicationId: string;
  sessionId: string;
  job: { company: string; jobTitle: string; sourceUrl: string; salaryMin:number|null;salaryMax:number|null;salaryCurrency:string|null;salaryPeriod:SalaryPeriod|null;salaryText:string|null };
  resumeId: string;
  resumeUpdatedAt: string;
  profileSchemaVersion: number;
  reviewedAt: string;
  values: Partial<Record<
    | "candidate.firstName" | "candidate.middleName" | "candidate.lastName" | "candidate.fullName"
    | "candidate.email" | "candidate.phone" | "candidate.addressLine1" | "candidate.addressLine2"
      | "candidate.city" | "candidate.state" | "candidate.postalCode" | "candidate.country"
      | "candidate.linkedInUrl" | "candidate.githubUrl" | "candidate.portfolioUrl" | "candidate.summary"
      | "candidate.currentLocation" | "candidate.currentCompany",
    string
  >>;
  applicationAnswers: ResumeApplicationAnswerSnapshot[];
}
export interface ApplicationAutofillContextResponse extends RequestMetadata { data: ApplicationAutofillContext; }

export type ResumeApplicationAnswerKey = "authorized_to_work"|"requires_sponsorship"|"willing_to_relocate"|"available_start_date"|"desired_salary"|"years_of_experience"|"remote_work_preference"|"gender_identity"|"race_ethnicity"|"veteran_status";
export type ResumeApplicationAnswerType = "BOOLEAN"|"NUMBER"|"DATE"|"TEXT"|"SINGLE_SELECT";
export type ResumeApplicationAnswerReviewStatus = "NEEDS_REVIEW"|"VERIFIED";
export interface ResumeApplicationAnswerSnapshot { answerKey:ResumeApplicationAnswerKey;questionPatterns:string[];answerType:ResumeApplicationAnswerType;answerValue:boolean|number|string;reviewedAt:string; }
export interface ResumeApplicationAnswer extends ResumeApplicationAnswerSnapshot { id:string;resumeId:string;reviewStatus:ResumeApplicationAnswerReviewStatus;reviewedBy:string|null;reviewerName:string|null;active:boolean;createdBy:string;creatorName:string|null;createdAt:string;updatedAt:string; }
export interface SaveResumeApplicationAnswerRequest { answerKey:ResumeApplicationAnswerKey;questionPatterns:string[];answerType:ResumeApplicationAnswerType;answerValue:boolean|number|string;reviewStatus:ResumeApplicationAnswerReviewStatus;active:boolean; }
export interface SaveResumeApplicationAnswersRequest { answers:SaveResumeApplicationAnswerRequest[]; }
export type StandardScreeningAutofillKey = `screening.${ResumeApplicationAnswerKey}`;
export type StandardAutofillControlType = "input"|"select"|"radio"|"combobox";
export interface StandardScreeningAutofillField {
  fieldId:string;
  key:StandardScreeningAutofillKey;
  answerKey:ResumeApplicationAnswerKey;
  answerType:ResumeApplicationAnswerType;
  label:string;
  confidence:number;
  readiness:"READY"|"REVIEW_REQUIRED";
  controlType:StandardAutofillControlType;
  requiresReview:boolean;
}
export interface StandardAutofillFillResult { fieldId:string;key:string;status:"VERIFIED"|"FAILED"|"SKIPPED";code:string; }
