import React,{useEffect,useState}from"react";
import{Button,Card,Input,Space,Typography}from"antd";
import{saveResumeHeadline}from"../../services/storage-read-service.js";

const{Paragraph}=Typography;

// Fallback headline for tailored PDFs. Tailored PDFs normally use the target job's title,
// capped at this Resume's seniority; this line is used when that title cannot be.
export function ResumeHeadlineCard({client,apiBaseUrl,resume,toast,onResumeChange}){
  const saved=resume.resume_headline||"",[draft,setDraft]=useState(saved),[busy,setBusy]=useState(false);
  useEffect(()=>{setDraft(saved);},[saved,resume.id]);
  async function save(){
    setBusy(true);
    try{const next=await saveResumeHeadline(client,{id:resume.id,apiBaseUrl,headline:draft});onResumeChange(next);toast("success",draft.trim()?"Resume headline saved.":"Resume headline cleared.");}
    catch(error){toast("error",error.message||"The Resume headline could not be saved.");}
    finally{setBusy(false);}
  }
  return <Card size="small" title="Tailored resume headline">
    <Paragraph type="secondary" style={{marginBottom:8}}>Shown under the name on tailored PDFs when the job title cannot be used (for example management titles or unusual postings). Keep it at or below this Resume's seniority, such as "Senior Data Engineer".</Paragraph>
    <Space.Compact style={{width:"100%",maxWidth:520}}>
      <Input value={draft} onChange={event=>setDraft(event.target.value)} maxLength={80} placeholder="Senior Data Engineer" onPressEnter={()=>draft!==saved&&save()}/>
      <Button type="primary" onClick={save} loading={busy} disabled={draft===saved}>Save</Button>
    </Space.Compact>
  </Card>;
}
