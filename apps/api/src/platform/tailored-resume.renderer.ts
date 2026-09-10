import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, Tab, TabStopType, TextRun } from "docx";
import{resolveTailoredSkillGroups}from"./tailored-skill-groups.js";
import{resolveTailoredResumeTemplate,type TailoredResumeTemplateSpec}from"./tailored-resume-templates.js";
export{TAILORED_RESUME_TEMPLATES,TAILORED_RESUME_TEMPLATE_KEYS,resolveTailoredResumeTemplate}from"./tailored-resume-templates.js";
export type{TailoredResumeTemplateKey,TailoredResumeTemplateSpec}from"./tailored-resume-templates.js";

type JsonRecord = Record<string, any>;

const text=(value:unknown):string=>String(value??"").trim();
const values=(value:unknown):any[]=>Array.isArray(value)?value:[];
const datePart=(value:any):string=>{if(!value||typeof value!=="object"||!value.year)return"";const month=Number(value.month);return month>=1&&month<=12?`${String(month).padStart(2,"0")}/${value.year}`:String(value.year);};
const dateRange=(item:JsonRecord):string=>{const start=datePart(item.start_date),end=item.is_current?"Present":datePart(item.end_date);return[start,end].filter(Boolean).join(" – ");};
const detailParagraphs=(value:unknown,spec:TailoredResumeTemplateSpec):Paragraph[]=>text(value).split(/\r?\n/).map(line=>line.replace(/^\s*[•*-]\s*/,"").trim()).filter(Boolean).map(line=>new Paragraph({text:line,bullet:{level:0},spacing:{after:spec.compact?25:60}}));
const heading=(value:string,spec:TailoredResumeTemplateSpec):Paragraph=>new Paragraph({children:[new TextRun({text:spec.uppercaseHeadings?value.toUpperCase():value,bold:true,color:spec.accent,size:spec.compact?22:25})],heading:HeadingLevel.HEADING_1,border:spec.headingRule?{bottom:{color:spec.accent,style:BorderStyle.SINGLE,size:spec.compact?3:6,space:2}}:undefined,spacing:{before:spec.compact?120:220,after:spec.compact?45:100}});

export async function renderTailoredResumeDocx(input:JsonRecord):Promise<Buffer>{
  const spec=resolveTailoredResumeTemplate(input.renderTemplateKey),candidate=input.candidate||{},structured=input.sourceStructuredContent||{},preview=input.approvedPreview||{};
  const previewById=new Map(values(preview.professionalExperience).map(item=>[text(item.sourceExperienceId),text(item.tailoredDetails)]));
  const contact=[candidate.email,candidate.phone,[candidate.city,candidate.stateRegion,candidate.country].map(text).filter(Boolean).join(", ")].map(text).filter(Boolean).join("  |  ");
  const links=[candidate.linkedinUrl,candidate.githubUrl,candidate.portfolioUrl].map(text).filter(Boolean).join("  |  ");
  const children:Paragraph[]=[new Paragraph({alignment:spec.nameAlignment,children:[new TextRun({text:text(candidate.name)||"Candidate",bold:true,size:spec.nameSize,color:spec.nameColor})],spacing:{after:spec.compact?25:60}})];
  if(contact)children.push(new Paragraph({text:contact,alignment:spec.nameAlignment,spacing:{after:spec.compact?20:40}}));
  if(links)children.push(new Paragraph({text:links,alignment:spec.nameAlignment,spacing:{after:spec.compact?60:120}}));
  children.push(heading("Summary",spec),new Paragraph({text:text(preview.summary),spacing:{after:spec.compact?60:120}}),heading("Professional Experience",spec));
  for(const item of values(structured.professional_experience)){
    const role=[text(item.job_title),text(item.company)].filter(Boolean).join(" — ");
    children.push(new Paragraph({children:[new TextRun({text:role,bold:true}),new TextRun({text:dateRange(item)?`    ${dateRange(item)}`:"",italics:true})],spacing:{before:spec.compact?45:100,after:20}}));
    if(text(item.location))children.push(new Paragraph({children:[new TextRun({text:text(item.location),italics:true})],spacing:{after:spec.compact?20:40}}));
    children.push(...detailParagraphs(previewById.get(text(item.id)),spec));
  }
  const education=values(structured.education);
  if(education.length||text(structured.education_legacy_text)){
    children.push(heading("Education",spec));
    for(const item of education){
      children.push(new Paragraph({children:[new TextRun({text:text(item.institution),bold:true}),new TextRun({text:dateRange(item)?`    ${dateRange(item)}`:"",italics:true})],spacing:{after:20}}));
      const degree=[item.degree,item.field_of_study,item.gpa?`GPA: ${item.gpa}`:""].map(text).filter(Boolean).join(" — ");if(degree)children.push(new Paragraph({text:degree}));if(text(item.details))children.push(new Paragraph({text:text(item.details),spacing:{after:spec.compact?40:80}}));
    }
    if(!education.length&&text(structured.education_legacy_text))children.push(new Paragraph({text:text(structured.education_legacy_text)}));
  }
  const certifications=values(structured.certifications);if(certifications.length){children.push(heading("Certifications",spec));for(const item of certifications)children.push(new Paragraph({text:text(item.name??item),bullet:{level:0}}));}
  children.push(heading("Skills",spec));
  const skillGroups=resolveTailoredSkillGroups(preview.skills,preview.skillGroups),skillValuePosition=spec.compact?2200:2400;
  children.push(...(skillGroups.length?skillGroups:[{name:"Additional Skills" as const,skills:[]}]).map(group=>new Paragraph({alignment:AlignmentType.LEFT,tabStops:[{type:TabStopType.LEFT,position:skillValuePosition}],indent:{left:skillValuePosition,hanging:skillValuePosition},children:[new TextRun({text:`${group.name}:`,bold:true,color:spec.accent}),new TextRun({children:[new Tab()]}),new TextRun({text:group.skills.join(", ")})],spacing:{after:spec.compact?55:95}})));
  const document=new Document({creator:"Resume JD Operations",title:`Tailored Resume for Application #${input.applicationNumber}`,description:`Human-approved Application-specific Resume rendered with ${spec.key}`,styles:{default:{document:{run:{font:spec.font,size:spec.fontSize},paragraph:{spacing:{line:spec.line}}}}},sections:[{properties:{page:{margin:{top:spec.margin,right:spec.margin,bottom:spec.margin,left:spec.margin}}},children}]});
  return Packer.toBuffer(document);
}
