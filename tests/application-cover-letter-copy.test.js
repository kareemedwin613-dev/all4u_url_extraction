import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import PDFDocument from "pdfkit";
import {copyApplicationCoverLetter} from "../extension/services/application-service.js";
import {coverLetterPdfPageText,extractCoverLetterText} from "../extension/services/cover-letter-parser.js";

const client={auth:{getSession:async()=>({data:{session:{access_token:"jwt"}}})}};
const api="https://api.example.com",id="application";
const response=data=>new Response(JSON.stringify({data}),{status:200});

test("copies tailored and fallback letter text without generating or downloading a PDF",async t=>{
  for(const kind of ["TAILORED","BASE"]){
    t.mock.method(globalThis,"fetch",async(url,options)=>{
      assert.equal(url,`${api}/api/v1/applications/${id}/cover-letter/text`);
      assert.equal(options.headers.Authorization,"Bearer jwt");
      return response({kind,text:"Dear hiring team,\r\n\r\nMy letter.\r\n\r\nRegards,\r\nAlex"});
    });
    let copied;
    const result=await copyApplicationCoverLetter(client,api,id,async text=>{copied=text;},()=>assert.fail("No file extraction for tailored text"));
    assert.equal(copied,"Dear hiring team,\n\nMy letter.\n\nRegards,\nAlex");assert.equal(result.kind,kind);
  }
});

test("copies original file text rather than stale saved text and never forwards API credentials to storage",async t=>{
  const text="Dear hiring team,\n\nOriginal file content.\n\nAlex";
  const bytes=new TextEncoder().encode(text);
  const data={kind:"BASE",source:"ORIGINAL_UPLOAD",text:"Wrong saved text",mimeType:"text/plain",fileSizeBytes:bytes.length,signedUrl:"https://project.supabase.co/storage/v1/object/sign/cover-letters/owner/file.txt?token=test"};
  t.mock.method(globalThis,"fetch",async(url,options)=>{
    if(url.includes("/api/v1/"))return response(data);
    assert.equal(url,data.signedUrl);assert.equal(options.credentials,"omit");assert.equal(options.headers,undefined);
    return new Response(bytes);
  });
  let copied;
  await copyApplicationCoverLetter(client,api,id,async value=>{copied=value;});
  assert.equal(copied,text);
});

test("failed requests, invalid metadata, unreadable files and clipboard rejection do not report success",async t=>{
  let data={kind:"TAILORED",text:""};
  t.mock.method(globalThis,"fetch",async url=>url.includes("/api/v1/")?response(data):new Response("expired",{status:403}));
  const notWritten=()=>assert.fail("Must not change clipboard");
  await assert.rejects(()=>copyApplicationCoverLetter(client,api,id,notWritten),/no readable text/);
  data={kind:"TAILORED",text:"A letter"};
  await assert.rejects(()=>copyApplicationCoverLetter(client,api,id,async()=>{throw new Error("NotAllowedError");}),/Clipboard access failed/);
  data={kind:"BASE",source:"ORIGINAL_UPLOAD",signedUrl:"javascript:alert(1)",mimeType:"text/plain",fileSizeBytes:20};
  await assert.rejects(()=>copyApplicationCoverLetter(client,api,id,notWritten),/metadata is invalid/);
  data.signedUrl="https://project.supabase.co/storage/v1/object/sign/cover-letters/owner/file.txt";
  await assert.rejects(()=>copyApplicationCoverLetter(client,api,id,notWritten),/could not be read/);
  t.mock.method(globalThis,"fetch",async url=>url.includes("/api/v1/")?response(data):new Response("file"));
  await assert.rejects(()=>copyApplicationCoverLetter(client,api,id,notWritten,async()=>""),/no readable text/);
  t.mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({code:"ACCESS_DENIED",message:"Access denied"}),{status:403}));
  await assert.rejects(()=>copyApplicationCoverLetter(client,api,id,notWritten),/Access denied/);
});

test("cover letter parser supports PDF and DOCX and retains PDF line breaks",async()=>{
  const items=[{str:"Dear",hasEOL:false},{str:"team,",hasEOL:true},{str:"My letter.",hasEOL:true}];
  assert.equal(coverLetterPdfPageText(items),"Dear team,\nMy letter.");
  for(const [filename,mime] of [["sample-resume.pdf","application/pdf"],["sample-resume.docx","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]]){
    const bytes=readFileSync(new URL(`fixtures/${filename}`,import.meta.url));
    const text=await extractCoverLetterText(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),mime);
    assert.ok(text.length>20);
  }
  const buffer=await new Promise(resolve=>{
    const pdf=new PDFDocument(),chunks=[];
    pdf.on("data",chunk=>chunks.push(chunk));pdf.on("end",()=>resolve(Buffer.concat(chunks)));pdf.end();
  });
  await assert.rejects(()=>extractCoverLetterText(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),"application/pdf"),/no readable text/);
});

test("Copy Cover Letter sits beside Download and is wired to a clipboard-only action",()=>{
  const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
  const card=read("../extension/sidepanel/components/ApplicationCard.jsx"),view=read("../extension/sidepanel/views/MyApplicationsView.jsx");
  assert.match(card,/Download Cover Letter<\/Button>\}\s*\{onCopyCoverLetter/);
  assert.match(card,/COPY_COVER_LETTER/);assert.match(card,/onClick=\{\(\) => onCopyCoverLetter\(application\)\}/);
  assert.match(view,/onCopyCoverLetter=\{copyCoverLetter\}/);
  assert.match(view,/await copyApplicationCoverLetter\(client, backendBaseUrl, application.id\)/);
  const manifest=JSON.parse(read("../extension/manifest.json"));
  assert.ok(manifest.permissions.includes("clipboardWrite"));assert.ok(!manifest.permissions.includes("clipboardRead"));
});
