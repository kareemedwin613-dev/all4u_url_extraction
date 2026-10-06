import{fillPersonalFields,personalFieldCandidates,personalFieldResult,tagPersonalField}from"../autofill/personal-field-adapter.js";
import{detectUnresolvedQuestions,fillScreeningFields,screeningFieldCandidates,screeningFieldResult,tagScreeningField}from"../autofill/screening-field-adapter.js";
import{fillGuideFields,guideFieldCandidates,guideFieldResult,tagGuideField}from"../autofill/guide-field-adapter.js";
import{attachResumePayload,detectResumeUploadInputs}from"../autofill/resume-upload-adapter.js";
import{BaseAtsAdapter}from"./base-ats-adapter.js";

const PERSONAL_KEY=/^(candidate|employment|education)\./;
// Ties go to the Application Guide, then the Resume's Answer Library, then contact and history fields.
const PRIORITY={guide:3,screening:2,personal:1};

// Every control is owned by at most one matcher, so one field is never filled twice.
export function arbitrateAutofillCandidates({personal=[],screening=[],guide=[]}){
 const all=[...guide.map(item=>({...item,kind:"guide",elements:item.elements||[item.element]})),...screening.map(item=>({...item,kind:"screening",elements:item.elements||[item.element]})),...personal.map(item=>({...item,kind:"personal",elements:[item.element]}))]
  .sort((a,b)=>b.confidence-a.confidence||PRIORITY[b.kind]-PRIORITY[a.kind]);
 const claimed=new Set(),usedKeys=new Set(),winners=[];
 for(const candidate of all){
  if(candidate.elements.some(element=>claimed.has(element)))continue;
  // A Resume value or library answer fills one control; one guide answer may cover several questions.
  if(candidate.kind!=="guide"&&usedKeys.has(candidate.key))continue;
  candidate.elements.forEach(element=>claimed.add(element));usedKeys.add(candidate.key);winners.push(candidate);
 }
 return winners;
}

export class GenericHtmlAdapter extends BaseAtsAdapter{
 constructor(options={}){super({id:"generic-html",version:"2.0.0",label:"Generic HTML",tier:"GENERIC",...options});}
 matches(){return true;}
 detectResumeField({root=document}={}){const candidate=detectResumeUploadInputs(root)[0];return candidate?{confidence:Math.min(100,candidate.score),controlType:"file"}:null;}
 detectFields({root=document,availableKeys=[],applicationAnswers=[],guideEntries=[]}={}){
  const winners=arbitrateAutofillCandidates({personal:personalFieldCandidates(root,availableKeys),screening:screeningFieldCandidates(root,applicationAnswers),guide:guideFieldCandidates(root,guideEntries)});
  const stamp=Date.now().toString(36),fields=[],never=[];let sequence=0;
  for(const winner of winners){
   const fieldId=`${winner.kind}_${stamp}_${sequence++}`;
   if(winner.kind==="guide"){
    tagGuideField(winner.elements,fieldId);
    // A person answers NEVER questions; claiming them keeps every other matcher away.
    if(winner.mode==="NEVER"){never.push({question:winner.label,normalizedQuestion:winner.label.toLowerCase(),controlType:winner.controlType,reason:"REVIEW_REQUIRED",guideEntryId:winner.guideEntryId,suggestions:[]});continue;}
    fields.push(guideFieldResult(winner,fieldId));
   }else if(winner.kind==="screening"){tagScreeningField(winner.elements,fieldId);fields.push(screeningFieldResult(winner,fieldId));}
   else{tagPersonalField(winner.element,fieldId);fields.push(personalFieldResult(winner,fieldId));}
  }
  return{fields,unresolved:[...never,...detectUnresolvedQuestions(root,applicationAnswers)].slice(0,50)};
 }
 attachResume({root=document,payload}={}){return attachResumePayload(payload,root);}
 async fillFields({root=document,fields=[]}={}){
  const personal=fillPersonalFields(fields.filter(field=>PERSONAL_KEY.test(String(field?.key||""))),root);
  const screening=await fillScreeningFields(fields.filter(field=>String(field?.key||"").startsWith("screening.")),root);
  const guide=await fillGuideFields(fields.filter(field=>String(field?.key||"").startsWith("guide.")),root);
  return[...personal,...screening,...guide];
 }
}
