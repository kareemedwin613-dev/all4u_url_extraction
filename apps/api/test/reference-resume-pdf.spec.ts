import test from "node:test";
import assert from "node:assert/strict";
import { getDocument } from "../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { renderTailoredResumePdf } from "../src/platform/tailored-resume-pdf.renderer.js";
import { REFERENCE_RESUME_LAYOUTS } from "../src/platform/reference-resume-templates.js";
import { referenceResumeFixture } from "./fixtures/reference-resume.mjs";

for(const spec of REFERENCE_RESUME_LAYOUTS)for(const long of [false,true])test(`${spec.key}: ${long?"long":"short"} PDF preserves text, section order, embedded fonts and page bounds`,async()=>{
  const input={...referenceResumeFixture(long),renderTemplateKey:spec.key},before=structuredClone(input),bytes=await renderTailoredResumePdf(input);
  assert.deepEqual(input,before);
  assert.ok(bytes.length<5242880);
  const pdf=await getDocument({data:new Uint8Array(bytes)}).promise;
  try{
    assert.ok(pdf.numPages>=1&&pdf.numPages<10);
    if(long)assert.ok(pdf.numPages>1);
    if(long&&spec.key==="LORA_BANDS_V1")assert.equal(pdf.numPages,3,"a one-line education entry must not create an unnecessary fourth page");
    const all:string[]=[],fontNames=new Set<string>();
    for(let n=1;n<=pdf.numPages;n++){
      const page=await pdf.getPage(n),content=await page.getTextContent(),items=content.items.filter((item:any)=>item.str?.trim()) as any[];
      assert.ok(items.length>2,`page ${n} must not be blank or footer-only`);
      await page.getOperatorList();
      for(const item of items){
        const x=item.transform[4],y=item.transform[5];
        assert.ok(x>=spec.margin-1&&x+item.width<=612-spec.margin+1,`horizontal overflow: ${item.str}`);
        assert.ok(y>spec.margin-2&&y<792,`vertical overflow: ${item.str}`);
        fontNames.add(page.commonObjs.get(item.fontName).name);
      }
      all.push(items.map((item:any)=>item.str).join(" "));
    }
    const text=all.join(" ").replace(/\s+/g," ");
    for(const phrase of ["Alex Morgan","alex@example.com","Bachelor of Science","Example University","Python","Jira"])assert.ok(text.includes(phrase),`missing ${phrase}`);
    const compact=text.replace(/\s+/g,"");
    for(const skill of input.approvedPreview.skills.slice(0,80))assert.ok(compact.includes(skill.replace(/\s+/g,"")),`missing skill ${skill}`);
    for(const role of input.approvedPreview.professionalExperience)for(const line of role.tailoredDetails.split("\n"))
      assert.ok(compact.includes(line.replace(/^- /,"").replace(/\s+/g,"")),`missing bullet ${line}`);
    assert.equal((text.match(/Delivered/g)||[]).length,input.sourceStructuredContent.professional_experience.length);
    assert.ok(!text.includes("Not rendered beyond"));
    assert.ok(!text.includes("Professional Highlights")&&!text.includes("Environment:"));
    for(const role of input.sourceStructuredContent.professional_experience)assert.ok(text.includes(role.company),`missing employer ${role.company}`);
    const labels={summary:"Summary",experience:"Professional Experience",skills:"Skills",education:"Education"};let previous=-1;
    for(const section of spec.sections){const title=spec.uppercase?labels[section].toUpperCase():labels[section],index=text.indexOf(title);assert.ok(index>previous,`section order ${title}`);previous=index;}
    assert.ok([...fontNames].every(font=>font.toLowerCase().replace(/[^a-z]/g,"").includes(spec.font.replace(/\s/g,"").toLowerCase())),`unexpected font ${[...fontNames]}`);
  }finally{await pdf.destroy();}
});

test("long words and wrapped headers do not overflow or discard content",async()=>{
  const input=referenceResumeFixture(true);input.candidate.name="Alexandra "+"Montgomery ".repeat(6);
  input.candidate.linkedinUrl="https://example.test/"+"a".repeat(210);
  input.approvedPreview.professionalExperience[0].tailoredDetails="- Implemented "+"integration".repeat(100)+" for reliable processing.";
  const bytes=await renderTailoredResumePdf({...input,renderTemplateKey:"AMIRI_COMPACT_V1"});
  const pdf=await getDocument({data:new Uint8Array(bytes)}).promise;
  try{let combined="";for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n),content=await page.getTextContent();for(const item of content.items as any[]){if(!item.str)continue;assert.ok(item.transform[4]+item.width<=579);combined+=item.str;}}
    assert.ok(combined.includes("integration".repeat(100)));assert.ok(combined.includes("for reliable processing."));
  }finally{await pdf.destroy();}
});

for(const spec of REFERENCE_RESUME_LAYOUTS)test(`${spec.key}: full 80-skill section is preserved without blank pages or overflow`,async()=>{
  const input={...referenceResumeFixture(),renderTemplateKey:spec.key};
  input.approvedPreview.skills=Array.from({length:80},(_,i)=>`Quantitative Research Capability ${String(i+1).padStart(2,'0')}`);
  const bytes=await renderTailoredResumePdf(input),pdf=await getDocument({data:new Uint8Array(bytes)}).promise;
  try{
    let text='';assert.ok(pdf.numPages<=4);
    for(let n=1;n<=pdf.numPages;n++){
      const page=await pdf.getPage(n),content=await page.getTextContent(),items=content.items.filter((item:any)=>item.str?.trim()) as any[];
      assert.ok(items.length>2,`page ${n} is blank or footer-only`);
      for(const item of items){assert.ok(item.transform[4]>=spec.margin-1&&item.transform[4]+item.width<=612-spec.margin+1);assert.ok(item.transform[5]>spec.margin-2&&item.transform[5]<792);}
      text+=items.map(item=>item.str).join(' ');
    }
    const compact=text.replace(/\s+/g,'');
    for(const skill of input.approvedPreview.skills)assert.ok(compact.includes(skill.replace(/\s+/g,'')),`missing ${skill}`);
  }finally{await pdf.destroy();}
});
