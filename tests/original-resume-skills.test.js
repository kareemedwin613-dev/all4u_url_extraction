import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {originalResumeSkills,originalSkillsSection,skillsFromResumeSection} from '../extension/shared/skill-detection.js';
import {originalSkillsSection as section} from './fixtures/original-skills.js';

const migration=readFileSync(new URL('../supabase/migrations/202609282200_v3_132_complete_resume_skills.sql',import.meta.url),'utf8');
test('structured skills override stale tags, without losing methods or labels becoming skills',()=>{
  const skills=originalResumeSkills({structured_content:{skills:section},skills:['Machine Learning'],resume_text:'Skills\nJava'});
  assert.equal(skills.length,36);
  assert.ok(skills.includes('U.S. Treasury Markets'));
  assert.ok(skills.includes('Model Productionization'));
  assert.ok(!skills.includes('ML Engineering'));
  assert.ok(!skills.includes('Java'));
  assert.deepEqual(originalResumeSkills({structured_content:{skills:''},skills:['Old']}),[]);
});
test('file section is preferred to tags when structured skills are absent',()=>{
  const resume={resume_text:'Name\nSummary\nSQL experience\nTechnical Skills\nLanguages: C#, Java\nMethods: Quantitative Modeling, CI/CD\nEducation\nA college',skills:['Old']};
  assert.deepEqual(originalResumeSkills(resume),['C#','Java','Quantitative Modeling','CI/CD']);
  assert.equal(originalSkillsSection({resume_text:'No skills section'}),null);
  assert.equal(originalSkillsSection({resume_text:'Skillful engineer'}),null);
  assert.deepEqual(originalResumeSkills({resume_text:'Skills\nLanguages\nPython, Java\nEducation\nCollege'}),['Python','Java']);
  assert.deepEqual(originalResumeSkills({skills:['Legacy','legacy']}),['Legacy']);
});
test('PostgreSQL parser and synchronization agree with the dashboard, without changing tailored or archived originals',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;
    create table resumes(id integer primary key,resume_type text,status text,structured_content jsonb,resume_text text,skills text[]);
    insert into resumes values (1,'ORIGINAL','ACTIVE','{}','',array['Old']), (2,'TAILORED','ACTIVE','{}','',array['Tailored']), (3,'ORIGINAL','ARCHIVED','{}','',array['Archived']);`);
  await db.query('update resumes set structured_content=$1',[{skills:section}]);
  const helpers=migration.slice(0,migration.indexOf('create or replace function public.tailoring_source_input_v112'));
  await db.exec(helpers);
  const get=async id=>(await db.query('select skills from resumes where id=$1',[id])).rows[0].skills;
  assert.deepEqual(await get(1),skillsFromResumeSection(section));
  assert.deepEqual(await get(2),['Tailored']);assert.deepEqual(await get(3),['Archived']);
  for(const sample of [section,'Languages: Python, SQL\nCustom Practices: Scenario Analysis; CI/CD','Cloud Platforms — AWS, Azure','• Model Validation | Technical Research\nAI / ML\nMachine Learning, machine learning','', 'Ｒ, C++, C#, Data Visualization','Python SQL Snowflake dbt Airflow AWS','Python and SQL Optimization']){
    const parsed=(await db.query('select resume_skill_tags_v132($1) skills',[sample])).rows[0].skills;
    assert.deepEqual(parsed,skillsFromResumeSection(sample));
  }
  await db.query('update resumes set structured_content=$1 where id=1',[{skills:'Methods: Experimental Design, Statistical Analysis'}]);
  assert.deepEqual(await get(1),['Experimental Design','Statistical Analysis']);
  await db.exec("update resumes set skills=array['Wrong'] where id=1");
  assert.deepEqual(await get(1),['Experimental Design','Statistical Analysis']);
  await db.exec(`update resumes set structured_content='{"skills":""}' where id=1`);
  assert.deepEqual(await get(1),[]);
  const text='Technical Skills\nPython, Statistical Analysis\nEducation\nNot a skill';
  await db.query("insert into resumes values (4,'ORIGINAL','ACTIVE','{}',$1,array['Old'])",[text]);
  assert.deepEqual(await get(4),originalResumeSkills({resume_text:text}));
  await db.exec(helpers); // repeatable repair
  assert.deepEqual(await get(1),[]);
});
