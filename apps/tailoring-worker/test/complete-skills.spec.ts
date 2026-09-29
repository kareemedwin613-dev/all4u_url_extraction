import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {validateTailoringInput,validateTailoringModelOutput} from '../src/validation.js';
import {runTailoringProof,rankedTailoredSkills} from '../src/codex-runner.js';
import {reconcileSkillGroups} from '../src/skill-groups.js';
import {tailoringRoleTargets} from '../src/prompt.js';

const fixture=JSON.parse(await readFile(new URL('../fixtures/application-19.json',import.meta.url),'utf8')).applications[0];
const input=validateTailoringInput({...fixture,contractVersion:'1.4',sourceResume:{...fixture.sourceResume,
  skills:['Machine Learning','Model Validation','Statistical Analysis','Quantitative Research','Stakeholder Communication','Fixed Income Markets'],
  skillsSection:'AI / ML: Machine Learning, Model Validation\nMethods: Statistical Analysis, Quantitative Research\nCapabilities: Stakeholder Communication, Fixed Income Markets',
  coverLetter:null,professionalExperience:[{...fixture.sourceResume.professionalExperience[0],startDate:'2025-01',endDate:'2026-01'}]},
  promptSnapshot:{promptId:'11111111-1111-4111-8111-111111111111',name:'Test',version:1,contractVersion:'6',referenceDate:'2026-09-28T00:00:00Z',instructions:'Test instructions.',composedPrompt:'Saved v6 prompt.'}});
const ranked=['Model Validation','Statistical Analysis','Machine Learning','Quantitative Research','Stakeholder Communication','Fixed Income Markets'];
const modelOutput={summary:'Data professional applying analytical methods.',skills:ranked,
  professionalExperience:[{sourceExperienceId:input.sourceResume.professionalExperience[0].id,tailoredDetails:'- Evaluated forecasting models against reference datasets.\n- Designed statistical experiments for operational decisions.\n- Communicated research conclusions to business stakeholders.\n- Documented data preparation procedures for analysts.'}],
  coverLetter:'I am applying for the data role with experience in analytical work.\n\nMy work connects research methods to operational decisions.\n\nI welcome a conversation about your team.'};

test('v6 accepts complete skills with methods, enforces 80 maximum, and retains v5 role ranges',()=>{
  const skills=Array.from({length:80},(_,i)=>`Capability ${i}`);
  assert.equal(validateTailoringModelOutput({...modelOutput,skills},input).skills.length,80);
  assert.throws(()=>validateTailoringModelOutput({...modelOutput,skills:[...skills,'extra']},input),/at most 80/);
  assert.throws(()=>validateTailoringModelOutput({...modelOutput,skills:[]},input),/complete ranked section/);
  assert.deepEqual(tailoringRoleTargets(input),[{sourceExperienceId:input.sourceResume.professionalExperience[0].id,projects:2,minBullets:4,maxBullets:6}]);
  assert.deepEqual(rankedTailoredSkills(['Model Validation','model validation','  Statistical   Analysis ']),['Model Validation','Statistical Analysis']);
});
test('v6 worker preserves model ranking and all capabilities without merging stale tags or filtering on literal role text',async t=>{
  const dir=await mkdtemp(resolve(tmpdir(),'complete-skills-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const preview=await runTailoringProof(input,{outputPath:resolve(dir,'preview.json'),execute:async request=>{
    const schema=JSON.parse(await readFile(request.schemaPath,'utf8'));
    assert.equal(schema.properties.skills.maxItems,80);assert.equal(schema.properties.skills.minItems,1);
    assert.match(schema.properties.skills.description,/complete ranked/);
    assert.deepEqual(schema.required,['summary','professionalExperience','skills','coverLetter']);
    const context=JSON.parse(await readFile(resolve(request.workspace,'input.json'),'utf8'));
    assert.equal(context.sourceResume.skillsSection,input.sourceResume.skillsSection);
    assert.deepEqual(context.sourceResume.skills,input.sourceResume.skills);
    assert.equal(request.prompt,'Saved v6 prompt.');
    await writeFile(request.outputPath,JSON.stringify(modelOutput));return{stdout:'',stderr:''};
  }});
  assert.deepEqual(preview.result.skills,ranked);
  assert.deepEqual(preview.result.skillGroups.map(g=>g.name),['AI / ML','Research & Analytics','Tools & Delivery','Domain Knowledge']);
  assert.deepEqual(new Set(preview.result.skillGroups.flatMap(g=>g.skills)),new Set(ranked));
  assert.equal(preview.generationAttempts,1);
});
test('grouping gives each method or capability exactly one category',()=>{
  const groups=reconcileSkillGroups(['Predictive Modeling','Research Publications','Decision Modeling','Agency MBS','Machine Learning Workflows','Model Productionization']);
  assert.ok(!groups.some(g=>g.name==='Additional Skills'));
  assert.equal(groups.flatMap(g=>g.skills).length,6);
});
