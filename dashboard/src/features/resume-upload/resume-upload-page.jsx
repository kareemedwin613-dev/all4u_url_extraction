import React,{useMemo,useState} from "react";
import {SENIORITIES} from "../../shared/constants.js";
import {formatBytes,formatLabel} from "../../shared/formatters.js";
import {findResumeByChecksum,uploadAdminResume,validateResumeUpload} from "./resume-upload-service.js";
import {ExperienceEditor} from "./experience-editor.jsx";

const emptyDraft=()=>({candidateName:"",resumeName:"",primaryCategoryId:"",subcategoryId:"",seniority:"UNSPECIFIED",skills:"",industries:"",resumeText:"",structuredContent:{summary:"",professional_experience:[],education:"",skills:""},checksum:""});

export function AdminResumeUploadPage({client,access,categories}){
  const [file,setFile]=useState(),[draft,setDraft]=useState(emptyDraft),[busy,setBusy]=useState(false),[progress,setProgress]=useState(""),[message,setMessage]=useState(""),[error,setError]=useState(""),[details,setDetails]=useState();
  const subcategories=useMemo(()=>categories.childrenByParent.get(draft.primaryCategoryId)||[],[categories,draft.primaryCategoryId]);
  const change=event=>setDraft(value=>({...value,[event.target.name]:event.target.value}));
  const sectionChange=event=>setDraft(value=>({...value,structuredContent:{...value.structuredContent,[event.target.name]:event.target.value}}));

  async function choose(event){
    const selected=event.target.files?.[0];setFile(selected);setError("");setMessage("");setDetails();if(!selected){setDraft(emptyDraft());return;}
    setBusy(true);setProgress("Reading the PDF and extracting text...");
    try{
      const {parsePdfResume}=await import("./resume-upload-parser.js"),parsed=await parsePdfResume(selected),primary=categories.bySlug.get(parsed.categorySlug),subcategory=categories.bySlug.get(parsed.subcategorySlug);
      setDraft({candidateName:parsed.candidateName,resumeName:parsed.resumeName,primaryCategoryId:primary?.id||"",subcategoryId:subcategory?.parent_id===primary?.id?subcategory.id:"",seniority:parsed.seniority,skills:parsed.skills.join(", "),industries:parsed.industries.join(", "),resumeText:parsed.resumeText,structuredContent:parsed.structuredContent,checksum:parsed.checksum});
      setDetails({pageCount:parsed.pageCount,skillCount:parsed.skills.length,experienceCount:parsed.structuredContent.professional_experience.length,categoryConfidence:parsed.categoryConfidence,reasons:parsed.reasons});
      setProgress("Extraction completed. Review every field before saving.");
    }catch(cause){setDraft(emptyDraft());setError(cause.message);setProgress("Extraction failed.");}
    finally{setBusy(false);}
  }

  async function submit(event){
    event.preventDefault();setError("");setMessage("");
    const check=validateResumeUpload(draft,file);if(!check.valid){setError(Object.values(check.errors).join(" "));return;}
    setBusy(true);setProgress("Checking for duplicate files...");
    try{
      const duplicate=await findResumeByChecksum(client,draft.checksum);
      if(duplicate&&!window.confirm("This PDF matches "+duplicate.resume_name+" ("+formatLabel(duplicate.status)+"). Save another Resume record anyway?")){setProgress("Upload cancelled.");return;}
      setProgress("Uploading the private PDF and saving extracted information...");
      const created=await uploadAdminResume(client,access.userId,draft,file);
      setMessage("Resume uploaded successfully. The private PDF and reviewed structured information were saved.");
      setProgress("Completed.");location.assign("#/resumes/"+created.id);
    }catch(cause){setError(cause.message);setProgress("Upload failed.");}
    finally{setBusy(false);}
  }

  const fileDetails=file?file.name+" · "+formatBytes(file.size)+(details?" · "+details.pageCount+" page"+(details.pageCount===1?"":"s")+" · "+details.skillCount+" detected skills · "+details.experienceCount+" experience"+(details.experienceCount===1?"":"s"):""):"";
  const categoryDetails=details?.categoryConfidence?"Category suggestion confidence: "+formatLabel(details.categoryConfidence)+(details.reasons?.length?" · "+details.reasons.join("; "):"")+". Select the correct category before saving.":"";
  return <div className="page narrow-page"><a className="back-link" href="#/resumes">Back to Resumes</a><h1 tabIndex="-1">Upload Resume</h1><p>Admin-only upload. Select a text-based PDF; extraction happens locally in the browser and can be reviewed before anything is saved. No AI service is used.</p>{error&&<p className="notice error" role="alert">{error}</p>}{message&&<p className="notice success" role="status">{message}</p>}<form className="panel resume-upload-form" onSubmit={submit}><label>PDF Resume<input type="file" accept=".pdf,application/pdf" onChange={choose} disabled={busy} required/></label>{file&&<p className="muted">{fileDetails}</p>}<p className="form-message neutral" aria-live="polite">{progress}</p><fieldset disabled={!draft.resumeText||busy}><legend>Review extracted Resume information</legend><div className="resume-upload-grid"><label>Candidate name<input name="candidateName" value={draft.candidateName} onChange={change} maxLength="200" required/></label><label>Resume name<input name="resumeName" value={draft.resumeName} onChange={change} maxLength="200" required/></label><label>Primary category<select name="primaryCategoryId" value={draft.primaryCategoryId} onChange={event=>setDraft(value=>({...value,primaryCategoryId:event.target.value,subcategoryId:""}))} required><option value="">Select category</option>{categories.primary.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Subcategory (optional)<select name="subcategoryId" value={draft.subcategoryId} onChange={change}><option value="">None</option>{subcategories.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Seniority<select name="seniority" value={draft.seniority} onChange={change}>{SENIORITIES.map(item=><option value={item} key={item}>{formatLabel(item)}</option>)}</select></label><label>Detected skills, comma-separated<input name="skills" value={draft.skills} onChange={change}/></label><label className="wide-field">Industry experience, comma-separated<input name="industries" value={draft.industries} onChange={change}/></label></div>{categoryDetails&&<p className="muted">{categoryDetails}</p>}<section className="structured-editor"><h2>Structured Resume</h2><p className="muted">Correct the extraction and add anything missing before saving.</p><label>Summary<textarea name="summary" value={draft.structuredContent.summary} onChange={sectionChange} rows="5"/></label><ExperienceEditor experiences={draft.structuredContent.professional_experience} onChange={professional_experience=>setDraft(value=>({...value,structuredContent:{...value.structuredContent,professional_experience}}))}/><label>Education<textarea name="education" value={draft.structuredContent.education} onChange={sectionChange} rows="6"/></label><label>Skills Section<textarea name="skills" value={draft.structuredContent.skills} onChange={sectionChange} rows="5"/></label></section><details><summary>Original extracted Resume text</summary><label>Full extracted text<textarea name="resumeText" value={draft.resumeText} onChange={change} rows="14" required/></label></details><button disabled={busy}>{busy?"Working...":"Save Resume"}</button></fieldset></form></div>;
}
