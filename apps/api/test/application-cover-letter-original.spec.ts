import test from "node:test";
import assert from "node:assert/strict";
import {ApplicationService} from "../src/applications/application.service.js";
const user={id:"123e4567-e89b-42d3-a456-426614174000",token:"caller-jwt",claims:{}};
function setup(letter:any,storageError:any=null){
  const signed:any[]=[];
  const service=new ApplicationService({forUser:(token:string)=>{
    assert.equal(token,user.token);
    return{rpc:async(name:string,args:any)=>{
      assert.equal(name,"get_application_cover_letter_v3153");assert.equal(args.p_application_id,"application");
      return{data:letter,error:null};
    },storage:{from:(bucket:string)=>({createSignedUrl:async(path:string,seconds:number)=>{
      signed.push({bucket,path,seconds});return{data:storageError?null:{signedUrl:"https://project.supabase.co/storage/v1/object/sign/cover-letters/original"},error:storageError};
    }})}};
  }}as any);
  return{service,signed};
}
test("original cover letter signs the exact uploaded file without using stale saved text",async()=>{
  for(const mimeType of ["application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","text/plain"]){
    const letter={kind:"BASE",source:"ORIGINAL_UPLOAD",bucket:"cover-letters",path:"owner/original",filename:"Original upload",mimeType,fileSizeBytes:5242880,applicationNumber:72396,resumeNumber:10,text:"Stale text must not be rendered"};
    const{service,signed}=setup(letter);
    const result:any=await service.coverLetter(user,"application");
    assert.equal(result.filename,letter.filename);assert.equal(result.mimeType,mimeType);
    assert.equal(result.contentBase64,undefined);assert.equal(result.source,"ORIGINAL_UPLOAD");
    assert.deepEqual(signed,[{bucket:"cover-letters",path:letter.path,seconds:90}]);
    const copy:any=await service.coverLetterText(user,"application");
    assert.equal(copy.source,"ORIGINAL_UPLOAD");assert.equal(copy.text,undefined);
    assert.equal(copy.signedUrl,result.signedUrl);
    const unavailable=setup(letter,{message:"Object not found"});
    await assert.rejects(()=>unavailable.service.coverLetter(user,"application"),/original cover letter file could not be opened/);
  }
});
test("tailored letter and its existing base-text fallback still render a PDF",async()=>{
  for(const kind of ["TAILORED","BASE"]){
    const{service,signed}=setup({kind,text:"Existing letter body.",candidateName:"Jordan Lee",applicationNumber:7,resumeNumber:12});
    const result:any=await service.coverLetter(user,"application");
    assert.equal(result.kind,kind);assert.equal(result.mimeType,"application/pdf");
    assert.equal(result.filename,"Jordan Lee Cover Letter - App 7.pdf");
    assert.equal(Buffer.from(result.contentBase64,"base64").subarray(0,4).toString(),"%PDF");
    assert.equal(result.signedUrl,undefined);assert.equal(signed.length,0);
    assert.deepEqual(await service.coverLetterText(user,"application"),{kind,text:"Existing letter body."});
    assert.equal(signed.length,0,"copy uses saved tailored/fallback text, not an original file");
  }
});

test("copy does not return empty letter metadata or bypass Application access",async()=>{
  const{service}=setup({kind:"TAILORED",text:"   "});
  await assert.rejects(()=>service.coverLetterText(user,"application"),/text is not available/);
  const denied=new ApplicationService({forUser:()=>({rpc:async()=>({data:null,error:{code:"42501",message:"APPLICATION_RESUME_UNAVAILABLE: Access denied."}})})}as any);
  await assert.rejects(()=>denied.coverLetterText(user,"application"),/Access denied/);
});
