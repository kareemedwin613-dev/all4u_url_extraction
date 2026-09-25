import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { enforceCoverLetter, enforceGenerationContract, MAX_SUMMARY_WORDS, validateTailoringInput, validateTailoringModelOutput, validateTailoringOutput } from "../src/validation.js";
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

test("generation contract enforces bullet limits and format, normalizing only marker variants",()=>{
  const targets=[{sourceExperienceId:"amazon-data-engineer",bullets:5},{sourceExperienceId:"contoso-data-engineer",bullets:2}];
  const role=(tailoredDetails:string)=>({...validOutput,professionalExperience:[validOutput.professionalExperience[0],{sourceExperienceId:"contoso-data-engineer",tailoredDetails}]});
  assert.equal(enforceGenerationContract(role("• Built ingestion.\r\n\r\n*Tuned queries."),targets).professionalExperience[1].tailoredDetails,"- Built ingestion.\n- Tuned queries.");
  assert.equal(enforceGenerationContract(role("- Built ingestion."),targets).professionalExperience[1].tailoredDetails,"- Built ingestion.");
  assert.throws(()=>enforceGenerationContract(role("- One.\n- Two.\n- Three."),targets),/contoso-data-engineer has 3 bullets; the maximum is 2/);
  assert.throws(()=>enforceGenerationContract(role("Data Platform\n- Built ingestion."),targets),/must be a bullet starting with "- "; found "Data Platform"/);
  assert.throws(()=>enforceGenerationContract(role("- Built ingestion.\n-"),targets),/must not be empty/);
  assert.throws(()=>enforceGenerationContract({...validOutput,summary:"First paragraph.\n\nSecond."},targets),/one paragraph/);
  assert.throws(()=>enforceGenerationContract({...validOutput,summary:Array(MAX_SUMMARY_WORDS+1).fill("word").join(" ")},targets),/the maximum is 160/);
  assert.equal(enforceGenerationContract(validOutput,[]).professionalExperience[0].tailoredDetails,validOutput.professionalExperience[0].tailoredDetails);
});

const letterSnapshot={promptId:"11111111-1111-4111-8111-111111111111",name:"Generic",version:3,instructions:"Tailor.",contractVersion:"4",referenceDate:"2026-09-01T00:00:00Z",composedPrompt:"Saved prompt."};
const letterInput=(coverLetter:unknown)=>validateTailoringInput({...fixture,contractVersion:"1.4",promptSnapshot:letterSnapshot,sourceResume:{...fixture.sourceResume,coverLetter}});
const body=["I am applying for the Senior Data Engineer role at Example, where AWS pipeline work matters most.","At Amazon I build Snowflake and Redshift marts and SSIS pipelines processing over 100 million rows per batch.","I would welcome the chance to bring that experience to your data platform team."].join("\n\n");

test("input 1.4 carries the base cover letter and requires a v4 snapshot",()=>{
  assert.equal(letterInput("  Base letter.  ").sourceResume.coverLetter,"Base letter.");
  assert.equal(letterInput(null).sourceResume.coverLetter,null);
  assert.throws(()=>validateTailoringInput({...fixture,contractVersion:"1.4",promptSnapshot:{...letterSnapshot,contractVersion:"3"},sourceResume:{...fixture.sourceResume,coverLetter:null}}),/requires a v4 prompt snapshot/);
  assert.throws(()=>validateTailoringInput({...fixture,contractVersion:"1.3",promptSnapshot:{...letterSnapshot,contractVersion:"3"},sourceResume:{...fixture.sourceResume,coverLetter:null}}),/unsupported fields: coverLetter/);
  assert.throws(()=>validateTailoringInput({...fixture,contractVersion:"1.3",promptSnapshot:letterSnapshot}),/requires a v2 or v3 prompt snapshot/);
});

test("model output must include a cover letter only for input 1.4",()=>{
  const generated={summary:validOutput.summary,professionalExperience:validOutput.professionalExperience,skills:[]};
  assert.equal(validateTailoringModelOutput({...generated,coverLetter:body},letterInput(null)).coverLetter,body);
  assert.throws(()=>validateTailoringModelOutput(generated,letterInput(null)),/coverLetter must contain between 1/);
  assert.throws(()=>validateTailoringModelOutput({...generated,coverLetter:body},input),/unsupported fields: coverLetter/);
});

test("cover letters are body paragraphs only, within length, with no greeting, sign-off, or placeholders",()=>{
  assert.equal(enforceCoverLetter(body.replace("\n\n","\r\n \r\n").replace("most.","most.\n")),body);
  assert.throws(()=>enforceCoverLetter("One paragraph only."),/3 to 4 paragraphs.*found 1/);
  assert.throws(()=>enforceCoverLetter(`Dear Hiring Manager,\n\n${body}`),/must not include a greeting/);
  assert.throws(()=>enforceCoverLetter(`${body}\n\nSincerely,\nAditya`),/sign-off/);
  assert.throws(()=>enforceCoverLetter(body.replace("Example","[Company Name]")),/placeholders; found "\[Company Name\]"/);
  assert.throws(()=>enforceCoverLetter(`${body}\n\n${Array(460).fill("word").join(" ")}`),/the maximum is 450/);
  assert.equal(enforceGenerationContract({...validOutput,coverLetter:body},[]).coverLetter,body);
});
