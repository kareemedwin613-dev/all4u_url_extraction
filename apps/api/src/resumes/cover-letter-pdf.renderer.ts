import PDFDocument from "pdfkit";

type ResumeRow=Record<string,any>;
const text=(value:unknown):string=>String(value??"").trim();

// Letter body is stored without greeting or signature; identity comes from the Resume row,
// never from generated text, so a letter cannot carry a different name or contact.
export function coverLetterParagraphs(body:unknown):string[]{
  return text(body).split(/\r?\n[ \t]*\r?\n/).map(paragraph=>paragraph.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).join(" ")).filter(Boolean);
}

export function coverLetterContactLine(resume:ResumeRow):string{
  const location=[resume.address_city,resume.address_state_region].map(text).filter(Boolean).join(", ");
  return[resume.candidate_email,resume.candidate_phone,location,resume.linkedin_url].map(text).filter(Boolean).join("  |  ");
}

export async function renderCoverLetterPdf(resume:ResumeRow,today=new Date()):Promise<Buffer>{
  const paragraphs=coverLetterParagraphs(resume.cover_letter_text),name=text(resume.candidate_name)||"Candidate";
  if(!paragraphs.length)throw new Error("The cover letter has no text to render.");
  const document=new PDFDocument({size:"LETTER",margins:{top:60,right:64,bottom:60,left:64},info:{Title:`Cover Letter - ${name}`,Author:name}});
  const chunks:Buffer[]=[];document.on("data",chunk=>chunks.push(Buffer.from(chunk)));
  const finished=new Promise<Buffer>((resolve,reject)=>{document.on("end",()=>resolve(Buffer.concat(chunks)));document.on("error",reject);});
  document.font("Helvetica-Bold").fontSize(18).fillColor("#1f2937").text(name);
  const contact=coverLetterContactLine(resume);
  if(contact)document.moveDown(0.2).font("Helvetica").fontSize(9.5).fillColor("#4b5563").text(contact);
  document.moveDown(1.4).font("Helvetica").fontSize(11).fillColor("#111827")
    .text(today.toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric",timeZone:"UTC"}))
    .moveDown(1).text("Dear Hiring Manager,").moveDown(0.8);
  for(const paragraph of paragraphs)document.text(paragraph,{align:"left",lineGap:2}).moveDown(0.8);
  document.moveDown(0.4).text("Sincerely,").moveDown(0.3).text(name);
  document.end();
  return finished;
}
