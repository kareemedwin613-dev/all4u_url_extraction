import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { detectScreeningFields, detectUnresolvedQuestions, fillScreeningFields, normalizeApplicationQuestion, sanitizeScreeningAnswers, scoreQuestionPattern } from "../extension/autofill/screening-field-adapter.js";
import { autofillValue, autofillValueSource,displayAutofillValue, salaryMidpoint,screeningDefinitions, selectedScreeningAnswersUnchanged } from "../extension/autofill/autofill-context.js";

function field({ tag="INPUT",type="text",name="",id="",label="",legend="",value="",options=[] }={}) {
  const attributes=new Map(),events=[];
  const element={tagName:tag,type,name,id,value,options,selectedIndex:-1,disabled:false,readOnly:false,checked:false,required:false,labels:label?[{textContent:label}]:[],parentElement:null,previousElementSibling:null,
    closest:(selector)=>selector==="fieldset"&&legend?{querySelector:()=>({textContent:legend})}:null,
    getAttribute:(key)=>attributes.get(key)||"",setAttribute:(key,next)=>attributes.set(key,next),hasAttribute:(key)=>attributes.has(key),
    dispatchEvent:(event)=>{events.push(event.type);return true;},click(){this.checked=true;},events};
  return element;
}
function option(value,text=value){return{value,textContent:text,labels:[],getAttribute:(key)=>key==="value"?value:"",closest:()=>null};}
function root(elements){return{querySelectorAll:()=>elements};}
const approved=(answerKey,answerType,answerValue,questionPatterns=[])=>({answerKey,answerType,answerValue,questionPatterns,reviewedAt:"2026-07-31T01:00:00Z"});

test("v0.9.1 detects high-confidence yes/no, date, numeric, select, and short-text screening controls",()=>{
  const sponsorshipYes=field({type:"radio",name:"sponsor",label:"Yes",legend:"Will you require sponsorship?",value:"yes"});
  const sponsorshipNo=field({type:"radio",name:"sponsor",label:"No",legend:"Will you require sponsorship?",value:"no"});
  const date=field({type:"date",label:"Available start date"});
  const years=field({type:"number",label:"How many years of experience do you have?"});
  const arrangement=field({tag:"SELECT",label:"Preferred work arrangement",options:[option("REMOTE","Fully remote"),option("HYBRID","Hybrid")]});
  const salary=field({label:"Desired salary"});
  const fields=detectScreeningFields(root([sponsorshipYes,sponsorshipNo,date,years,arrangement,salary]),[
    approved("requires_sponsorship","BOOLEAN",false),approved("available_start_date","DATE","2026-08-01"),
    approved("years_of_experience","NUMBER",12),approved("remote_work_preference","SINGLE_SELECT","REMOTE"),
    approved("desired_salary","TEXT","120000"),
  ]);
  assert.deepEqual(fields.map((item)=>item.answerKey).sort(),["available_start_date","desired_salary","remote_work_preference","requires_sponsorship","years_of_experience"]);
  assert.ok(fields.every((item)=>item.readiness==="READY"));
});

test("v0.9.1 refuses sensitive, attestation, long-form, and unsupported controls",()=>{
  const sensitive=field({tag:"SELECT",label:"What is your veteran status?",options:[option("yes"),option("no")]});
  const attestation=field({tag:"SELECT",label:"I certify this application is true",options:[option("yes"),option("no")]});
  const essay=field({label:"Explain why you want this job"});
  const checkbox=field({type:"checkbox",label:"Are you authorized to work?"});
  const answers=[approved("authorized_to_work","BOOLEAN",true,["What is your veteran status?","I certify this application is true","Explain why you want this job"] )];
  assert.deepEqual(detectScreeningFields(root([sensitive,attestation,essay,checkbox]),answers),[]);
  assert.deepEqual(sanitizeScreeningAnswers(answers)[0].questionPatterns,[]);
});

