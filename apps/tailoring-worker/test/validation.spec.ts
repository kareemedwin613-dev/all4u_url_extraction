import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateTailoringInput, validateTailoringOutput } from "../src/validation.js";
import { compliantOutput, validationDate } from "./compliant-output.js";

const fixturePath=fileURLToPath(new URL("../fixtures/application-19.json",import.meta.url));
const fixture=JSON.parse(await readFile(fixturePath,"utf8")).applications[0];
const input=validateTailoringInput(fixture);
const validOutput=compliantOutput(input);

test("accepts a sanitized ORIGINAL Resume fixture without protected metadata",()=>{
  assert.equal(input.sourceResume.resumeType,"ORIGINAL");
  assert.equal(input.sourceResume.resumeNumber,142);
  assert.deepEqual(Object.keys(input.sourceResume).sort(),["id","professionalExperience","resumeNumber","resumeType","skills","summary"].sort());
});

test("rejects tailored sources and protected or unknown input fields",()=>{
  assert.throws(()=>validateTailoringInput({...fixture,sourceResume:{...fixture.sourceResume,resumeType:"TAILORED"}}),/Only an ORIGINAL Resume/);
  assert.throws(()=>validateTailoringInput({...fixture,sourceResume:{...fixture.sourceResume,candidateEmail:"private@example.com"}}),/unsupported fields: candidateEmail/);
});

test("accepts the mutable Resume sections, grouped presentation, and audit notes",()=>{
  const result=validateTailoringOutput(validOutput,input,validationDate);
  assert.equal(result.professionalExperience.length,input.sourceResume.professionalExperience.length);
  assert.deepEqual(result.skills,validOutput.skills);
  assert.deepEqual(result.skillGroups,validOutput.skillGroups);
});

test("allows freely generated skills but rejects unknown experiences, missing experiences, and protected output",()=>{
  assert.deepEqual(validateTailoringOutput({...validOutput,skills:["Kubernetes","Platform Engineering"]},input,validationDate).skills,["Kubernetes","Platform Engineering"]);
  assert.throws(()=>validateTailoringOutput({...validOutput,professionalExperience:[{sourceExperienceId:"invented",tailoredDetails:"Invented."},validOutput.professionalExperience[1]]},input,validationDate),/Unknown source experience ID/);
  assert.throws(()=>validateTailoringOutput({...validOutput,professionalExperience:validOutput.professionalExperience.slice(0,1)},input,validationDate),/exactly one tailored entry/);
  assert.throws(()=>validateTailoringOutput({...validOutput,candidateName:"Changed Name"},input,validationDate),/unsupported fields: candidateName/);
});

test("skill groups use bounded approved upper-level categories without adding factual gates",()=>{
  assert.throws(()=>validateTailoringOutput({...validOutput,skillGroups:[{name:"Miscellaneous",skills:["Python"]}]},input,validationDate),/approved category/);
  assert.throws(()=>validateTailoringOutput({...validOutput,skillGroups:[{name:"AI \/ ML",skills:[]}]},input,validationDate),/must not be empty/);
  assert.doesNotThrow(()=>validateTailoringOutput({...validOutput,skillGroups:[{name:"AI / ML",skills:["Invented Skill"]}]},input,validationDate));
});

test("limits the generated flat and grouped Skills sections to 80 total items",()=>{
  const tooMany=Array.from({length:81},(_,index)=>`Skill ${index+1}`);
  assert.throws(()=>validateTailoringOutput({...validOutput,skills:tooMany},input,validationDate),/at most 80 items/);
  assert.throws(()=>validateTailoringOutput({...validOutput,skillGroups:[{name:"AI / ML",skills:tooMany.slice(0,41)},{name:"Additional Skills",skills:tooMany.slice(41)}]},input,validationDate),/at most 80 skills in total/);
});

