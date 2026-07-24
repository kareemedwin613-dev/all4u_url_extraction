import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import {inferResumeInformation} from "./resume-inference.js";
import {validatePdfFile} from "./resume-upload-constants.js";

pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;

const normalize=text=>String(text||"").replace(/\0/g,"").replace(/\r\n?/g,"\n").replace(/[ \t]+\n/g,"\n").replace(/\n{4,}/g,"\n\n\n").trim().slice(0,300000);
export async function sha256Hex(buffer){const digest=await crypto.subtle.digest("SHA-256",buffer);return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,"0")).join("");}

export async function parsePdfResume(file){
  const error=validatePdfFile(file);if(error)throw new Error(error);
  try{
    const buffer=await file.arrayBuffer(),pdf=await pdfjs.getDocument({data:new Uint8Array(buffer)}).promise,pages=[];
    for(let number=1;number<=pdf.numPages;number++){
      const content=await (await pdf.getPage(number)).getTextContent();
      pages.push(content.items.map(item=>String(item.str||"")+(item.hasEOL?"\n":" ")).join(""));
    }
    const text=normalize(pages.join("\n\n"));
    if(text.length<100)throw new Error("The PDF has too little readable text. Scanned or image-only PDFs require OCR, which is not supported.");
    return {...inferResumeInformation(text,file.name),checksum:await sha256Hex(buffer),pageCount:pdf.numPages};
  }catch(cause){
    if(/too little readable text|only a pdf|5 mib/i.test(cause.message))throw cause;
    throw new Error("The PDF could not be read. Confirm it is a valid, text-based PDF.");
  }
}