test("v0.9.1 fills radio, select, date, number, and short text values and verifies every result",async()=>{
  const yes=field({type:"radio",name:"auth",label:"Yes",legend:"Are you authorized to work?",value:"yes"});
  const no=field({type:"radio",name:"auth",label:"No",legend:"Are you authorized to work?",value:"no"});
  const arrangement=field({tag:"SELECT",label:"Preferred work arrangement",options:[option("REMOTE","Fully remote"),option("HYBRID","Hybrid")]});
  const date=field({type:"date",label:"Available start date"});
  const years=field({type:"number",label:"Years of experience"});
  const salary=field({label:"Desired salary"});
  const answers=[approved("authorized_to_work","BOOLEAN",true),approved("remote_work_preference","SINGLE_SELECT","REMOTE"),approved("available_start_date","DATE","2026-08-01"),approved("years_of_experience","NUMBER",12),approved("desired_salary","TEXT","120000")];
  const page=root([yes,no,arrangement,date,years,salary]),detected=detectScreeningFields(page,answers);
  const requests=detected.map((item)=>({...item,value:answers.find((answer)=>answer.answerKey===item.answerKey).answerValue}));
  const results=await fillScreeningFields(requests,page);
  assert.ok(results.every((item)=>item.status==="VERIFIED"));
  assert.equal(yes.checked,true);assert.equal(arrangement.value,"REMOTE");assert.equal(date.value,"2026-08-01");assert.equal(years.value,"12");assert.equal(salary.value,"120000");
  assert.ok([yes,arrangement,date,years,salary].every((item)=>item.events.includes("change")));
});

test("v0.9.1 recognizes Greenhouse React combobox wording for authorization, sponsorship, and relocation",()=>{
  const makeCombobox=(label)=>{
    const wrapper={querySelector:(selector)=>selector.includes("label")?{textContent:label}:null};
    const item=field({label:""});
    item.getAttribute=(key)=>key==="role"?"combobox":"";
    item.closest=(selector)=>selector.includes("field-wrapper")?wrapper:null;
    return item;
  };
  const authorization=makeCombobox("Do you have unlimited and unrestricted authorization to work in the United States?");
  const sponsorship=makeCombobox("Will you now or in the future require company assistance or sponsorship to work lawfully?");
  const relocation=makeCombobox("Are you willing and able to relocate to one of the eligible states?");
  const fields=detectScreeningFields(root([authorization,sponsorship,relocation]),[
    approved("authorized_to_work","BOOLEAN",true),approved("requires_sponsorship","BOOLEAN",false),approved("willing_to_relocate","BOOLEAN",true),
  ]);
  assert.deepEqual(fields.map(item=>item.answerKey).sort(),["authorized_to_work","requires_sponsorship","willing_to_relocate"]);
  assert.ok(fields.every(item=>item.controlType==="combobox"));
});

test("v0.9.1 detects voluntary self-identification answers for automatic fill",()=>{
  const gender=field({tag:"SELECT",label:"Gender",options:[option("Male"),option("Female")]}),race=field({tag:"SELECT",label:"Race and ethnicity",options:[option("White (Not Hispanic or Latino)")]}),veteran=field({tag:"SELECT",label:"Veteran status",options:[option("I am not a veteran")]});
  const fields=detectScreeningFields(root([gender,race,veteran]),[approved("gender_identity","TEXT","Male"),approved("race_ethnicity","TEXT","White (Not Hispanic or Latino)"),approved("veteran_status","TEXT","I am not a veteran")]);
  assert.deepEqual(fields.map(item=>item.answerKey).sort(),["gender_identity","race_ethnicity","veteran_status"]);
  assert.ok(fields.every(item=>!item.requiresReview&&item.readiness==="READY"));
});

