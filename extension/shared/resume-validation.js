import { SENIORITY_VALUES } from "./seniority.js";
export const MAX_FILE_SIZE=5*1024*1024;
export const MIME_TYPES=Object.freeze({".pdf":"application/pdf",".docx":"application/vnd.openxmlformats-officedocument.wordprocessingml.document",".txt":"text/plain"});
export function sanitizeFilename(name="") { const base=String(name).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\\|\0/g,"").replace(/\.\.+/g,".").replace(/[^a-z0-9._-]+/g,"-").replace(/-+(?=\.)/g,"").replace(/^[./-]+|[.-]+$/g,""); return base||"resume"; }
export function validateResume(meta={},file) {
  const errors={};
  if(!String(meta.candidateName||"").trim())errors.candidateName="Candidate name is required.";
  if(!String(meta.resumeName||"").trim())errors.resumeName="Resume name is required.";
  if(!meta.primaryCategoryId)errors.primaryCategoryId="Primary category is required.";
  if(!SENIORITY_VALUES.includes(meta.seniority))errors.seniority="Select a valid seniority.";
  const text=String(meta.resumeText||"").trim();
  if(text.length<100||text.length>300000)errors.resumeText="Resume text must contain 100–300,000 characters.";
  if(meta.structuredContent!==undefined){const sections=meta.structuredContent;if(!sections||typeof sections!=="object"||["summary","professional_experience","education","skills"].some((key)=>typeof sections[key]!=="string")||!Object.values(sections).some((value)=>value.trim()))errors.structuredContent="Review the structured resume sections.";}
  if(!file)errors.file="Choose a resume file.";else{const ext=(file.name.match(/\.[^.]+$/)||[""])[0].toLowerCase();if(!MIME_TYPES[ext]||MIME_TYPES[ext]!==file.type)errors.file="Use a PDF, DOCX, or TXT file whose type matches its extension.";else if(!file.size||file.size>MAX_FILE_SIZE)errors.file="Resume file must be between 1 byte and 5 MiB.";}
  return {valid:!Object.keys(errors).length,errors};
}
export function buildStoragePath(userId,resumeId,filename,date=new Date()){const stamp=date.toISOString().replace(/\.\d{3}Z$/,"Z").replace(/[-:]/g,"");return `${userId}/${resumeId}/${stamp}-${sanitizeFilename(filename)}`;}
