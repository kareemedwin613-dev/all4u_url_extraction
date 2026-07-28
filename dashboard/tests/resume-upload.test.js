import test from "node:test";
import assert from "node:assert/strict";
import {candidateContactFromResume,candidateNameFromResume,inferResumeInformation} from "../src/features/resume-upload/resume-inference.js";
import {PDF_MIME,validatePdfFile} from "../src/features/resume-upload/resume-upload-constants.js";
import {findResumesByIdentity,uploadAdminResume,validateResumeUpload} from "../src/features/resume-upload/resume-upload-service.js";
import {normalizeStructuredResumeV2,parseProfessionalExperiences,partialDateInput} from "../src/features/resume-upload/resume-structure.js";

const userId="f3a34ffd-d66a-49f7-815e-c7786857576b",categoryId="b4d63a80-e306-4a2f-afca-29cd4b3951e0";
const file={name:"Jordan-Lee-Resume.pdf",type:PDF_MIME,size:1200};
const text="Jordan Lee\njordan.lee@example.com · (202) 555-0148\nSenior Data Engineer\nSUMMARY\nHealthcare data engineer building patient platforms with Python, SQL, Snowflake, dbt, Airflow and AWS.\nPROFESSIONAL EXPERIENCE\nAcme Health January 2020 - Present\nSenior Data Engineer Remote\n• Built data pipelines and HIPAA analytics systems.\n• Reduced processing time by 35 percent.\nEDUCATION\nBS Computer Science\nSKILLS\nPython SQL Snowflake dbt Airflow AWS\n";

test("Resume inference extracts reviewable information without AI",()=>{
  const result=inferResumeInformation(text,file.name);
  assert.equal(result.candidateName,"Jordan Lee");
  assert.equal(result.candidateEmail,"jordan.lee@example.com");
  assert.equal(result.candidatePhone,"(202) 555-0148");
  assert.equal(result.categorySlug,"data-engineering");
  assert.equal(result.seniority,"SENIOR");
  assert.ok(result.skills.includes("Python"));assert.ok(result.skills.includes("Snowflake"));
  assert.deepEqual(result.industries,["Healthcare Life Sciences"]);
  assert.equal(result.structuredContent.professional_experience[0].company,"Acme Health");
  assert.equal(result.structuredContent.professional_experience[0].job_title,"Senior Data Engineer");
  assert.match(result.structuredContent.professional_experience[0].experience_details,/Built data pipelines/);
});

test("professional experience parsing preserves multiple companies, dates, and combined details",()=>{const result=parseProfessionalExperiences("Accenture January 2020 - Present\nSenior Full Stack Engineer Remote\n• Built an Azure application.\n• Improved processing by 30%.\nBombora January 2016 - December 2019\nFull Stack Engineer Remote\n• Built event-driven services.");assert.equal(result.length,2);assert.equal(result[0].company,"Accenture");assert.equal(result[0].is_current,true);assert.equal(partialDateInput(result[0].start_date),"2020-01");assert.match(result[0].experience_details,/Built an Azure application[\s\S]*Improved processing/);assert.equal(result[1].company,"Bombora");assert.equal(partialDateInput(result[1].end_date),"2019-12");});

test("legacy separate bullets normalize into one experience details field",()=>{const value=normalizeStructuredResumeV2({professional_experience:[{company:"Acme",job_title:"Engineer",bullets:[{text:"Built APIs"},{text:"Improved latency"}]}]});assert.equal(value.professional_experience[0].experience_details,"• Built APIs\n• Improved latency");});

test("candidate name falls back safely to the PDF filename",()=>{
  assert.equal(candidateNameFromResume("SUMMARY\nTechnical profile","Taylor_Morgan_Resume.pdf"),"Taylor Morgan");
  assert.equal(candidateNameFromResume("SUMMARY\nTechnical profile","resume.pdf"),"");
});

test("candidate contact extraction recognizes email and formatted or compact phones",()=>{
  assert.deepEqual(candidateContactFromResume("Jordan\nJORDAN@EXAMPLE.COM\n+1 202-555-0148"),{candidateEmail:"jordan@example.com",candidatePhone:"+1 202-555-0148"});
  assert.equal(candidateContactFromResume("Jordan\n2025550148").candidatePhone,"2025550148");
});

