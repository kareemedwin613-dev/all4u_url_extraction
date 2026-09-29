import test from "node:test";
import assert from "node:assert/strict";
import {keywordCoverage,loadKeywordCoverage,extractCoveragePdfText} from "../src/platform/tailoring-keyword-coverage.js";
import {renderTailoredResumePdf} from "../src/platform/tailored-resume-pdf.renderer.js";
const input={jobDescription:{skills:["HTML","CSS","Jest","Git","RUM","C++","CI/CD","html"]},sourceResume:{skills:["HTML5","CSS3","Jest","C++"],summary:"GitHub workflows",professionalExperience:[]}};
const preview={skills:["HTML5","CSS3","C++","CI/CD"],summary:"Build interfaces",professionalExperience:[],coverLetter:"Jest Git RUM"};
test("coverage is non-blocking, recognizes equivalents and excludes cover-letter-only keywords",()=>{
  const report=keywordCoverage(input,preview,"HTML5 CSS3 CI/CD");
  assert.equal(report.blocking,false);assert.equal(report.rows.length,7);
  assert.deepEqual(report.missingSupported,["Jest"]);assert.deepEqual(report.lostInPdf,["C++"]);
  assert.equal(report.rows.find(r=>r.keyword==="Git")?.sourcePresent,false);
  assert.equal(report.rows.find(r=>r.keyword==="RUM")?.generatedPresent,false);
});
test("unknown PDF/generation stages are not reported as missing",()=>{
  const report=keywordCoverage(input,null,null);
  assert.ok(report.rows.every(row=>row.pdfPresent===null&&row.generatedPresent===null));
  assert.deepEqual(report.missingSupported,[]);assert.deepEqual(report.lostInPdf,[]);
});
function clientFor(downloadError=false){
  return {from:(table:string)=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:table==="tailoring_prompt_job_snapshots"?{input}:{storage_bucket:"tailored-resumes",storage_path:"private.pdf",mime_type:"application/pdf",file_size_bytes:3}})})})}),
    storage:{from:()=>({download:async()=>downloadError?{error:new Error("private error")}:{data:new Blob(["PDF"])}})}};
}
test("report reads saved input and the real artifact without writes",async()=>{
  const report=await loadKeywordCoverage(clientFor(),{id:"job",tailored_resume_id:"resume",output_preview:preview},async bytes=>{assert.equal(bytes.length,3);return "HTML5 CSS3 C++ CI/CD";});
  assert.ok(report.available);if(report.available){assert.equal(report.pdfStatus,"CHECKED");assert.deepEqual(report.lostInPdf,[]);}
});
test("private PDF download failures remain unknown and do not leak errors",async()=>{
  const report=await loadKeywordCoverage(clientFor(true),{id:"job",tailored_resume_id:"resume",output_preview:preview});
  assert.ok(report.available);if(report.available){assert.equal(report.pdfStatus,"UNAVAILABLE");assert.deepEqual(report.lostInPdf,[]);assert.ok(report.rows.every(row=>row.pdfPresent===null));}
  assert.ok(!JSON.stringify(report).includes("private error"));
});
test("extracts keywords from a real generated PDF",async()=>{
  const bytes=await renderTailoredResumePdf({applicationNumber:1,renderTemplateKey:"ALEGREYA_CLASSIC_V1",candidate:{name:"QA Example"},sourceStructuredContent:{},approvedPreview:preview});
  const text=await extractCoveragePdfText(new Uint8Array(bytes));
  const report=keywordCoverage(input,preview,text);assert.deepEqual(report.lostInPdf,[]);
});
