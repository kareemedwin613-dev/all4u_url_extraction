import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import {ResumeService} from "../src/resumes/resume.service.js";

const user={id:"123e4567-e89b-42d3-a456-426614174000",token:"jwt",claims:{}},file={size:1024,mimetype:"application/pdf",originalname:"resume.pdf",buffer:Buffer.from("pdf")};
const metadata={candidateName:"Jordan Lee",candidateFirstName:"Jordan",candidateMiddleName:"",candidateLastName:"Lee",candidateEmail:"JORDAN@EXAMPLE.COM",candidatePhone:"202-555-0148",addressLine1:"1 Main St",city:"Austin",stateRegion:"TX",postalCode:"78701",country:"United States",linkedInUrl:"https://linkedin.com/in/jordan",githubUrl:"",portfolioUrl:"",reviewConfirmed:true,resumeName:"Jordan Resume",primaryCategoryId:"223e4567-e89b-42d3-a456-426614174000",seniority:"SENIOR",skills:["TypeScript"],industries:[],resumeText:"x".repeat(120),structuredContent:{summary:"Engineer",professional_experience:[],education:[],certifications:[],skills:"TypeScript"},checksum:"a".repeat(64)};

test("reviewed upload stores canonical metadata as verified in one Resume insert",async()=>{
 let inserted:any;const query:any={insert:(row:any)=>{inserted=row;return query;},select:()=>query,single:async()=>({data:{id:rowId,profile_review_status:"VERIFIED"},error:null})},rowId="323e4567-e89b-42d3-a456-426614174000";
 const client={storage:{from:()=>({upload:async()=>({error:null}),remove:async()=>({error:null})})},from:(table:string)=>{assert.equal(table,"resumes");return query;}};
 const service=new ResumeService({forUser:(token:string)=>{assert.equal(token,"jwt");return client;}}as any),result=await service.upload(user as any,metadata,file);
 assert.equal(result.profile_review_status,"VERIFIED");assert.equal(inserted.candidate_first_name,"Jordan");assert.equal(inserted.candidate_last_name,"Lee");assert.equal(inserted.profile_reviewed_by,user.id);assert.equal(inserted.profile_review_status,"VERIFIED");assert.match(inserted.profile_reviewed_at,/T/);assert.equal(inserted.linkedin_url,"https://linkedin.com/in/jordan");assert.equal(inserted.structured_schema_version,3);
});

test("upload cannot bypass review confirmation or HTTPS link validation",async()=>{
 const service=new ResumeService({forUser:()=>{throw new Error("Storage should not be reached");}}as any);
 await assert.rejects(()=>service.upload(user as any,{...metadata,reviewConfirmed:false},file),(error:any)=>error.code==="VALIDATION_ERROR");
 await assert.rejects(()=>service.upload(user as any,{...metadata,linkedInUrl:"http://linkedin.example/jordan"},file),(error:any)=>error.code==="VALIDATION_ERROR");
});
