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
  let call;const client={rpc:async(name,args)=>{call={name,args};return {data:[{id:"one"}],error:null};}};
  const result=await findResumesByIdentity(client,{candidateName:" Jordan Lee ",candidateEmail:"JORDAN.LEE@EXAMPLE.COM",candidatePhone:"(202) 555-0148"});
  assert.equal(result[0].id,"one");
  assert.deepEqual(call,{name:"find_resume_identity_duplicates",args:{p_candidate_name:"Jordan Lee",p_candidate_email:"jordan.lee@example.com",p_candidate_phone:"(202) 555-0148"}});
});

test("Admin upload stores a private PDF and structured Resume row",async()=>{
  let uploaded,inserted;
  const client={
    storage:{from:bucket=>({upload:async(path,blob,options)=>{uploaded={bucket,path,blob,options};return {error:null};},remove:async()=>({error:null})})},
    from:()=>({insert:row=>{inserted=row;return {select:()=>({single:async()=>({data:{id:row.id},error:null})})};}}),
  };
  const value={candidateName:"Jordan Lee",candidateEmail:"JORDAN.LEE@EXAMPLE.COM",candidatePhone:"(202) 555-0148",resumeName:"Jordan Resume",primaryCategoryId:categoryId,subcategoryId:"",seniority:"SENIOR",skills:"Python, SQL, Python",industries:"Healthcare",resumeText:text,structuredContent:inferResumeInformation(text,file.name).structuredContent,checksum:"a".repeat(64)};
  const result=await uploadAdminResume(client,userId,value,file);
  assert.equal(result.id,inserted.id);assert.equal(uploaded.bucket,"original-resumes");
  assert.match(uploaded.path,new RegExp("^"+userId+"/"));
  assert.deepEqual(inserted.skills,["Python","SQL"]);
  assert.equal(inserted.structured_schema_version,2);
  assert.equal(inserted.structured_content.professional_experience[0].company,"Acme Health");
  assert.equal(inserted.user_id,userId);
  assert.equal(inserted.candidate_email,"jordan.lee@example.com");
  assert.equal(inserted.candidate_phone,"(202) 555-0148");
});
