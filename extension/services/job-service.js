import { AppError } from "../shared/errors.js";
import { apiRequest } from "./api-client.js";

function fromApi(data) {
  return { id:data.id,company:data.company,job_title:data.jobTitle,category_id:data.categoryId,subcategory_id:data.subcategoryId,industry_domain_category_id:data.industryDomainCategoryId,seniority:data.seniority,location_text:data.locationText,work_arrangement:data.workArrangement,clearance_requirements:data.clearanceRequirements,travel_required:data.travelRequired,travel_details:data.travelDetails,salary_min:data.salaryMin,salary_max:data.salaryMax,salary_currency:data.salaryCurrency,salary_period:data.salaryPeriod,salary_text:data.salaryText,source_site:data.sourceWebsite,source_url:data.sourceUrl,description_text:data.descriptionText,detected_skills:data.detectedSkills,capture_method:data.captureMethod,extraction_confidence:data.extractionConfidence,created_at:data.createdAt,workspace_sync:data.workspaceSync||{enabled:false,status:"DISABLED"} };
}
export async function createJob(client,apiBaseUrl,job) {
  const {data:sessionData,error}=await client.auth.getSession();
  if(error||!sessionData.session?.access_token)throw new AppError("SESSION_EXPIRED","Your session has expired. Sign in again.");
  const response=await apiRequest({baseUrl:apiBaseUrl,path:"/api/v1/extension/job-descriptions",method:"POST",token:sessionData.session.access_token,idempotencyKey:`jd-${crypto.randomUUID()}`,body:{sourceUrl:job.sourceUrl,sourceWebsite:job.sourceSite,company:job.company,jobTitle:job.jobTitle,descriptionText:job.descriptionText,categoryId:job.categoryId,subcategoryId:job.subcategoryId,industryDomainCategoryId:job.industryDomainCategoryId,seniority:job.seniority,locationText:job.locationText,workArrangement:job.workArrangement,clearanceRequirements:job.clearanceRequirements,travelRequired:job.travelRequired,travelDetails:job.travelDetails,salaryMin:job.salaryMin,salaryMax:job.salaryMax,salaryCurrency:job.salaryCurrency,salaryPeriod:job.salaryPeriod,salaryText:job.salaryText,detectedSkills:job.detectedSkills,captureMethod:job.captureMethod,extractionConfidence:job.extractionConfidence,capturedAt:new Date().toISOString(),extensionVersion:chrome.runtime.getManifest().version}});
  const saved=fromApi(response.data);
  if(response.data.duplicate)throw new AppError("JD_DUPLICATE","This job description is already saved.",JSON.stringify({existing:saved,duplicateReason:response.data.duplicateReason}));
  return saved;
}
