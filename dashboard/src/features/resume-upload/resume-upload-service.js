import {SENIORITIES} from "../../shared/constants.js";
import {PDF_MIME,validatePdfFile} from "./resume-upload-constants.js";
import {cleanStructuredResumeV2} from "./resume-structure.js";
import {authenticatedApiRequest} from "../../services/api-client.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const split=value=>[...new Set(String(value||"").split(",").map(item=>item.trim()).filter(Boolean))];
const validPartialDate=value=>!value||(Number.isInteger(value.year)&&value.year>=1900&&value.year<=2100&&(value.month==null||(Number.isInteger(value.month)&&value.month>=1&&value.month<=12)));

export function validateResumeUpload(value={},file){
  const errors={},fileError=validatePdfFile(file);
  if(!String(value.candidateName||"").trim())errors.candidateName="Candidate name is required.";
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value.candidateEmail||"").trim()))errors.candidateEmail="Enter the candidate's email address.";
  const phoneDigits=String(value.candidatePhone||"").replace(/[^0-9]/g,"");
  if(phoneDigits.length<7||phoneDigits.length>15)errors.candidatePhone="Enter the candidate's phone number.";
  if(!String(value.resumeName||"").trim())errors.resumeName="Resume name is required.";
  if(!UUID.test(String(value.primaryCategoryId||"")))errors.primaryCategoryId="Select a primary category.";
  if(value.subcategoryId&&!UUID.test(String(value.subcategoryId)))errors.subcategoryId="Select a valid subcategory.";
  if(!SENIORITIES.includes(value.seniority))errors.seniority="Select a valid seniority.";
  const text=String(value.resumeText||"").trim();if(text.length<100||text.length>300000)errors.resumeText="Extracted Resume text must contain 100-300,000 characters.";
  const sections=value.structuredContent;
  if(!sections||typeof sections.summary!=="string"||typeof sections.education!=="string"||typeof sections.skills!=="string"||!Array.isArray(sections.professional_experience))errors.structuredContent="The structured Resume format is invalid.";
  else{
    const experiences=sections.professional_experience;
    if(!sections.summary.trim()&&!sections.education.trim()&&!sections.skills.trim()&&!experiences.length)errors.structuredContent="At least one structured Resume section is required.";
    for(const [index,experience] of experiences.entries()){
      if(!String(experience?.company||"").trim()){errors.structuredContent=`Experience ${index+1} requires a company.`;break;}
      if(!String(experience?.job_title||"").trim()){errors.structuredContent=`Experience ${index+1} requires a job title.`;break;}
      if(typeof experience?.experience_details!=="string"||experience.experience_details.length>30000){errors.structuredContent=`Experience ${index+1} has invalid achievement details.`;break;}
      const start=experience.start_date,end=experience.end_date;
      if(!validPartialDate(start)){errors.structuredContent=`Experience ${index+1} has an invalid start date.`;break;}
      if(!validPartialDate(end)){errors.structuredContent=`Experience ${index+1} has an invalid end date.`;break;}
      if(start&&end&&!experience.is_current&&(end.year<start.year||(end.year===start.year&&start.month!=null&&end.month!=null&&end.month<start.month))){errors.structuredContent=`Experience ${index+1} ends before it starts.`;break;}
    }
  }
  if(fileError)errors.file=fileError;
  if(!/^[0-9a-f]{64}$/.test(String(value.checksum||"")))errors.checksum="The PDF checksum is missing. Select the file again.";
  return {valid:!Object.keys(errors).length,errors};
}

export async function findResumesByIdentity(client,apiBaseUrl,value={}){
  const candidateName=String(value.candidateName||"").trim(),candidateEmail=String(value.candidateEmail||"").trim().toLowerCase(),candidatePhone=String(value.candidatePhone||"").trim();
  if(!candidateName||!candidateEmail||candidatePhone.replace(/[^0-9]/g,"").length<7)return [];
  const{payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:"/api/v1/resumes/identity-duplicates",method:"POST",body:{candidateName,candidateEmail,candidatePhone}});
  return Array.isArray(payload.data)?payload.data:[];
}

export async function uploadAdminResume(client,apiBaseUrl,userId,value,file){
  if(!UUID.test(String(userId||"")))throw new Error("Your authenticated user ID is invalid.");
  const check=validateResumeUpload(value,file);if(!check.valid)throw new Error(Object.values(check.errors).join(" "));
  const metadata={...value,skills:split(value.skills),industries:split(value.industries),structuredContent:cleanStructuredResumeV2(value.structuredContent),structuredSchemaVersion:2};
  const body=new FormData();body.append("metadata",JSON.stringify(metadata));body.append("file",file,file.name);
  return(await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:"/api/v1/resumes",method:"POST",body})).payload.data;
}