test("PDF and Resume metadata validation are bounded",()=>{
  assert.equal(validatePdfFile(file),"");
  assert.match(validatePdfFile({...file,name:"resume.txt",type:"text/plain"}),/Only a PDF/);
  const valid={candidateName:"Jordan Lee",candidateEmail:"jordan.lee@example.com",candidatePhone:"(202) 555-0148",resumeName:"Jordan Resume",primaryCategoryId:categoryId,subcategoryId:"",seniority:"SENIOR",skills:"Python, SQL",industries:"Healthcare",resumeText:text,structuredContent:inferResumeInformation(text,file.name).structuredContent,checksum:"a".repeat(64)};
  assert.equal(validateResumeUpload(valid,file).valid,true);
  const yearOnly=structuredClone(valid);yearOnly.structuredContent.professional_experience[0].start_date={year:2020,month:null};
  assert.equal(validateResumeUpload(yearOnly,file).valid,true);
  const badMonth=structuredClone(valid);badMonth.structuredContent.professional_experience[0].start_date={year:2020,month:13};
  assert.match(validateResumeUpload(badMonth,file).errors.structuredContent,/invalid start date/);
  assert.equal(validateResumeUpload({...valid,candidateName:"",checksum:"bad"},file).valid,false);
  assert.equal(validateResumeUpload({...valid,candidateEmail:"bad",candidatePhone:"123"},file).valid,false);
});

test("duplicate lookup uses normalized candidate identity instead of file checksum",async()=>{
  let call;const originalFetch=globalThis.fetch,client={auth:{getSession:async()=>({data:{session:{access_token:"token"}},error:null})},rpc:()=>{throw new Error("Direct RPC attempted");}};globalThis.fetch=async(url,options)=>{call={url,body:JSON.parse(options.body)};return new Response(JSON.stringify({data:[{id:"one"}]}),{status:200});};
  const result=await findResumesByIdentity(client,"https://api.example.com",{candidateName:" Jordan Lee ",candidateEmail:"JORDAN.LEE@EXAMPLE.COM",candidatePhone:"(202) 555-0148"});globalThis.fetch=originalFetch;
  assert.equal(result[0].id,"one");
  assert.equal(new URL(call.url).pathname,"/api/v1/resumes/identity-duplicates");assert.deepEqual(call.body,{candidateName:"Jordan Lee",candidateEmail:"jordan.lee@example.com",candidatePhone:"(202) 555-0148"});
});

test("Admin upload sends a private multipart Resume request to the backend",async()=>{
  let request;const originalFetch=globalThis.fetch,client={auth:{getSession:async()=>({data:{session:{access_token:"token"}},error:null})},from:()=>{throw new Error("Direct table insert attempted");},storage:{from:()=>{throw new Error("Direct Storage upload attempted");}}};globalThis.fetch=async(url,options)=>{request={url,options};return new Response(JSON.stringify({data:{id:"created"}}),{status:201});};
  const value={candidateName:"Jordan Lee",candidateEmail:"JORDAN.LEE@EXAMPLE.COM",candidatePhone:"(202) 555-0148",resumeName:"Jordan Resume",primaryCategoryId:categoryId,subcategoryId:"",seniority:"SENIOR",skills:"Python, SQL, Python",industries:"Healthcare",resumeText:text,structuredContent:inferResumeInformation(text,file.name).structuredContent,checksum:"a".repeat(64)};
  const uploadFile=new File([new Uint8Array(1200)],file.name,{type:file.type});const result=await uploadAdminResume(client,"https://api.example.com",userId,value,uploadFile);globalThis.fetch=originalFetch;
  assert.equal(result.id,"created");assert.equal(new URL(request.url).pathname,"/api/v1/resumes");assert.ok(request.options.body instanceof FormData);const metadata=JSON.parse(request.options.body.get("metadata"));assert.deepEqual(metadata.skills,["Python","SQL"]);assert.equal(metadata.structuredSchemaVersion,2);assert.equal(metadata.structuredContent.professional_experience[0].company,"Acme Health");
});
