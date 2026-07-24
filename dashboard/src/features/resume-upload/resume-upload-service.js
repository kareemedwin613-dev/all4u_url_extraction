import {buildStoragePath} from "../../../../extension/shared/resume-validation.js";
import {SENIORITIES} from "../../shared/constants.js";
import {PDF_MIME,validatePdfFile} from "./resume-upload-constants.js";
import {cleanStructuredResumeV2} from "./resume-structure.js";

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

export async function findResumesByIdentity(client,value={}){
  const candidateName=String(value.candidateName||"").trim(),candidateEmail=String(value.candidateEmail||"").trim().toLowerCase(),candidatePhone=String(value.candidatePhone||"").trim();
  if(!candidateName||!candidateEmail||candidatePhone.replace(/[^0-9]/g,"").length<7)return [];
  const {data,error}=await client.rpc("find_resume_identity_duplicates",{p_candidate_name:candidateName,p_candidate_email:candidateEmail,p_candidate_phone:candidatePhone});
  if(error)throw new Error("The duplicate candidate check failed.");
  return Array.isArray(data)?data:[];
}

export async function uploadAdminResume(client,userId,value,file){
  if(!UUID.test(String(userId||"")))throw new Error("Your authenticated user ID is invalid.");
  const check=validateResumeUpload(value,file);if(!check.valid)throw new Error(Object.values(check.errors).join(" "));
  const id=crypto.randomUUID(),path=buildStoragePath(userId,id,file.name);
  const {error:uploadError}=await client.storage.from("original-resumes").upload(path,file,{contentType:PDF_MIME,upsert:false});
  if(uploadError)throw new Error("The private PDF upload failed.");
  const row={id,user_id:userId,candidate_name:value.candidateName.trim(),candidate_email:value.candidateEmail.trim().toLowerCase(),candidate_phone:value.candidatePhone.trim(),resume_name:value.resumeName.trim(),primary_category_id:value.primaryCategoryId,subcategory_id:value.subcategoryId||null,seniority:value.seniority,skills:split(value.skills),industries:split(value.industries),resume_text:value.resumeText.trim(),structured_content:cleanStructuredResumeV2(value.structuredContent),structured_schema_version:2,storage_bucket:"original-resumes",storage_path:path,original_filename:file.name,mime_type:PDF_MIME,file_size_bytes:file.size,file_sha256:value.checksum,status:"ACTIVE"};
  const {data,error}=await client.from("resumes").insert(row).select("id").single();
  if(error){
    const {error:cleanupError}=await client.storage.from("original-resumes").remove([path]);
    if(cleanupError)throw new Error("Resume metadata failed to save and the uploaded PDF could not be cleaned up.");
    throw new Error("Resume metadata could not be saved. Review the category and extracted fields.");
  }
  return data;
}
