const list = (value: unknown): any[] => Array.isArray(value) ? value : [];
const clean = (value: unknown) => String(value ?? "").normalize("NFKC").replace(/\s+/g," ").trim();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const aliases: Record<string,string[]> = {
  html:["HTML","HTML5"],css:["CSS","CSS3"],javascript:["JavaScript","JS"],typescript:["TypeScript","TS"],
  "node.js":["Node.js","NodeJS"],"ci/cd":["CI/CD","CI / CD","continuous integration and continuous delivery"],
  aws:["AWS","Amazon Web Services"],"google cloud":["Google Cloud","GCP","Google Cloud Platform"],
  "rest apis":["REST APIs","RESTful APIs"]
};
const matches = (text: string, term: string) => (aliases[term.toLowerCase()]||[term]).some(value =>
  new RegExp(`(?<![A-Za-z0-9])${value.split(/\s+/).map(escape).join("\\s+")}(?![A-Za-z0-9])`,"i").test(text));

/** Diagnostic only: lexical presence is not proof of proficiency or an eligibility gate. */
export function keywordCoverage(input: any, preview: any, pdfText: string|null) {
  const source=input?.sourceResume||{},jd=input?.jobDescription||{};
  const original=[...list(source.skills),source.skillsSection,source.summary,...list(source.professionalExperience).map(role=>role.details)].map(clean).join("\n");
  const generated=[preview?.summary,...list(preview?.skills),...list(preview?.professionalExperience).map(role=>role.tailoredDetails)].map(clean).join("\n");
  const seen=new Set<string>();
  const rows=list(jd.skills).map(clean).filter(term=>{const key=term.toLowerCase();if(!term||seen.has(key))return false;seen.add(key);return true;}).slice(0,500).map(keyword=>({
    keyword,sourcePresent:matches(original,keyword),generatedPresent:preview?matches(generated,keyword):null,
    pdfPresent:pdfText===null?null:matches(pdfText,keyword)
  }));
  return {version:1,blocking:false,basis:"Detected JD keywords from the saved job input; presence is not proof of proficiency.",rows,
    missingSupported:rows.filter(row=>row.sourcePresent&&row.generatedPresent===false).map(row=>row.keyword),
    lostInPdf:rows.filter(row=>row.generatedPresent===true&&row.pdfPresent===false).map(row=>row.keyword)};
}

export async function extractCoveragePdfText(bytes: Uint8Array): Promise<string> {
  if(bytes.length>5242880)throw new Error("PDF_TOO_LARGE");
  const {getDocument}=await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task=getDocument({data:bytes,useSystemFonts:false});
  let pdf;
  try {
    pdf=await task.promise;
    if(pdf.numPages>30)throw new Error("PDF_TOO_MANY_PAGES");
    const pages:string[]=[];
    for(let n=1;n<=pdf.numPages;n++){
      const content=await (await pdf.getPage(n)).getTextContent();
      pages.push(content.items.map(item=>"str" in item?item.str:"").join(" "));
    }
    return pages.join("\n");
  } finally { if(pdf)await pdf.destroy();else await task.destroy(); }
}

/** Explicit user request only. Uses caller RLS and the actual stored tailored PDF. */
export async function loadKeywordCoverage(client: any, job: any, extract=extractCoveragePdfText) {
  const {data:snapshot,error}=await client.from("tailoring_prompt_job_snapshots").select("input").eq("job_id",job.id).maybeSingle();
  if(error||!snapshot?.input)return {available:false,blocking:false,message:"Saved input unavailable; coverage was not measured."};
  let pdfText:string|null=null,pdfStatus="NOT_CREATED";
  if(job.tailored_resume_id){
    pdfStatus="UNAVAILABLE";
    try {
      const {data:resume,error:resumeError}=await client.from("resumes").select("storage_bucket,storage_path,mime_type,file_size_bytes").eq("id",job.tailored_resume_id).maybeSingle();
      if(!resumeError&&resume?.storage_bucket==="tailored-resumes"&&resume.mime_type==="application/pdf"&&Number(resume.file_size_bytes)<=5242880){
        const {data:file,error:downloadError}=await client.storage.from(resume.storage_bucket).download(resume.storage_path);
        if(!downloadError&&file&&file.size<=5242880){pdfText=await extract(new Uint8Array(await file.arrayBuffer()));pdfStatus="CHECKED";}
      }
    } catch { /* An unreadable PDF is unknown, never a missing-keyword result. */ }
  }
  return {available:true,...keywordCoverage(snapshot.input,job.output_preview,pdfText),pdfStatus,checkedAt:new Date().toISOString(),jobUpdatedAt:job.updated_at};
}
