import test from "node:test";
import assert from "node:assert/strict";
import {getDocument} from "pdfjs-dist/legacy/build/pdf.mjs";
import {resumeEducationEntries} from "../src/platform/resume-education.js";
import {renderTailoredResumePdf} from "../src/platform/tailored-resume-pdf.renderer.js";
import {REFERENCE_RESUME_LAYOUTS} from "../src/platform/reference-resume-templates.js";
import {referenceResumeFixture} from "./fixtures/reference-resume.mjs";
test("legacy display parsing preserves exact facts and splits entries at dates or blank lines",()=>{
  const source={education:[],education_legacy_text:"State University\nBachelor's Degree, Computer Science\n2010 – 2014\nOther College\nCertificate\n2020"};
  const before=structuredClone(source),entries=resumeEducationEntries(source);
  assert.equal(entries.length,2);assert.equal(entries[0].dateLabel,"2010 – 2014");
  assert.deepEqual(entries[0].lines,["State University","Bachelor's Degree, Computer Science"]);
  assert.deepEqual(source,before);
  assert.deepEqual(resumeEducationEntries({education_legacy_text:"Uncertain institution and degree"}),[{lines:["Uncertain institution and degree"]}]);
});
for(const spec of REFERENCE_RESUME_LAYOUTS)for(const legacy of [false,true])test(`${spec.key}: ${legacy?"legacy":"structured"} education stays together with readable spacing`,async()=>{
  const input:any={...referenceResumeFixture(true),renderTemplateKey:spec.key};
  input.sourceStructuredContent.education=legacy?[]:[{institution:"North Carolina State University",degree:"Bachelor's Degree",field_of_study:"Computer Science",start_date:{year:2010},end_date:{year:2014},details:"Education details retained"}];
  input.sourceStructuredContent.education_legacy_text=legacy?"North Carolina State University\nBachelor's Degree, Computer Science\n2010 – 2014":"";
  const before=structuredClone(input),pdf=await getDocument({data:new Uint8Array(await renderTailoredResumePdf(input))}).promise;
  try{
    let found=false;
    for(let n=1;n<=pdf.numPages;n++){
      const items=(await(await pdf.getPage(n)).getTextContent()).items.filter((item:any)=>item.str?.trim()) as any[];
      const text=items.map(item=>item.str).join(" ");
      if(text.includes("North Carolina State")){
        found=true;assert.ok(text.includes("Bachelor's Degree"));assert.ok(text.includes("2010")&&text.includes("2014"));
        if(!legacy)assert.ok(text.includes("Education details retained"));
        const school=items.find(item=>item.str.includes("North Carolina")),degree=items.find(item=>item.str.includes("Bachelor's"));
        if(legacy||!spec.inlineEmployer)assert.ok(Math.abs(school.transform[5]-degree.transform[5])>=spec.body*1.3+2);
      }
    }
    assert.ok(found);assert.deepEqual(input,before);
  }finally{await pdf.destroy();}
});
