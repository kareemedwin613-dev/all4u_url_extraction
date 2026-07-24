import {suggestControlledCategory,suggestSeniority} from "../../../../extension/shared/categories.js";
import {detectIndustryDomain} from "../../../../extension/shared/industry-domain.js";
import {detectSkills} from "../../../../extension/shared/skill-detection.js";
import {parseResumeSections} from "../../../../extension/shared/structured-parsing.js";
import {normalizeStructuredResumeV2} from "./resume-structure.js";

const clean=value=>String(value||"").replace(/\0/g,"").replace(/\r\n?/g,"\n").replace(/[ \t]+\n/g,"\n").replace(/\n{4,}/g,"\n\n\n").trim().slice(0,300000);
const titleCase=value=>value.toLowerCase().replace(/(^|[\s'-])\p{L}/gu,letter=>letter.toUpperCase());

export function candidateNameFromResume(text="",filename=""){
  const blocked=/\b(resume|curriculum|vitae|summary|profile|experience|engineer|developer|analyst|manager|director|email|phone|address|linkedin|github)\b/i;
  const line=clean(text).split("\n").map(value=>value.trim()).find(value=>value.length>=3&&value.length<=60&&!blocked.test(value)&&/^[\p{L}][\p{L} .'-]+$/u.test(value)&&value.split(/\s+/).length>=2&&value.split(/\s+/).length<=4);
  if(line)return line.replace(/\s+/g," ").trim();
  const base=String(filename).replace(/\.pdf$/i,"").replace(/[_-]+/g," ").replace(/\b(resume|cv|curriculum|vitae|final|updated|copy)\b/ig," ").replace(/\b20\d{2}\b/g," ").replace(/\s+/g," ").trim();
  return base&&base.toLowerCase()!=="resume"?titleCase(base):"";
}

export function candidateContactFromResume(text=""){
  const header=clean(text).slice(0,4000);
  const email=(header.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0]||"").toLowerCase();
  const phone=header.match(/(?:\+?\d{1,3}[ .-]*)?(?:\(\d{3}\)|\d{3})[ .-]+\d{3}[ .-]+\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?/i)?.[0]?.trim()||header.match(/\b\d{10}\b/)?.[0]||"";
  return {candidateEmail:email,candidatePhone:phone};
}

const seniorityCode=value=>({"Intern":"INTERN","Entry":"ENTRY","Associate":"ENTRY","Mid-Level":"MID","Senior":"SENIOR","Lead":"LEAD","Staff":"PRINCIPAL","Principal":"PRINCIPAL","Manager":"MANAGER","Director":"DIRECTOR","Vice President":"EXECUTIVE","Executive":"EXECUTIVE","Unspecified":"UNSPECIFIED"}[value]||"UNSPECIFIED");
const domainLabel=slug=>slug?slug.split("-").map(titleCase).join(" "):"";

export function inferResumeInformation(text,filename="resume.pdf"){
  const resumeText=clean(text),candidateName=candidateNameFromResume(resumeText,filename),resumeName=candidateName?candidateName+" Resume":String(filename).replace(/\.pdf$/i,"").replace(/[_-]+/g," ").trim();
  const category=suggestControlledCategory(resumeName,resumeText),industry=detectIndustryDomain("",resumeText),contact=candidateContactFromResume(resumeText);
  return {
    candidateName,resumeName,...contact,
    categorySlug:category.categorySlug||"",subcategorySlug:category.subcategorySlug||"",
    categoryConfidence:category.confidence,reasons:category.reasons,
    seniority:seniorityCode(suggestSeniority(resumeText.slice(0,1500))),
    skills:detectSkills(resumeText),industries:industry?[domainLabel(industry)]:[],
    resumeText,structuredContent:normalizeStructuredResumeV2(parseResumeSections(resumeText)),
  };
}