test("rejects schema-valid refusals without reconciling qualitative requirements",()=>{
  assert.throws(()=>validateTailoringOutput({...validOutput,summary:"Unable to tailor without the input file."},input,validationDate),/refusal or placeholder/);
  assert.deepEqual(validateTailoringOutput({...validOutput,unsupportedRequirements:[]},input,validationDate).unsupportedRequirements,[]);
  assert.deepEqual(validateTailoringOutput({...validOutput,skills:[]},input,validationDate).skills,[]);
});

test("allows copied wording, arbitrary bullet counts, repeated verbs, projects, and outcomes",()=>{
  const copied={...validOutput,professionalExperience:validOutput.professionalExperience.map((item,index)=>({...item,tailoredDetails:index?item.tailoredDetails:input.sourceResume.professionalExperience[index].details.split(". ").map((sentence:string)=>`- ${sentence.replace(/\.$/,"")}.`).join("\n")}))};
  assert.equal(validateTailoringOutput(copied,input,validationDate).professionalExperience[0].tailoredDetails,copied.professionalExperience[0].tailoredDetails);
  const oneSentenceEdit={...validOutput,professionalExperience:validOutput.professionalExperience.map((item,index)=>index?item:{...item,tailoredDetails:item.tailoredDetails.replace(item.tailoredDetails.split("\n")[0],"- Reframed a reporting platform by migrating SQL Server marts to Snowflake and Redshift.")})};
  assert.doesNotThrow(()=>validateTailoringOutput(oneSentenceEdit,input,validationDate));
  const tooShort={...validOutput,professionalExperience:validOutput.professionalExperience.map((item,index)=>index?item:{...item,tailoredDetails:item.tailoredDetails.split("\n").slice(0,4).join("\n")})};
  assert.doesNotThrow(()=>validateTailoringOutput(tooShort,input,validationDate));
  const repeated={...validOutput,professionalExperience:validOutput.professionalExperience.map((item,index)=>index?{...item,tailoredDetails:item.tailoredDetails.replace("- Delivered ","- Modernized ")}:item)};
  assert.doesNotThrow(()=>validateTailoringOutput(repeated,input,validationDate));
});

test("keeps structural validation weak; ATS skill completion happens after validation",()=>{
  const inventedMetric={...validOutput,professionalExperience:validOutput.professionalExperience.map((item,index)=>index?item:{...item,tailoredDetails:item.tailoredDetails.replace("platform delivery.","platform delivery with 99% uptime.")})};
  assert.doesNotThrow(()=>validateTailoringOutput(inventedMetric,input,validationDate));
  const missingAws={...validOutput,professionalExperience:validOutput.professionalExperience.map((item,index)=>index?item:{...item,tailoredDetails:item.tailoredDetails.replace("AWS event streams","cloud event streams")})};
  assert.doesNotThrow(()=>validateTailoringOutput(missingAws,input,validationDate));
  assert.doesNotThrow(()=>validateTailoringOutput({...validOutput,skills:validOutput.skills.slice(0,-1)},input,validationDate));
  assert.doesNotThrow(()=>validateTailoringOutput({...validOutput,summary:`${validOutput.summary} Improved uptime by 99%.`},input,validationDate));
});

test("allows short summaries, reordered skills, and ambiguous dates without warnings",()=>{
  assert.equal(validateTailoringOutput({...validOutput,summary:"Short tailored summary."},input,validationDate).summary,"Short tailored summary.");
  const reorderedSkills={...validOutput,skills:["Python","SQL","Snowflake","AWS","Data Quality","SSIS","Jenkins","GitHub Actions"]};
  assert.deepEqual(validateTailoringOutput(reorderedSkills,input,validationDate).skills,reorderedSkills.skills);
  const ambiguousInput={...input,sourceResume:{...input.sourceResume,professionalExperience:input.sourceResume.professionalExperience.map((item,index)=>index?item:{...item,startDate:"2022"})}},ambiguousOutput={...validOutput,professionalExperience:validOutput.professionalExperience.map((item,index)=>index?item:{...item,tailoredDetails:item.tailoredDetails.split("\n").slice(0,4).join("\n")})};
  assert.doesNotThrow(()=>validateTailoringOutput({...ambiguousOutput,warnings:[]},ambiguousInput,validationDate));
});
