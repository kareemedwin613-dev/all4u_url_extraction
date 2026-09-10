import { AppError } from "../shared/errors.js";
import { hostnameFromUrl, normalizeUrl } from "../shared/normalization.js";

const cleanArray = (values = []) => [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))];
function captureError(error) {
  const detail=String(error?.message||error?.details||error?.hint||"");
  const known=detail.match(/([A-Z][A-Z0-9_]+):\s*([^\n]+)/);
  const missing=error?.code==="PGRST202"||/could not find the function|schema cache/i.test(detail);
  const code=String(known?.[1]||(missing?"DATABASE_MIGRATION_REQUIRED":error?.code==="42501"?"JOB_CAPTURE_ACCESS_DENIED":error?.code)||"JOB_CAPTURE_FAILED");
  const message=known?.[2]||(missing?"The database is missing the atomic JD-capture migration.":code==="JOB_CAPTURE_ACCESS_DENIED"?"Your role does not allow Job Description capture.":"The Job Description could not be saved.");
  return new AppError(code,message,detail,/fetch|network|timeout|unreachable/i.test(detail));
}
export async function createJob(client,_apiBaseUrl,job) {
  const {data:sessionData,error}=await client.auth.getSession();
  if(error||!sessionData.session?.access_token)throw new AppError("SESSION_EXPIRED","Your session has expired. Sign in again.");
  const normalizedSourceUrl=normalizeUrl(job.sourceUrl);
  if(!normalizedSourceUrl)throw new AppError("VALIDATION_ERROR","The source URL must use HTTP or HTTPS.");
  const record={
    company:String(job.company||"").replace(/\s+/g," ").trim(),job_title:String(job.jobTitle||"").replace(/\s+/g," ").trim(),
    category_id:job.categoryId,
    subcategory_id:job.subcategoryId||(Array.isArray(job.subcategoryIds)?job.subcategoryIds[0]:null)||null,
    subcategory_ids:[...new Set([...(Array.isArray(job.subcategoryIds)?job.subcategoryIds:[]),job.subcategoryId].map((id)=>String(id||"").trim()).filter(Boolean))],
    industry_domain_category_id:job.industryDomainCategoryId||null,
    seniority:job.seniority||"UNSPECIFIED",location_text:job.locationText||null,work_arrangement:job.workArrangement||"UNSPECIFIED",
    clearance_requirements:cleanArray(job.clearanceRequirements),travel_required:job.travelRequired??null,travel_details:job.travelDetails||null,
    salary_min:job.salaryMin??null,salary_max:job.salaryMax??null,salary_currency:job.salaryCurrency||null,salary_period:job.salaryPeriod||null,salary_text:job.salaryText||null,
    source_site:job.sourceSite||hostnameFromUrl(normalizedSourceUrl),source_url:job.sourceUrl,normalized_source_url:normalizedSourceUrl,
    captured_at_client:job.capturedAt||new Date().toISOString(),description_text:job.descriptionText,detected_skills:cleanArray(job.detectedSkills),
    capture_method:job.captureMethod||"manual",extraction_confidence:job.extractionConfidence||"low",
  };
  let data,rpcError;
  try{({data,error:rpcError}=await client.rpc("capture_job_description_v353",{p_record:record}));}catch(error){throw captureError(error);}
  if(rpcError)throw captureError(rpcError);
  if(!data?.row?.id)throw new AppError("JOB_CAPTURE_RESPONSE_INVALID","The Job Description save response was invalid.");
  return {...data.row,duplicate:Boolean(data.duplicate),duplicate_reason:data.duplicateReason||null};
}
