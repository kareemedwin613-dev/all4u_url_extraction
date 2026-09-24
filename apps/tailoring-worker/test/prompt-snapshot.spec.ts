import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateTailoringInput } from '../src/validation.js';
import { buildTailoringPrompt } from '../src/prompt.js';
import { runPromptTest } from '../src/prompt-test-runner.js';
import { promptTestRequest } from '../src/api-client.js';
import type { TailoringPreview } from '../src/types.js';
const fixture=JSON.parse(readFileSync(new URL('../fixtures/application-19.json',import.meta.url),'utf8')).applications[0];
const snapshot={promptId:'11111111-1111-4111-8111-111111111111',name:'Java',version:3,instructions:'Use Java keywords.',contractVersion:'2',referenceDate:'2026-09-01T00:00:00Z',composedPrompt:'Exact saved prompt\nwith fixed output contract.'};
test('saved v2 prompt is used verbatim regardless of retry date',()=>{
  const input=validateTailoringInput({...fixture,contractVersion:'1.3',promptSnapshot:snapshot});
  assert.equal(buildTailoringPrompt(input,new Date('2030-01-01')),snapshot.composedPrompt);
  const whitespace=validateTailoringInput({...fixture,contractVersion:'1.3',promptSnapshot:{...snapshot,composedPrompt:'  Saved prompt\n'}});
  assert.equal(buildTailoringPrompt(whitespace),'  Saved prompt\n');
  for(const patch of [{contractVersion:'9'},{version:0},{composedPrompt:''},{referenceDate:'invalid'}])
    assert.throws(()=>validateTailoringInput({...fixture,contractVersion:'1.3',promptSnapshot:{...snapshot,...patch}}));
  assert.throws(()=>validateTailoringInput({...fixture,contractVersion:'1.3'}),/snapshot/);
  assert.throws(()=>validateTailoringInput({...fixture,contractVersion:'1.2',promptSnapshot:snapshot}),/unsupported fields/);
});
test('test runner submits only a preview and reports generation failure without materializing',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'tailoring-prompt-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const input=validateTailoringInput({...fixture,contractVersion:'1.3',promptSnapshot:{...snapshot,version:null,isTest:true,draftRevision:4}});
  const actions:string[]=[];
  const request:typeof promptTestRequest=async(_base,_ticket,action,extra)=>{
    actions.push(action);
    if(action==='CLAIM')return{input,testId:'test-id'};
    if(action==='SUBMIT')assert.deepEqual(extra,{result:{summary:'Preview only'}});
    return{id:'test-id',status:'COMPLETED'};
  };
  const generate=async()=>({result:{summary:'Preview only'}} as TailoringPreview);
  const result=await runPromptTest('https://example.invalid','ticket',join(directory,'preview.json'),{request,generate});
  assert.equal(result.status,'COMPLETED'); assert.deepEqual(actions,['CLAIM','SUBMIT']);
  actions.length=0;
  await assert.rejects(()=>runPromptTest('https://example.invalid','ticket',join(directory,'preview.json'),{request,generate:async()=>{throw new Error('generation failed');}}),/generation failed/);
  assert.deepEqual(actions,['CLAIM','FAIL']);
});
test('draft test client sends capability to the isolated endpoint and validates claimed input',async()=>{
  const ticket='tpt_'+'a'.repeat(64);
  await assert.rejects(()=>promptTestRequest('https://example.invalid','bad','CLAIM'),/ticket/i);
  const input={...fixture,contractVersion:'1.3',promptSnapshot:{...snapshot,version:null,isTest:true,draftRevision:1}};
  const result=await promptTestRequest('https://example.invalid',ticket,'CLAIM',{},async(url,options)=>{
    assert.equal(String(url),'https://example.invalid/api/v1/tailoring-prompt-test-runner');
    assert.deepEqual(JSON.parse(String(options?.body)),{ticket,action:'CLAIM'});
    return new Response(JSON.stringify({data:{testId:'test-id',input}}),{status:200,headers:{'content-type':'application/json'}});
  });
  assert.equal(result.input.promptSnapshot.draftRevision,1);
});
