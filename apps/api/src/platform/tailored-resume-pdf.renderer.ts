import PDFDocument from "pdfkit";
import{resolveTailoredResumeTemplate}from"./tailored-resume.renderer.js";
import{resolveTailoredSkillGroups}from"./tailored-skill-groups.js";

type JsonRecord=Record<string,any>;
const text=(value:unknown):string=>String(value??"").trim();
const values=(value:unknown):any[]=>Array.isArray(value)?value:[];
const datePart=(value:any):string=>{if(!value||typeof value!=="object"||!value.year)return"";const month=Number(value.month);return month>=1&&month<=12?`${String(month).padStart(2,"0")}/${value.year}`:String(value.year);};
const dateRange=(item:JsonRecord):string=>[datePart(item.start_date),item.is_current?"Present":datePart(item.end_date)].filter(Boolean).join(" – ");
const cleanLines=(value:unknown):string[]=>text(value).split(/\r?\n/).map(line=>line.replace(/^\s*[•*-]\s*/,"").trim()).filter(Boolean);

export async function renderTailoredResumePdf(input:JsonRecord):Promise<Buffer>{
  const spec=resolveTailoredResumeTemplate(input.renderTemplateKey),candidate=input.candidate||{},structured=input.sourceStructuredContent||{},preview=input.approvedPreview||{};
  const previewById=new Map(values(preview.professionalExperience).map(item=>[text(item.sourceExperienceId),text(item.tailoredDetails)]));
  const margin=Math.max(25,Math.round(spec.margin/20)),bodySize=spec.fontSize/2,nameSize=spec.nameSize/2,accent=`#${spec.accent}`;
  const serif=spec.font==="Georgia"||spec.font==="Times New Roman",fonts=serif?{regular:"Times-Roman",bold:"Times-Bold",italic:"Times-Italic"}:{regular:"Helvetica",bold:"Helvetica-Bold",italic:"Helvetica-Oblique"};
  const document=new PDFDocument({size:"LETTER",margins:{top:margin,right:margin,bottom:margin,left:margin},bufferPages:true,info:{Title:`Tailored Resume for Application #${input.applicationNumber}`,Author:"Resume JD Operations",Subject:`Human-approved Application-specific Resume rendered with ${spec.key}`}});
  const chunks:Buffer[]=[];document.on("data",chunk=>chunks.push(Buffer.from(chunk)));
  const finished=new Promise<Buffer>((resolve,reject)=>{document.on("end",()=>resolve(Buffer.concat(chunks)));document.on("error",reject);});
  const align=spec.nameAlignment==="center"?"center":"left";
  const regular=()=>document.font(fonts.regular).fontSize(bodySize).fillColor("#111111");
  const bold=()=>document.font(fonts.bold).fontSize(bodySize).fillColor("#111111");
  const section=(title:string)=>{document.moveDown(spec.compact ? .55 : .9).font(fonts.bold).fontSize(spec.compact?11:12).fillColor(accent).text(spec.uppercaseHeadings?title.toUpperCase():title);if(spec.headingRule)document.moveTo(document.x,document.y+2).lineTo(document.page.width-margin,document.y+2).lineWidth(spec.compact ? .5 : 1).strokeColor(accent).stroke();document.moveDown(spec.headingRule?(spec.compact ? .35 : .55):(spec.compact ? .15 : .3));};
  document.font(fonts.bold).fontSize(nameSize).fillColor(`#${spec.nameColor}`).text(text(candidate.name)||"Candidate",{align});
  regular();const contact=[candidate.email,candidate.phone,[candidate.city,candidate.stateRegion,candidate.country].map(text).filter(Boolean).join(", ")].map(text).filter(Boolean).join("  |  ");if(contact)document.text(contact,{align});
  const links=[candidate.linkedinUrl,candidate.githubUrl,candidate.portfolioUrl].map(text).filter(Boolean).join("  |  ");if(links)document.text(links,{align});
  section("Summary");regular().text(text(preview.summary),{lineGap:spec.compact?1:2});
  section("Professional Experience");
  for(const item of values(structured.professional_experience)){
    const role=[text(item.job_title),text(item.company)].filter(Boolean).join(" — "),range=dateRange(item);
    bold().text(role,{continued:Boolean(range)});if(range)document.font(fonts.italic).text(`    ${range}`,{align:"right"});
    if(text(item.location))document.font(fonts.italic).fontSize(bodySize).text(text(item.location));
    for(const line of cleanLines(previewById.get(text(item.id))))regular().text(`• ${line}`,{indent:10,lineGap:spec.compact?0:1});
    document.moveDown(spec.compact ? .25 : .45);
  }
  const education=values(structured.education);
  if(education.length||text(structured.education_legacy_text)){
    section("Education");
    for(const item of education){const range=dateRange(item);bold().text(text(item.institution),{continued:Boolean(range)});if(range)document.font(fonts.italic).text(`    ${range}`,{align:"right"});const degree=[item.degree,item.field_of_study,item.gpa?`GPA: ${item.gpa}`:""].map(text).filter(Boolean).join(" — ");if(degree)regular().text(degree);if(text(item.details))regular().text(text(item.details));document.moveDown(spec.compact ? .2 : .35);}
    if(!education.length&&text(structured.education_legacy_text))regular().text(text(structured.education_legacy_text));
  }
  const certifications=values(structured.certifications);if(certifications.length){section("Certifications");for(const item of certifications)regular().text(`• ${text(item.name??item)}`,{indent:10});}
  section("Skills");
  const skillGroups=resolveTailoredSkillGroups(preview.skills,preview.skillGroups),labelWidth=spec.compact?110:125,rowGap=spec.compact?3:5,contentWidth=document.page.width-margin*2;
  skillGroups.forEach((group,index)=>{
    bold();const label=`${group.name}:`,labelHeight=document.heightOfString(label,{width:labelWidth});
    regular();const skills=group.skills.join(", "),skillsWidth=contentWidth-labelWidth-8,skillsHeight=document.heightOfString(skills,{width:skillsWidth,lineGap:spec.compact?1:2}),rowHeight=Math.max(labelHeight,skillsHeight);
    if(document.y+rowHeight>document.page.height-margin)document.addPage();
    const y=document.y;bold().text(label,margin,y,{width:labelWidth});regular().text(skills,margin+labelWidth+8,y,{width:skillsWidth,lineGap:spec.compact?1:2});document.x=margin;document.y=y+rowHeight+(index<skillGroups.length-1?rowGap:0);
  });
  const range=document.bufferedPageRange();for(let index=range.start;index<range.start+range.count;index++){
    document.switchToPage(index);
    const bottomMargin=document.page.margins.bottom;document.page.margins.bottom=0;
    document.font("Helvetica").fontSize(8).fillColor("#666666").text(`${index+1}`,margin,document.page.height-margin+8,{width:document.page.width-margin*2,align:"center",lineBreak:false});
    document.page.margins.bottom=bottomMargin;
  }
  document.end();
  return finished;
}
