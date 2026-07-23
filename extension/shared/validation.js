import { normalizeUrl } from "./normalization.js";
import { SENIORITY_VALUES } from "./seniority.js";
import { SALARY_PERIODS } from "./salary-detection.js";

export const CAPTURE_METHODS=Object.freeze(["json-ld","site-specific","dom","selected-text","manual"]);
export const WORK_ARRANGEMENTS=Object.freeze(["REMOTE","HYBRID","ONSITE","UNSPECIFIED"]);
export const CLEARANCE_REQUIREMENTS=Object.freeze(["PUBLIC_TRUST","DOD_SECRET","TOP_SECRET","TS_SCI","OTHER_SECURITY_CLEARANCE"]);

export function validateJob(job={}) {
  const errors={};
  if(!String(job.company||"").trim()||String(job.company).trim().length>200)errors.company="Company must contain 1–200 characters.";
  if(!String(job.jobTitle||"").trim()||String(job.jobTitle).trim().length>200)errors.jobTitle="Job title must contain 1–200 characters.";
  if(!job.categoryId)errors.categoryId="Select a primary category.";
  if(job.industryDomainCategoryId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(job.industryDomainCategoryId))errors.industryDomainCategoryId="Select a valid industry domain.";
  if(!SENIORITY_VALUES.includes(job.seniority))errors.seniority="Select a valid seniority.";
  if(job.locationText&&String(job.locationText).length>300)errors.locationText="Location must contain no more than 300 characters.";
  if(job.workArrangement!==undefined&&!WORK_ARRANGEMENTS.includes(job.workArrangement))errors.workArrangement="Work arrangement is invalid.";
  if(job.clearanceRequirements!==undefined&&(!Array.isArray(job.clearanceRequirements)||job.clearanceRequirements.some((x)=>!CLEARANCE_REQUIREMENTS.includes(x))))errors.clearanceRequirements="Security clearance selection is invalid.";
  if(job.travelRequired!==undefined&&job.travelRequired!==null&&typeof job.travelRequired!=="boolean")errors.travelRequired="Travel requirement is invalid.";
  if(job.travelDetails&&String(job.travelDetails).length>500)errors.travelDetails="Travel details must contain no more than 500 characters.";
  if(job.salaryMin!==undefined&&job.salaryMin!==null&&(!Number.isFinite(job.salaryMin)||job.salaryMin<0))errors.salaryMin="Salary minimum must be zero or greater.";
  if(job.salaryMax!==undefined&&job.salaryMax!==null&&(!Number.isFinite(job.salaryMax)||job.salaryMax<0||job.salaryMin!==null&&job.salaryMin!==undefined&&job.salaryMax<job.salaryMin))errors.salaryMax="Salary maximum must be at least the minimum.";
  if(job.salaryCurrency&& !/^[A-Z]{3}$/.test(job.salaryCurrency))errors.salaryCurrency="Salary currency must be a three-letter ISO code.";
  if(job.salaryPeriod&&!SALARY_PERIODS.includes(job.salaryPeriod))errors.salaryPeriod="Salary period is invalid.";
  if(job.salaryText&&String(job.salaryText).length>500)errors.salaryText="Salary text must contain no more than 500 characters.";
  if(job.structuredContent!==undefined&&(typeof job.structuredContent!=="object"||job.structuredContent===null||Object.values(job.structuredContent).some((x)=>typeof x!=="string")))errors.structuredContent="Structured JD sections are invalid.";
  if(job.sourceUrl&&(!normalizeUrl(job.sourceUrl)||job.sourceUrl.length>4000))errors.sourceUrl="Enter a valid HTTP(S) URL up to 4,000 characters.";
  const description=String(job.descriptionText||"").trim();
  if(description.length<100||description.length>200000)errors.descriptionText="Description must contain 100–200,000 characters.";
  if(!CAPTURE_METHODS.includes(job.captureMethod))errors.captureMethod="Capture method is invalid.";
  if(!["high","medium","low"].includes(job.extractionConfidence))errors.extractionConfidence="Extraction confidence is invalid.";
  return {valid:!Object.keys(errors).length,errors};
}
