import test from "node:test";
import assert from "node:assert/strict";
import {downloadApplicationCoverLetterPdf} from "../src/services/storage-read-service.js";

test("dashboard downloads original bytes unchanged and keeps tailored base64 PDFs",async t=>{
  const previousDocument=globalThis.document;
  t.after(()=>{globalThis.document=previousDocument;});
  const downloads=[],blobs=[];
  globalThis.document={body:{append(){}},createElement:()=>({click(){downloads.push(this.download);},remove(){}})};
  t.mock.method(URL,"createObjectURL",blob=>{blobs.push(blob);return "blob:test";});
  t.mock.method(globalThis,"setTimeout",()=>0);
  const client={auth:{getSession:async()=>({data:{session:{access_token:"jwt"}}})}};
  const original=Uint8Array.from([37,80,68,70,0,255,10,13]);
  let data={source:"ORIGINAL_UPLOAD",kind:"BASE",filename:"Original letter.pdf",mimeType:"application/pdf",signedUrl:"https://project.supabase.co/storage/v1/object/sign/cover-letters/owner/original.pdf?token=test"};
  let storageRequests=0;
  t.mock.method(globalThis,"fetch",async(url,options)=>{
    if(String(url).includes("/api/v1/"))return new Response(JSON.stringify({data}),{status:200});
    storageRequests++;
    assert.equal(String(url),data.signedUrl);assert.equal(options.credentials,"omit");assert.equal(options.headers,undefined);
    return new Response(original,{status:200,headers:{"Content-Type":"application/pdf"}});
  });
  const result=await downloadApplicationCoverLetterPdf(client,{id:"application",apiBaseUrl:"https://api.example.com",companyName:"Acme",candidateName:"Jane Doe"});
  assert.equal(result.filename,"Jane Doe Cover Letter - Acme.pdf");assert.deepEqual(new Uint8Array(await blobs[0].arrayBuffer()),original);
  assert.equal(downloads[0],"Jane Doe Cover Letter - Acme.pdf","named like the Resume download");
  for(const kind of ["TAILORED","BASE"]){
    data={kind,filename:"Jane Doe Cover Letter - App 7.pdf",mimeType:"application/pdf",contentBase64:"JVBERi0xLjQ=",applicationNumber:7};
    const generated=await downloadApplicationCoverLetterPdf(client,{id:"application",apiBaseUrl:"https://api.example.com"});
    assert.equal(generated.filename,"Jane Doe Cover Letter - App 7.pdf","without a company, the Application number, as for the Resume");
    assert.equal(await blobs.at(-1).text(),"%PDF-1.4");
    assert.equal(storageRequests,1,"tailored PDF and base-text fallback do not fetch the original upload");
  }
});
