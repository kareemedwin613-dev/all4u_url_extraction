export const PDF_MIME="application/pdf";
export const MAX_PDF_BYTES=5*1024*1024;
export function validatePdfFile(file){
  if(!file)return "Choose a PDF Resume.";
  if(!/\.pdf$/i.test(file.name)||file.type!==PDF_MIME)return "Only a PDF file whose type matches its .pdf extension is supported.";
  if(!file.size||file.size>MAX_PDF_BYTES)return "The PDF must be between 1 byte and 5 MiB.";
  return "";
}
