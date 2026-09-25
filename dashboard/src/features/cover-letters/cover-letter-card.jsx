import React,{useEffect,useState}from"react";
import{Button,Card,Input,Space,Typography}from"antd";
import{createCoverLetterSignedUrl,downloadCoverLetterPdf,saveResumeCoverLetterText}from"../../services/storage-read-service.js";
import{getResume,listResumes}from"../../services/resume-read-service.js";
import{MAX_COVER_LETTER_TEXT,extractCoverLetterText}from"./cover-letter-text.js";

const{Paragraph,Text}=Typography;

// Downloads the stored upload and returns its body text; used by the card and by bulk backfill.
export async function extractUploadedCoverLetter(client,apiBaseUrl,resume){
  const url=await createCoverLetterSignedUrl(client,{id:resume.id,apiBaseUrl}),response=await fetch(url);
  if(!response.ok)throw new Error("The uploaded cover letter could not be downloaded.");
  return extractCoverLetterText(await response.blob(),{mimeType:resume.cover_letter_mime_type,filename:resume.cover_letter_original_filename});
}

// One pass over original Resumes: fill base text for uploads that have none. Existing text is never overwritten.
export async function backfillCoverLetterText(client,apiBaseUrl,onProgress=()=>{}){
  const summary={extracted:0,alreadyHadText:0,failed:[]};
  for(let page=1;;page++){
    const result=await listResumes(client,apiBaseUrl,{page,pageSize:50});
    for(const row of result.items||[]){
      if(!row.cover_letter_storage_path)continue;
      const resume=await getResume(client,apiBaseUrl,row.id);
      if(resume.cover_letter_text){summary.alreadyHadText++;continue;}
      try{
        const text=await extractUploadedCoverLetter(client,apiBaseUrl,resume);
        await saveResumeCoverLetterText(client,{id:resume.id,apiBaseUrl,text});
        summary.extracted++;
      }catch{summary.failed.push(`#${resume.resume_number}`);}
      onProgress(summary);
    }
    if(page>=(result.pageCount||1))return summary;
  }
}

export function CoverLetterBackfillButton({client,apiBaseUrl,toast}){
  const[busy,setBusy]=useState(false),[progress,setProgress]=useState("");
  async function start(){
    setBusy(true);setProgress("");
    try{
      const result=await backfillCoverLetterText(client,apiBaseUrl,value=>setProgress(`${value.extracted} extracted`));
      const failed=result.failed.length?` Could not read: ${result.failed.join(", ")}; paste their text on each Resume.`:"";
      toast(result.failed.length?"warning":"success",`Cover letter text: ${result.extracted} extracted, ${result.alreadyHadText} already had text.${failed}`);
    }catch(error){toast("error",error.message||"Cover letter text extraction failed.");}
    finally{setBusy(false);setProgress("");}
  }
  return <Space wrap style={{marginBottom:12}}>
    <Button onClick={start} loading={busy}>Extract missing cover letter text</Button>
    <Text type="secondary">{busy?progress||"Starting…":"Reads each uploaded cover letter once so tailoring can use it. Review the text on each Resume afterwards."}</Text>
  </Space>;
}

export function CoverLetterCard({client,apiBaseUrl,resume,canManage,toast,onResumeChange}){
  const isOriginal=resume.resume_type==="ORIGINAL",saved=resume.cover_letter_text||"",editable=isOriginal&&canManage;
  const[draft,setDraft]=useState(saved),[busy,setBusy]=useState("");
  useEffect(()=>{setDraft(saved);},[saved,resume.id]);
  const run=async(kind,action)=>{setBusy(kind);try{await action();}catch(error){toast("error",error.message||"The cover letter action failed.");}finally{setBusy("");}};
  const save=text=>run("save",async()=>{const next=await saveResumeCoverLetterText(client,{id:resume.id,apiBaseUrl,text});onResumeChange(next);toast("success",text.trim()?"Base cover letter saved.":"Base cover letter cleared.");});
  const extract=()=>run("extract",async()=>{const text=await extractUploadedCoverLetter(client,apiBaseUrl,resume);setDraft(text);toast("success","Text extracted from the uploaded file. Review it, then save.");});
  const download=()=>run("download",()=>downloadCoverLetterPdf(client,{id:resume.id,apiBaseUrl}));
  const title=isOriginal?"Base cover letter":"Tailored cover letter";
  const help=isOriginal
    ?"Body paragraphs only. The greeting, sign-off, name, and contact details are added from this Resume. Tailoring uses this letter as the candidate's own evidence and voice, so keep every claim true."
    :"Generated for this Application's job from the original Resume and its base cover letter.";
  if(!isOriginal&&!saved)return <Card size="small" title={title}><Text type="secondary">None. This Resume was tailored before cover letters were generated.</Text></Card>;
  return <Card size="small" title={title} extra={saved&&<Button size="small" onClick={download} loading={busy==="download"}>Download PDF</Button>}>
    <Paragraph type="secondary" style={{marginBottom:8}}>{help}</Paragraph>
    {editable?<>
      <Input.TextArea value={draft} onChange={event=>setDraft(event.target.value)} autoSize={{minRows:8,maxRows:24}} maxLength={MAX_COVER_LETTER_TEXT} showCount placeholder="Paste the cover letter body, or extract it from the uploaded file."/>
      <Space wrap style={{marginTop:12}}>
        <Button type="primary" onClick={()=>save(draft)} loading={busy==="save"} disabled={draft===saved}>Save</Button>
        {resume.cover_letter_storage_path&&<Button onClick={extract} loading={busy==="extract"}>Extract from uploaded file</Button>}
        {draft!==saved&&<Button onClick={()=>setDraft(saved)} disabled={Boolean(busy)}>Discard changes</Button>}
      </Space>
    </>:saved?<Paragraph style={{whiteSpace:"pre-wrap",marginBottom:0}}>{saved}</Paragraph>:<Text type="secondary">No base cover letter text yet.</Text>}
  </Card>;
}
