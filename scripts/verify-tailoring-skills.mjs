// Creates a FRESH job in an isolated PostgreSQL database, never in Supabase.
// --live explicitly enables one real worker run (and its existing single repair).
// Build API + worker first. No production credentials or files are read.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {originalSkillsSection} from '../tests/fixtures/original-skills.js';
import {runTailoringProof} from '../apps/tailoring-worker/dist/codex-runner.js';
import {renderTailoredResumePdf} from '../apps/api/dist/platform/tailored-resume-pdf.renderer.js';
import {REFERENCE_RESUME_LAYOUTS} from '../apps/api/dist/platform/reference-resume-templates.js';

const root=fileURLToPath(new URL('../',import.meta.url)),live=process.argv.includes('--live');
const ids={application:randomUUID(),resume:randomUUID(),jd:randomUUID(),job:randomUUID(),prompt:randomUUID()};
const directory=resolve(root,'apps/tailoring-worker/artifacts',`skills-v6-${ids.job}`);
const db=new PGlite();
const migration=name=>readFile(resolve(root,'supabase/migrations',name),'utf8');
const source={summary:'SYNTHETIC TEST DATA: Research professional applying machine learning, statistical analysis, and quantitative modeling to financial market data.',skills:originalSkillsSection,
  professional_experience:[{id:'research-role',company:'Example Research',job_title:'Research Engineer',location:'Remote',start_date:{year:2025,month:1},end_date:{year:2026,month:1},is_current:false,
    experience_details:'Developed and evaluated predictive models using feature development, reproducible modeling, model training and validation. Conducted quantitative research on fixed income and U.S. Treasury markets. Applied scenario and sensitivity analysis to decision models. Communicated analytical findings through data visualization, research publications and stakeholder presentations.'}],education:[],certifications:[]};
let progress;
try{
  await db.exec(`create role anon;create role authenticated;
    create table resumes(id uuid primary key,resume_type text,status text,resume_number integer,skills text[],structured_content jsonb,resume_text text,cover_letter_text text);
    create table job_descriptions(id uuid primary key,status text,company text,job_title text,description_text text,detected_skills text[]);
    create table applications(id uuid primary key,resume_id uuid,job_description_id uuid,application_number integer);
    create table tailoring_jobs(id uuid primary key,application_id uuid,resume_id uuid,job_description_id uuid,prompt_provenance jsonb);
    create table tailoring_prompt_job_snapshots(job_id uuid primary key,input jsonb);
    create function select_tailoring_prompt_v1(uuid) returns jsonb language sql as $$select current_setting('test.selection')::jsonb$$;
  `);
  await db.query("insert into resumes values($1,'ORIGINAL','ACTIVE',1,array['Machine Learning'],$2,'Synthetic file text',null)",[ids.resume,source]);
  await db.query("insert into job_descriptions values($1,'ACTIVE','Example Analytics','Machine Learning Research Engineer',$2,$3)",[
    ids.jd,'Evaluate predictive models for financial-market research. Apply statistical analysis, quantitative research, feature development, model validation, and reproducible modeling. Communicate research findings with stakeholders through data visualization. Use scenario analysis and sensitivity analysis to inform decisions. Experience in fixed income and market structure analysis is valuable.',
    ['Machine Learning','Model Validation','Statistical Analysis','Data Visualization','Fixed Income Markets']]);
  await db.query('insert into applications values($1,$2,$3,1)',[ids.application,ids.resume,ids.jd]);
  await db.exec(await migration('202609282200_v3_132_complete_resume_skills.sql'));
  const snapshots=await migration('202609241010_v3_112_tailoring_prompt_snapshots.sql');
  // Exercise the same capture trigger that production uses, not a handwritten prompt.
  const start=snapshots.indexOf('create function public.snapshot_tailoring_prompt_v112()');
  await db.exec(snapshots.slice(start,snapshots.indexOf('-- Preserve the legacy eligibility check',start)));
  await db.query("select set_config('test.selection',$1,false)",[JSON.stringify({promptId:ids.prompt,name:'Synthetic skills verification',version:1,instructions:'This is synthetic QA data. Prefix the summary with SYNTHETIC TEST DATA. Write a concise, role-relevant resume using the supplied source. Do not invent metrics or technologies.'})]);
  await db.query('insert into tailoring_jobs(id,application_id,resume_id,job_description_id) values($1,$2,$3,$4)',[ids.job,ids.application,ids.resume,ids.jd]);
  const input=(await db.query('select input from tailoring_prompt_job_snapshots where job_id=$1',[ids.job])).rows[0].input;
  assert.equal(input.promptSnapshot.contractVersion,'6');assert.equal(input.sourceResume.skills.length,36);
  assert.equal(input.sourceResume.skillsSection,originalSkillsSection);
  await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,'fixture.json'),JSON.stringify({applications:[input]},null,2),{flag:'wx'});
  console.log(JSON.stringify({event:'skills.proof.created',isolated:true,jobId:ids.job,sourceSkills:36,contract:'6',live}));
  if(live){
    const started=Date.now();
    progress=setInterval(()=>console.log(JSON.stringify({event:'skills.proof.running',elapsedSeconds:Math.round((Date.now()-started)/1000)})),15000);
    const preview=await runTailoringProof(input,{outputPath:resolve(directory,'preview.json'),schemaPath:resolve(root,'apps/tailoring-worker/schemas/tailoring-output.schema.json')});
    clearInterval(progress);
    assert.ok(preview.result.skills.length>1&&preview.result.skills.length<=80);
    assert.ok(preview.result.skillGroups.length>=3);
    assert.ok(preview.result.skills.some(skill=>/statistical|quantitative|research|scenario/i.test(skill)));
    const pdfs=[];
    for(const layout of REFERENCE_RESUME_LAYOUTS){
      const bytes=await renderTailoredResumePdf({applicationNumber:1,renderTemplateKey:layout.key,renderFormat:'PDF',candidate:{name:'Synthetic QA Candidate'},sourceStructuredContent:source,approvedPreview:preview.result});
      const pdf=await getDocument({data:new Uint8Array(bytes)}).promise;
      try{
        let text='';
        for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n),content=await page.getTextContent(),items=content.items.filter(item=>item.str?.trim());assert.ok(items.length>2,`${layout.key}: empty page`);text+=items.map(item=>item.str).join(' ');}
        const compact=text.replace(/\s+/g,'');
        for(const skill of preview.result.skills)assert.ok(compact.includes(skill.replace(/\s+/g,'')),`${layout.key}: missing ${skill}`);
        pdfs.push({template:layout.key,pages:pdf.numPages,bytes:bytes.length});
      }finally{await pdf.destroy();}
      await writeFile(resolve(directory,`${layout.key}.pdf`),bytes,{flag:'wx'});
    }
    const result={jobId:ids.job,isolated:true,contract:'6',originalSkills:input.sourceResume.skills.length,tailoredSkills:preview.result.skills.length,groups:preview.result.skillGroups.map(g=>({name:g.name,count:g.skills.length})),attempts:preview.generationAttempts,durationMs:Date.now()-started,pdfs};
    await writeFile(resolve(directory,'verification.json'),JSON.stringify(result,null,2),{flag:'wx'});
    console.log(JSON.stringify({event:'skills.proof.completed',...result}));
  }
  console.log(`Verification files: ${directory}`);
}finally{clearInterval(progress);await db.close();}
