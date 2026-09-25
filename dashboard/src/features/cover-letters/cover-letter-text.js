// Extracts the body of an uploaded cover letter as editable text. The header (name, contact),
// greeting, and sign-off are dropped: the tailoring renderer adds them from the Resume.
const SALUTATION=/^(?:dear\b|to whom it may concern|hello\b|hi\b|greetings\b)/i;
const SIGN_OFF=/^(?:sincerely|yours sincerely|yours truly|best regards|kind regards|warm regards|regards|respectfully|best wishes|thank you)[,.!]?$/i;
export const MAX_COVER_LETTER_TEXT=20000;

export function cleanCoverLetterBody(raw){
  const lines=String(raw||"").replace(/\0/g,"").replace(/\r\n?/g,"\n").split("\n").map(line=>line.replace(/\s+/g," ").trim());
  const salutation=lines.findIndex(line=>SALUTATION.test(line)),start=salutation<0?0:salutation+1;
  const signOff=lines.findIndex((line,index)=>index>=start&&line.length<=40&&SIGN_OFF.test(line)),end=signOff<0?lines.length:signOff;
  const paragraphs=[];let current=[];
  for(const line of lines.slice(start,end)){
    if(line)current.push(line);
    else if(current.length){paragraphs.push(current.join(" "));current=[];}
  }
  if(current.length)paragraphs.push(current.join(" "));
  return paragraphs.join("\n\n").slice(0,MAX_COVER_LETTER_TEXT).trim();
}

// PDF text has no blank lines; a vertical gap clearly larger than normal line spacing marks a paragraph.
export function joinPdfLines(lines){
  const gaps=[];
  for(let index=1;index<lines.length;index++){const previous=lines[index-1],line=lines[index];if(previous.text&&line.text&&previous.page===line.page&&previous.y>line.y)gaps.push(previous.y-line.y);}
  // Short letters can have nearly as many paragraph gaps as line gaps, so use a low percentile, not the median.
  const sorted=[...gaps].sort((left,right)=>left-right),lineSpacing=sorted[Math.floor(sorted.length/4)]||0;
  return lines.map((line,index)=>{
    const previous=lines[index-1];
    const paragraphBreak=index>0&&(!line.text||!previous.text||previous.page!==line.page||(lineSpacing>0&&previous.y-line.y>lineSpacing*1.35));
    return`${paragraphBreak?"\n":""}${line.text}`;
  }).join("\n");
}

async function pdfText(buffer){
  const[pdfjs,{default:workerUrl}]=await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"),import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
  const pdf=await pdfjs.getDocument({data:new Uint8Array(buffer)}).promise,lines=[];
  for(let page=1;page<=pdf.numPages;page++){
    let line={page,y:null,text:""};
    for(const item of (await (await pdf.getPage(page)).getTextContent()).items){
      if(typeof item.str!=="string")continue;
      if(line.y===null&&item.str.trim())line.y=item.transform[5];
      line.text+=item.str;
      if(item.hasEOL){lines.push({...line,text:line.text.trim()});line={page,y:null,text:""};}
    }
    if(line.text.trim())lines.push({...line,text:line.text.trim()});
  }
  return joinPdfLines(lines);
}

async function docxText(buffer){
  const mammoth=await import("mammoth/mammoth.browser.js"),extract=mammoth.extractRawText||mammoth.default?.extractRawText;
  return(await extract({arrayBuffer:buffer})).value;
}

export async function extractCoverLetterText(blob,{mimeType="",filename=""}={}){
  const type=String(mimeType||blob.type||"").toLowerCase(),name=String(filename||blob.name||"").toLowerCase(),buffer=await blob.arrayBuffer();
  const raw=type==="application/pdf"||name.endsWith(".pdf")?await pdfText(buffer)
    :type.includes("wordprocessingml")||name.endsWith(".docx")?await docxText(buffer)
    :new TextDecoder().decode(buffer);
  const body=cleanCoverLetterBody(raw);
  if(body.length<100)throw new Error("The cover letter has too little readable text. Scanned or image-only files need to be typed in manually.");
  return body;
}
