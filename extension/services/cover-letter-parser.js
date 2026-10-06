import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseResumeFile } from "./resume-parser.js";
import { AppError } from "../shared/errors.js";

export function coverLetterPdfPageText(items){
  return items.filter(item=>typeof item.str==="string")
    .map(item=>`${item.str}${item.hasEOL?"\n":" "}`).join("")
    .replace(/[ \t]+\n/g,"\n").trim();
}

// Loaded only when copying an original upload; no OCR, AI rewriting, or saved-text fallback.
export async function extractCoverLetterText(buffer,mimeType){
  if(mimeType!=="application/pdf")return (await parseResumeFile({type:mimeType},buffer)).text;
  if(typeof chrome!=="undefined"&&chrome.runtime)pdfjs.GlobalWorkerOptions.workerSrc=chrome.runtime.getURL("assets/pdf.worker.min.mjs");
  const task=pdfjs.getDocument({data:new Uint8Array(buffer)});
  try{
    const pdf=await task.promise,pages=[];
    for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
      const page=await pdf.getPage(pageNumber),content=await page.getTextContent();
      pages.push(coverLetterPdfPageText(content.items));
      page.cleanup();
    }
    const text=pages.join("\n\n").trim();
    if(!text)throw new AppError("COVER_LETTER_NO_READABLE_TEXT","This cover letter PDF has no readable text. Upload a text-based PDF, DOCX, or TXT file to use Copy Cover Letter.");
    return text;
  }catch(error){
    if(error instanceof AppError)throw error;
    throw new AppError("COVER_LETTER_PARSE_FAILED","The cover letter PDF could not be read. Try downloading it or upload a readable replacement.");
  }finally{await task.destroy();}
}
