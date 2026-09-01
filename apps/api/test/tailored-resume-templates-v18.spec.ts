import test from"node:test";
import assert from"node:assert/strict";
import{plainToInstance}from"class-transformer";
import{validate}from"class-validator";
import{TailoringService}from"../src/platform/platform.service.js";
import{SubmitTailoringPreviewDto}from"../src/platform/platform.dto.js";
import{renderTailoredResumeDocx,resolveTailoredResumeTemplate,TAILORED_RESUME_TEMPLATES}from"../src/platform/tailored-resume.renderer.js";
import{MAX_TAILORED_SKILLS,resolveTailoredSkillGroups}from"../src/platform/tailored-skill-groups.js";

const input={applicationNumber:19,candidate:{name:"Alex Example",email:"alex@example.com"},sourceStructuredContent:{professional_experience:[{id:"exp-1",company:"Example Co",job_title:"Engineer",is_current:true,experience_details:"Source"}],education:[],certifications:[]},approvedPreview:{summary:"A sufficiently detailed summary for the rendered document.",professionalExperience:[{sourceExperienceId:"exp-1",tailoredDetails:"Delivered reliable systems and measurable improvements."}],skills:["SQL","Python"],skillGroups:[{name:"Languages & Runtimes",skills:["Python"]},{name:"Data & Databases",skills:["SQL"]}]}};

test("the API exposes twelve immutable versioned ATS-safe templates",()=>{
  assert.deepEqual(TAILORED_RESUME_TEMPLATES.map(item=>item.key),[
    "CLASSIC_V1","MODERN_V1","COMPACT_V1","EXECUTIVE_V1","TECHNICAL_V1","MINIMAL_V1",
    "CORPORATE_V1","ELEGANT_V1","SLATE_V1","EMERALD_V1","ACADEMIC_V1","IMPACT_V1",
  ]);
  assert.equal(new Set(TAILORED_RESUME_TEMPLATES.map(item=>item.name)).size,12);
  assert.ok(TAILORED_RESUME_TEMPLATES.every(item=>item.description.length>20));
  assert.equal(resolveTailoredResumeTemplate(undefined).key,"CLASSIC_V1");
  assert.throws(()=>resolveTailoredResumeTemplate("CUSTOM_HTML"),/TAILORING_TEMPLATE_INVALID/);
});

test("all templates render bounded, distinct DOCX artifacts",async()=>{
  const rendered=await Promise.all(TAILORED_RESUME_TEMPLATES.map(item=>renderTailoredResumeDocx({...input,renderTemplateKey:item.key})));
  for(const bytes of rendered){assert.equal(bytes.subarray(0,2).toString(),"PK");assert.ok(bytes.length>1000&&bytes.length<5242880);}
  assert.equal(new Set(rendered.map(bytes=>bytes.toString("base64"))).size,12);
});

test("skills use proposed upper-level groups with deterministic legacy fallback",()=>{
  assert.deepEqual(resolveTailoredSkillGroups(["C#","Agentic AI","Azure","SQL Server","REST APIs","RBAC","Regression testing","Jira","Unmapped Specialty"],[{name:"AI / ML",skills:["Agentic AI"]}]),[
    {name:"Languages & Runtimes",skills:["C#"]},
    {name:"AI / ML",skills:["Agentic AI"]},
    {name:"Cloud & DevOps",skills:["Azure"]},
    {name:"Data & Databases",skills:["SQL Server"]},
    {name:"APIs & Web",skills:["REST APIs"]},
    {name:"Architecture & Security",skills:["RBAC"]},
    {name:"Testing & Quality",skills:["Regression testing"]},
    {name:"Tools & Delivery",skills:["Jira"]},
    {name:"Additional Skills",skills:["Unmapped Specialty"]},
  ]);
  assert.deepEqual(resolveTailoredSkillGroups([],undefined),[]);
});

test("legacy and new previews render only their first 80 unique prioritized skills",()=>{
  const skills=["JD Primary",...Array.from({length:100},(_,index)=>`Skill ${index+1}`),"jd primary"];
  const flattened=resolveTailoredSkillGroups(skills,undefined).flatMap(group=>group.skills);
  assert.equal(flattened.length,MAX_TAILORED_SKILLS);
  assert.equal(flattened[0],"JD Primary");
  assert.ok(flattened.includes("Skill 79"));
  assert.ok(!flattened.includes("Skill 80"));
});

test("API validation accepts grouped previews and remains compatible with legacy flat previews",async()=>{
  const base={generatedAt:"2026-09-01T12:00:00.000Z",result:{...input.approvedPreview,changeSummary:[],unsupportedRequirements:[],warnings:[]}};
  assert.equal((await validate(plainToInstance(SubmitTailoringPreviewDto,base))).length,0);
  assert.equal((await validate(plainToInstance(SubmitTailoringPreviewDto,{...base,result:{...base.result,skillGroups:undefined}}))).length,0);
  assert.ok((await validate(plainToInstance(SubmitTailoringPreviewDto,{...base,result:{...base.result,skillGroups:[{name:"Miscellaneous",skills:["SQL"]}]}}))).length>0);
});

test("template listing and selection remain caller-scoped and allowlisted",async()=>{
  const calls:any[]=[];const service=new TailoringService({forUser:(token:string)=>{assert.equal(token,"jwt");return{rpc:async(name:string,args:any)=>{calls.push({name,args});return{data:{renderTemplateKey:args.p_render_template_key},error:null};}};}}as any);
  assert.equal(service.templates().length,12);
  const result:any=await service.selectTemplate({id:"actor",token:"jwt",claims:{}},"123e4567-e89b-42d3-a456-426614174000",{renderTemplateKey:"TECHNICAL_V1",expectedUpdatedAt:"2026-08-03T12:00:00.000Z"});
  assert.equal(result.renderTemplateKey,"TECHNICAL_V1");
  assert.deepEqual(calls,[{name:"select_tailoring_template_v18",args:{p_tailoring_job_id:"123e4567-e89b-42d3-a456-426614174000",p_render_template_key:"TECHNICAL_V1",p_expected_updated_at:"2026-08-03T12:00:00.000Z"}}]);
});
