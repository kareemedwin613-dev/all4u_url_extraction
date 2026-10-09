import{PERSONAL_AUTOFILL_KEYS,PERSONAL_FIELD_ATTRIBUTE,fillPersonalFields,personalFieldCandidates,personalFieldResult,tagPersonalField}from"../autofill/personal-field-adapter.js";
import{fillDraftFields}from"../autofill/draft-fill.js";
import{detectUnresolvedQuestions,fillScreeningFields,screeningFieldCandidates,screeningFieldResult,tagScreeningField}from"../autofill/screening-field-adapter.js";
import{GUIDE_FIELD_ATTRIBUTE,evidenceFieldCandidates,fillGuideFields,guideFieldCandidates,guideFieldResult,selectComboboxValue,tagGuideField}from"../autofill/guide-field-adapter.js";
import{attachCoverLetterPayload,attachResumePayload,detectCoverLetterUploadInputs,detectResumeUploadInputs}from"../autofill/resume-upload-adapter.js";
import{BaseAtsAdapter}from"./base-ats-adapter.js";

const PERSONAL_KEY=/^(candidate|employment|education)\./,ANSWER_KEY=/^(guide|evidence)\./;
const MISSING_ATTRIBUTE="data-resume-jd-missing-value";
// Ties go to the Application Guide, then the Resume's Answer Library, then contact and history fields;
// Yes/No experience answers from the Resume only take controls nothing else claimed.
const PRIORITY={guide:3,screening:2,personal:1,evidence:0};

// Every control is owned by at most one matcher, so one field is never filled twice.
export function arbitrateAutofillCandidates({personal=[],screening=[],guide=[],evidence=[]}){
 const all=[...guide.map(item=>({...item,kind:"guide",elements:item.elements||[item.element]})),...screening.map(item=>({...item,kind:"screening",elements:item.elements||[item.element]})),...personal.map(item=>({...item,kind:"personal",elements:[item.element]})),...evidence.map(item=>({...item,kind:"evidence",elements:item.elements||[item.element]}))]
  .sort((a,b)=>b.confidence-a.confidence||PRIORITY[b.kind]-PRIORITY[a.kind]);
 const claimed=new Set(),usedKeys=new Set(),winners=[];
 for(const candidate of all){
  if(candidate.elements.some(element=>claimed.has(element)))continue;
  // A Resume value or library answer fills one control; guide and evidence answers may repeat.
  if((candidate.kind==="personal"||candidate.kind==="screening")&&usedKeys.has(candidate.key))continue;
  candidate.elements.forEach(element=>claimed.add(element));usedKeys.add(candidate.key);winners.push(candidate);
 }
 return winners;
}

const isCombobox=element=>String(element?.getAttribute?.("role")||"").toLowerCase()==="combobox";

export class GenericHtmlAdapter extends BaseAtsAdapter{
 constructor(options={}){super({id:"generic-html",version:"2.1.0",label:"Generic HTML",tier:"GENERIC",...options});}
 matches(){return true;}
 detectResumeField({root=document}={}){const candidate=detectResumeUploadInputs(root)[0];return candidate?{confidence:Math.min(100,candidate.score),controlType:"file"}:null;}
 detectFields({root=document,availableKeys=[],applicationAnswers=[],guideEntries=[],personalWordings={}}={}){
  const winners=arbitrateAutofillCandidates({personal:personalFieldCandidates(root,availableKeys,personalWordings),screening:screeningFieldCandidates(root,applicationAnswers),guide:guideFieldCandidates(root,guideEntries),evidence:evidenceFieldCandidates(root)});
  const stamp=Date.now().toString(36),fields=[],never=[],claimed=new Set();let sequence=0;
  for(const winner of winners){
   const fieldId=`${winner.kind}_${stamp}_${sequence++}`;
   winner.elements.forEach(element=>claimed.add(element));
   if(winner.kind==="guide"||winner.kind==="evidence"){
    tagGuideField(winner.elements,fieldId);
    // A person answers NEVER questions; claiming them keeps every other matcher away.
    if(winner.mode==="NEVER"){never.push({question:winner.label,normalizedQuestion:winner.label.toLowerCase(),controlType:winner.controlType,reason:"REVIEW_REQUIRED",guideEntryId:winner.guideEntryId,suggestions:[]});continue;}
    fields.push(guideFieldResult(winner,fieldId));
   }else if(winner.kind==="screening"){tagScreeningField(winner.elements,fieldId);fields.push(screeningFieldResult(winner,fieldId));}
   else{tagPersonalField(winner.element,fieldId);fields.push(personalFieldResult(winner,fieldId));}
  }
  // Contact fields the page asks for but this Resume has no value for (e.g. no LinkedIn URL).
  const available=new Set(availableKeys),missing=[];
  for(const candidate of personalFieldCandidates(root,PERSONAL_AUTOFILL_KEYS)){
   // A missing cover letter belongs to the Application, not the Resume, so it gets no Resume notice.
   if(available.has(candidate.key)||claimed.has(candidate.element)||candidate.confidence<90||candidate.key==="candidate.coverLetter")continue;
   claimed.add(candidate.element);candidate.element.setAttribute(MISSING_ATTRIBUTE,candidate.key);
   missing.push({question:candidate.label.slice(0,300),normalizedQuestion:candidate.label.toLowerCase().slice(0,300),controlType:candidate.controlType,reason:"RESUME_VALUE_MISSING",missingKey:candidate.key,suggestions:[]});
  }
  return{fields,unresolved:[...missing,...never,...detectUnresolvedQuestions(root,applicationAnswers)].slice(0,50)};
 }
 attachResume({root=document,payload}={}){return attachResumePayload(payload,root);}
 detectCoverLetterField({root=document}={}){const candidate=detectCoverLetterUploadInputs(root)[0];return candidate?{confidence:Math.min(100,candidate.score),controlType:"file"}:null;}
 attachCoverLetter({root=document,payload}={}){return attachCoverLetterPayload(payload,root);}
 async fillFields({root=document,fields=[]}={}){
  const personalRequests=fields.filter(field=>PERSONAL_KEY.test(String(field?.key||""))),element=field=>root.querySelector?.(`[${PERSONAL_FIELD_ATTRIBUTE}="${field.fieldId}"]`);
  // Search dropdowns (react-select "Country") are chosen from their list, never typed into.
  const comboRequests=personalRequests.filter(field=>isCombobox(element(field)));
  const personal=fillPersonalFields(personalRequests.filter(field=>!comboRequests.includes(field)),root);
  for(const field of comboRequests){
   const code=String(field.value??"").trim()?await selectComboboxValue(element(field),field.value,root):"VALUE_UNAVAILABLE";
   personal.push({fieldId:field.fieldId,key:field.key,status:code==="FIELD_VERIFIED"?"VERIFIED":code==="VALUE_UNAVAILABLE"?"SKIPPED":"FAILED",code});
  }
  const screening=await fillScreeningFields(fields.filter(field=>String(field?.key||"").startsWith("screening.")),root);
  const answers=await fillGuideFields(fields.filter(field=>ANSWER_KEY.test(String(field?.key||""))),root);
  // AI-drafted answers for open-ended questions, into the boxes the scan referenced.
  const drafts=fillDraftFields(fields.filter(field=>String(field?.key||"").startsWith("draft.")),root);
  return[...personal,...screening,...answers,...drafts];
 }
}

export{GUIDE_FIELD_ATTRIBUTE,MISSING_ATTRIBUTE};
