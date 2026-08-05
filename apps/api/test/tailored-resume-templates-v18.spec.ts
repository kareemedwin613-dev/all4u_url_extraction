import test from"node:test";
import assert from"node:assert/strict";
import{TailoringService}from"../src/platform/platform.service.js";
import{renderTailoredResumeDocx,resolveTailoredResumeTemplate,TAILORED_RESUME_TEMPLATES}from"../src/platform/tailored-resume.renderer.js";

const input={applicationNumber:19,candidate:{name:"Alex Example",email:"alex@example.com"},sourceStructuredContent:{professional_experience:[{id:"exp-1",company:"Example Co",job_title:"Engineer",is_current:true,experience_details:"Source"}],education:[],certifications:[]},approvedPreview:{summary:"A sufficiently detailed summary for the rendered document.",professionalExperience:[{sourceExperienceId:"exp-1",tailoredDetails:"Delivered reliable systems and measurable improvements."}],skills:["SQL","Python"]}};

test("v1.8 exposes exactly three immutable versioned templates",()=>{
  assert.deepEqual(TAILORED_RESUME_TEMPLATES.map(item=>item.key),["CLASSIC_V1","MODERN_V1","COMPACT_V1"]);
  assert.equal(resolveTailoredResumeTemplate(undefined).key,"CLASSIC_V1");
  assert.throws(()=>resolveTailoredResumeTemplate("CUSTOM_HTML"),/TAILORING_TEMPLATE_INVALID/);
});

test("all v1.8 templates render bounded, distinct DOCX artifacts",async()=>{
  const rendered=await Promise.all(TAILORED_RESUME_TEMPLATES.map(item=>renderTailoredResumeDocx({...input,renderTemplateKey:item.key})));
  for(const bytes of rendered){assert.equal(bytes.subarray(0,2).toString(),"PK");assert.ok(bytes.length>1000&&bytes.length<5242880);}
  assert.equal(new Set(rendered.map(bytes=>bytes.toString("base64"))).size,3);
});

test("template listing and selection remain caller-scoped and allowlisted",async()=>{
  const calls:any[]=[];const service=new TailoringService({forUser:(token:string)=>{assert.equal(token,"jwt");return{rpc:async(name:string,args:any)=>{calls.push({name,args});return{data:{renderTemplateKey:args.p_render_template_key},error:null};}};}}as any);
  assert.equal(service.templates().length,3);
  const result:any=await service.selectTemplate({id:"actor",token:"jwt",claims:{}},"123e4567-e89b-42d3-a456-426614174000",{renderTemplateKey:"MODERN_V1",expectedUpdatedAt:"2026-08-03T12:00:00.000Z"});
  assert.equal(result.renderTemplateKey,"MODERN_V1");
  assert.deepEqual(calls,[{name:"select_tailoring_template_v18",args:{p_tailoring_job_id:"123e4567-e89b-42d3-a456-426614174000",p_render_template_key:"MODERN_V1",p_expected_updated_at:"2026-08-03T12:00:00.000Z"}}]);
});