test("v0.9.1 sanitizes answer values and detects changed approved snapshots before fill",()=>{
  const before={applicationAnswers:[approved("requires_sponsorship","BOOLEAN",false,["Require sponsorship?"])]};
  const unchanged={applicationAnswers:[approved("requires_sponsorship","BOOLEAN",false,["Require sponsorship?"])]};
  const changed={applicationAnswers:[approved("requires_sponsorship","BOOLEAN",true,["Require sponsorship?"])]};
  const fields=[{key:"screening.requires_sponsorship",answerKey:"requires_sponsorship"}];
  assert.equal(selectedScreeningAnswersUnchanged(before,unchanged,fields),true);
  assert.equal(selectedScreeningAnswersUnchanged(before,changed,fields),false);
  assert.deepEqual(screeningDefinitions(before),[{answerKey:"requires_sponsorship",answerType:"BOOLEAN",questionPatterns:["Require sponsorship?"]}]);
  assert.equal(autofillValue(before,fields[0]),false);assert.equal(displayAutofillValue(false),"No");
  assert.deepEqual(sanitizeScreeningAnswers([{answerKey:"years_of_experience",answerType:"NUMBER",answerValue:"twelve"}],{includeValues:true}),[]);
});

test("v0.9.1 recommends the JD salary midpoint and falls back to the verified manual answer",()=>{
 const field={key:"screening.desired_salary",answerKey:"desired_salary"},saved=approved("desired_salary","TEXT","110000");
 const ranged={job:{salaryMin:120000,salaryMax:140000,salaryCurrency:"USD",salaryPeriod:"YEAR"},applicationAnswers:[saved]};
 const fallback={job:{salaryMin:null,salaryMax:null},applicationAnswers:[saved]};
 const derivedOnly={job:{salaryMin:100000,salaryMax:120000},applicationAnswers:[]};
 assert.equal(salaryMidpoint(ranged.job),"130000");assert.equal(autofillValue(ranged,field),"130000");assert.equal(autofillValueSource(ranged,field),"JD salary midpoint");
 assert.equal(autofillValue(fallback,field),"110000");assert.equal(autofillValueSource(fallback,field),"Verified Answer Library");
 assert.equal(screeningDefinitions(derivedOnly).find(item=>item.answerKey==="desired_salary").answerType,"TEXT");
});

test("v0.9.1 never submits and does not expose values during field detection",async()=>{
  const sources=await Promise.all(["../extension/autofill/screening-field-adapter.js","../extension/content/personal-autofill.js","../extension/background/service-worker.js","../extension/sidepanel/App.jsx"].map((path)=>readFile(new URL(path,import.meta.url),"utf8")));
  const text=sources.join("\n");
  assert.doesNotMatch(text,/requestSubmit\(|\.submit\(|submitButton\.click\(/i);
  assert.match(text,/applicationAnswers:\s*screeningDefinitions\(autofillContext\)/);
  assert.doesNotMatch(text,/applicationAnswers:autofillContext\.applicationAnswers/);
});

test("v0.9.2 normalizes ordinary wording differences and conservatively fuzzy-matches known questions",()=>{
  assert.equal(normalizeApplicationQuestion("  Are YOU—permitted to work? "),"are you permitted to work");
  assert.ok(scoreQuestionPattern("Are you presently permitted by law to work in the US?","permitted to work")>=86);
  const authorization=field({tag:"SELECT",label:"Are you presently permitted by law to work in the United States?",options:[option("yes"),option("no")]});
  assert.equal(detectScreeningFields(root([authorization]),[approved("authorized_to_work","BOOLEAN",true)])[0].answerKey,"authorized_to_work");
});

test("v0.9.2 reports unmatched and protected questions without duplicating matched fields",()=>{
  const known=field({tag:"SELECT",label:"Are you willing to relocate?",options:[option("yes"),option("no")]}),unknown=field({label:"What is your preferred office location?"}),attestation=field({tag:"SELECT",label:"I certify that all information is true",options:[option("yes"),option("no")]});
  const answers=[approved("willing_to_relocate","BOOLEAN",true)];
  assert.equal(detectScreeningFields(root([known,unknown,attestation]),answers).length,1);
  const unresolved=detectUnresolvedQuestions(root([known,unknown,attestation]),answers);
  assert.deepEqual(unresolved.map(item=>item.reason).sort(),["NO_MATCHING_ANSWER","REVIEW_REQUIRED"]);
  assert.ok(unresolved.every(item=>item.question!=="Are you willing to relocate?"));
});
