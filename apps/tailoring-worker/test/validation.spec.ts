import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateTailoringInput, validateTailoringOutput } from "../src/validation.js";

const fixturePath=fileURLToPath(new URL("../fixtures/application-19.json",import.meta.url));
const fixture=JSON.parse(await readFile(fixturePath,"utf8")).applications[0];
const input=validateTailoringInput(fixture);
const validOutput={
  summary:"Senior Data Engineer building reliable Python, SQL, Snowflake, and AWS data platforms with automated data-quality controls.",
  professionalExperience:input.sourceResume.professionalExperience.map(item=>({sourceExperienceId:item.id,tailoredDetails:item.details})),
  skills:["Python","SQL","Snowflake","AWS","Data Quality","Jenkins","GitHub Actions"],
  changeSummary:["Prioritized cloud data-platform experience."],unsupportedRequirements:["Kubernetes"],warnings:[]
};

test("accepts a sanitized ORIGINAL Resume fixture without protected metadata",()=>{
  assert.equal(input.sourceResume.resumeType,"ORIGINAL");
  assert.equal(input.sourceResume.resumeNumber,142);
  assert.deepEqual(Object.keys(input.sourceResume).sort(),["id","professionalExperience","resumeNumber","resumeType","skills","summary"].sort());
});

test("rejects tailored sources and protected or unknown input fields",()=>{
  assert.throws(()=>validateTailoringInput({...fixture,sourceResume:{...fixture.sourceResume,resumeType:"TAILORED"}}),/Only an ORIGINAL Resume/);
  assert.throws(()=>validateTailoringInput({...fixture,sourceResume:{...fixture.sourceResume,candidateEmail:"private@example.com"}}),/unsupported fields: candidateEmail/);
});

test("accepts only the three mutable Resume sections and audit notes",()=>{
  const result=validateTailoringOutput(validOutput,input);
  assert.equal(result.professionalExperience.length,input.sourceResume.professionalExperience.length);
  assert.deepEqual(result.skills,validOutput.skills);
});

test("rejects invented skills, unknown experiences, missing experiences, and protected output",()=>{
  assert.throws(()=>validateTailoringOutput({...validOutput,skills:[...validOutput.skills,"Kubernetes"]},input),/not present in the source Resume: Kubernetes/);
  assert.throws(()=>validateTailoringOutput({...validOutput,professionalExperience:[{sourceExperienceId:"invented",tailoredDetails:"Invented."},validOutput.professionalExperience[1]]},input),/Unknown source experience ID/);
  assert.throws(()=>validateTailoringOutput({...validOutput,professionalExperience:validOutput.professionalExperience.slice(0,1)},input),/exactly one tailored entry/);
  assert.throws(()=>validateTailoringOutput({...validOutput,candidateName:"Changed Name"},input),/unsupported fields: candidateName/);
});

test("rejects schema-valid refusals and deterministically reconciles unsupported JD skills",()=>{
  assert.throws(()=>validateTailoringOutput({...validOutput,summary:"Unable to tailor without the input file."},input),/refusal or placeholder/);
  assert.deepEqual(validateTailoringOutput({...validOutput,unsupportedRequirements:[]},input).unsupportedRequirements,["Kubernetes"]);
  assert.throws(()=>validateTailoringOutput({...validOutput,skills:[]},input),/omitted every source skill/);
});
