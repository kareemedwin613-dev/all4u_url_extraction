import{GenericHtmlAdapter}from"../generic-html-adapter.js";
import{attachResumePayload,detectResumeUploadInputs}from"../../autofill/resume-upload-adapter.js";
import{WORKDAY_SECTION_ATTRIBUTE,claimWorkdaySectionControls,detectWorkdaySections,fillWorkdaySections,isWorkdayHost}from"../../autofill/workday.js";
// Workday's application flow has one upload, the Resume ("Autofill with Resume", then "Resume/CV" on My
// Experience); its heading can sit far above the drop zone. When nothing names the Resume nearby and the page has
// exactly one upload, that upload is the Resume. Two or more uploads are left to the usual rules.
export function workdayResumeInputs(root=document){
 const found=detectResumeUploadInputs(root);
 if(found.length)return found;
 const uploads=[...root.querySelectorAll('input[type="file"]')].filter(input=>!input.disabled);
 return uploads.length===1?[{input:uploads[0],score:80}]:[];
}
const MATCHER_ATTRIBUTES=["data-resume-jd-autofill-id","data-resume-jd-guide-autofill-id","data-resume-jd-screening-autofill-id"];
// Workday (*.myworkdayjobs.com): My Experience work history, education and skills are filled by autofill/workday.js;
// everything else on each step goes through the generic matchers.
export class WorkdayAdapter extends GenericHtmlAdapter{
 constructor(){super({id:"workday",version:"1.1.0",label:"Workday",tier:"ATS_FAMILY"});}
 matches(url){return isWorkdayHost(url.hostname);}
 detectResumeField({root=document}={}){const candidate=workdayResumeInputs(root)[0];return candidate?{confidence:Math.min(100,candidate.score),controlType:"file"}:null;}
 attachResume({root=document,payload}={}){return attachResumePayload(payload,root,workdayResumeInputs);}
 detectFields(context={}){
  const root=context.root||document;
  claimWorkdaySectionControls(root);
  const result=super.detectFields(context);
  // Entry and skills controls belong to the section filler, not to the single-field matchers.
  const owned=new Set();
  for(const element of root.querySelectorAll(`[${WORKDAY_SECTION_ATTRIBUTE}]`))for(const name of MATCHER_ATTRIBUTES){const id=element.getAttribute(name);if(id)owned.add(id);}
  return{...result,fields:result.fields.filter(field=>!owned.has(field.fieldId)),sections:detectWorkdaySections(root)};
 }
 async fillFields(context={}){const results=await super.fillFields(context);return[...results,...await fillWorkdaySections(context.root||document,context.sections)];}
}
