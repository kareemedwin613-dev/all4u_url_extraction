import test from 'node:test';
import assert from 'node:assert/strict';
import {materializeTailoredResumeArtifact} from '../src/platform/tailored-resume-materializer.js';
import {referenceResumeFixture} from './fixtures/reference-resume.mjs';
import {ApiException} from '../src/common/errors/api.exception.js';
const started={...referenceResumeFixture(),renderFormat:'PDF',renderTemplateKey:'MODERN_V1',targetBucket:'tailored-resumes',targetPath:'owner/job/attempt/resume.pdf',filename:'resume.pdf',materializationToken:'token'};
test('PDF upload never deletes or overwrites prior objects, and records the underlying error for server diagnostics',async()=>{
  const failures:any[]=[],storageError={name:'StorageApiError',statusCode:'409',message:'The resource already exists'};
  const client={storage:{from:()=>({remove:()=>{throw new Error('Must not delete');},upload:async(path:string,_bytes:Buffer,options:any)=>{
    assert.equal(path,started.targetPath);assert.equal(options.upsert,false);return{error:storageError};
  }})}};
  await assert.rejects(()=>materializeTailoredResumeArtifact(client,started,{finalize:async()=>{throw new Error('Must not finalize');},fail:async(...args)=>{failures.push(args);}}),(error:any)=>{
    assert.ok(error instanceof ApiException);assert.equal(error.code,'UPLOAD_FAILED');assert.deepEqual(error.diagnostic,{stage:'UPLOAD_FAILED',storageError});return true;
  });
  assert.deepEqual(failures,[['UPLOAD_FAILED','token']]);
});
test('lost finalize responses cannot delete a possibly committed PDF',async()=>{
  const failures:any[]=[];
  const client={storage:{from:()=>({remove:()=>{throw new Error('Must not delete');},upload:async()=>({error:null})})}};
  await assert.rejects(()=>materializeTailoredResumeArtifact(client,started,{finalize:async()=>{throw new Error('Response lost');},fail:async(...args)=>{failures.push(args);}}),(error:any)=>error.code==='FINALIZE_FAILED');
  assert.deepEqual(failures,[['FINALIZE_FAILED','token']]);
});
