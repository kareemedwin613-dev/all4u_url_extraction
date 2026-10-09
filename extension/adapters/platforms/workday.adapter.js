import{GenericHtmlAdapter}from"../generic-html-adapter.js";
import{WORKDAY_SECTION_ATTRIBUTE,claimWorkdaySectionControls,detectWorkdaySections,fillWorkdaySections,isWorkdayHost}from"../../autofill/workday.js";
const MATCHER_ATTRIBUTES=["data-resume-jd-autofill-id","data-resume-jd-guide-autofill-id","data-resume-jd-screening-autofill-id"];
// Workday (*.myworkdayjobs.com): My Experience work history, education and skills are filled by autofill/workday.js;
// everything else on each step goes through the generic matchers.
export class WorkdayAdapter extends GenericHtmlAdapter{
 constructor(){super({id:"workday",version:"1.0.0",label:"Workday",tier:"ATS_FAMILY"});}
 matches(url){return isWorkdayHost(url.hostname);}
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
