import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, Tab, TabStopType, TextRun } from "docx";
import{resolveTailoredSkillGroups}from"./tailored-skill-groups.js";

type JsonRecord = Record<string, any>;
export type TailoredResumeTemplateKey="CLASSIC_V1"|"MODERN_V1"|"COMPACT_V1"|"EXECUTIVE_V1"|"TECHNICAL_V1"|"MINIMAL_V1"|"CORPORATE_V1"|"ELEGANT_V1"|"SLATE_V1"|"EMERALD_V1"|"ACADEMIC_V1"|"IMPACT_V1";
export type TailoredResumeTemplateSpec={key:TailoredResumeTemplateKey;name:string;description:string;font:string;fontSize:number;nameSize:number;accent:string;nameColor:string;nameAlignment:typeof AlignmentType[keyof typeof AlignmentType];margin:number;line:number;compact:boolean;uppercaseHeadings:boolean;headingRule:boolean};

export const TAILORED_RESUME_TEMPLATES:ReadonlyArray<Readonly<TailoredResumeTemplateSpec>>=Object.freeze([
  Object.freeze({key:"CLASSIC_V1",name:"Classic",description:"Traditional centered header with blue section rules.",font:"Arial",fontSize:20,nameSize:32,accent:"2F75B5",nameColor:"000000",nameAlignment:AlignmentType.CENTER,margin:720,line:276,compact:false,uppercaseHeadings:false,headingRule:true}),
  Object.freeze({key:"MODERN_V1",name:"Modern",description:"Left-aligned header, navy typography, and teal section accents.",font:"Aptos",fontSize:20,nameSize:34,accent:"007C83",nameColor:"17365D",nameAlignment:AlignmentType.LEFT,margin:800,line:276,compact:false,uppercaseHeadings:true,headingRule:true}),
  Object.freeze({key:"COMPACT_V1",name:"Compact",description:"Space-efficient layout for longer professional histories.",font:"Calibri",fontSize:18,nameSize:29,accent:"404040",nameColor:"000000",nameAlignment:AlignmentType.CENTER,margin:500,line:240,compact:true,uppercaseHeadings:false,headingRule:true}),
  Object.freeze({key:"EXECUTIVE_V1",name:"Executive",description:"Refined serif layout with restrained spacing for leadership resumes.",font:"Georgia",fontSize:20,nameSize:35,accent:"1F4E79",nameColor:"1F4E79",nameAlignment:AlignmentType.CENTER,margin:760,line:276,compact:false,uppercaseHeadings:false,headingRule:false}),
  Object.freeze({key:"TECHNICAL_V1",name:"Technical",description:"Dense left-aligned layout optimized for engineering skills and projects.",font:"Aptos",fontSize:19,nameSize:32,accent:"375A7F",nameColor:"25364A",nameAlignment:AlignmentType.LEFT,margin:600,line:250,compact:true,uppercaseHeadings:true,headingRule:true}),
  Object.freeze({key:"MINIMAL_V1",name:"Minimal",description:"Monochrome, rule-free layout with maximum ATS simplicity.",font:"Arial",fontSize:19,nameSize:30,accent:"222222",nameColor:"111111",nameAlignment:AlignmentType.LEFT,margin:720,line:260,compact:false,uppercaseHeadings:false,headingRule:false}),
  Object.freeze({key:"CORPORATE_V1",name:"Corporate",description:"Structured navy layout for enterprise and consulting roles.",font:"Calibri",fontSize:20,nameSize:33,accent:"203864",nameColor:"203864",nameAlignment:AlignmentType.LEFT,margin:720,line:270,compact:false,uppercaseHeadings:true,headingRule:true}),
  Object.freeze({key:"ELEGANT_V1",name:"Elegant",description:"Serif typography with burgundy accents for polished professional profiles.",font:"Georgia",fontSize:19,nameSize:33,accent:"7A263A",nameColor:"5A1D2B",nameAlignment:AlignmentType.CENTER,margin:760,line:270,compact:false,uppercaseHeadings:false,headingRule:false}),
  Object.freeze({key:"SLATE_V1",name:"Slate",description:"Compact charcoal layout for detailed technical histories.",font:"Aptos",fontSize:19,nameSize:31,accent:"455A64",nameColor:"263238",nameAlignment:AlignmentType.LEFT,margin:650,line:250,compact:true,uppercaseHeadings:false,headingRule:false}),
  Object.freeze({key:"EMERALD_V1",name:"Emerald",description:"Clean green-accent layout for modern operations and product roles.",font:"Calibri",fontSize:20,nameSize:32,accent:"1B6B57",nameColor:"174D40",nameAlignment:AlignmentType.LEFT,margin:700,line:270,compact:false,uppercaseHeadings:false,headingRule:true}),
  Object.freeze({key:"ACADEMIC_V1",name:"Academic",description:"Formal serif layout for research, education, and analytical careers.",font:"Times New Roman",fontSize:20,nameSize:32,accent:"333333",nameColor:"111111",nameAlignment:AlignmentType.CENTER,margin:720,line:276,compact:false,uppercaseHeadings:false,headingRule:false}),
  Object.freeze({key:"IMPACT_V1",name:"Impact",description:"Strong oversized name and bold section rules for concise senior profiles.",font:"Arial",fontSize:20,nameSize:36,accent:"174A7E",nameColor:"174A7E",nameAlignment:AlignmentType.LEFT,margin:620,line:260,compact:false,uppercaseHeadings:true,headingRule:true}),
]);
export const TAILORED_RESUME_TEMPLATE_KEYS:ReadonlyArray<TailoredResumeTemplateKey>=Object.freeze(TAILORED_RESUME_TEMPLATES.map(item=>item.key));
const TEMPLATE_BY_KEY=new Map(TAILORED_RESUME_TEMPLATES.map(item=>[item.key,item]));
export function resolveTailoredResumeTemplate(value:unknown):Readonly<TailoredResumeTemplateSpec>{const key=String(value||"CLASSIC_V1").toUpperCase() as TailoredResumeTemplateKey,spec=TEMPLATE_BY_KEY.get(key);if(!spec)throw new Error("TAILORING_TEMPLATE_INVALID");return spec;}

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
