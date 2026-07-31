import{detectPersonalFields,fillPersonalFields}from"../autofill/personal-field-adapter.js";
import{detectScreeningFields,detectUnresolvedQuestions,fillScreeningFields}from"../autofill/screening-field-adapter.js";
import{attachResumePayload,detectResumeUploadInputs}from"../autofill/resume-upload-adapter.js";
import{BaseAtsAdapter}from"./base-ats-adapter.js";

export class GenericHtmlAdapter extends BaseAtsAdapter{
 constructor(options={}){super({id:"generic-html",version:"1.0.0",label:"Generic HTML",tier:"GENERIC",...options});}
 matches(){return true;}
 detectResumeField({root=document}={}){const candidate=detectResumeUploadInputs(root)[0];return candidate?{confidence:Math.min(100,candidate.score),controlType:"file"}:null;}
 detectFields({root=document,availableKeys=[],applicationAnswers=[]}={}){const fields=[...detectPersonalFields(root,availableKeys),...detectScreeningFields(root,applicationAnswers)],unresolved=detectUnresolvedQuestions(root,applicationAnswers);return{fields,unresolved};}
 attachResume({root=document,payload}={}){return attachResumePayload(payload,root);}
 async fillFields({root=document,fields=[]}={}){const personal=fillPersonalFields(fields.filter(field=>String(field?.key||"").startsWith("candidate.")),root),screening=await fillScreeningFields(fields.filter(field=>String(field?.key||"").startsWith("screening.")),root);return[...personal,...screening];}
}
