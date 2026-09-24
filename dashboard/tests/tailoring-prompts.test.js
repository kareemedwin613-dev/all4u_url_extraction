import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPromptTree, promptDraftValues, promptRequest } from '../src/features/tailoring/prompts-service.js';
import { registerNavigationGuard, confirmNavigation } from '../src/shared/navigation-guard.js';
import { parseRoute } from '../src/router.js';
const categories={primary:[{id:'se',name:'Software Engineering'}],byId:new Map([['se',{name:'Software Engineering'}],['java',{name:'Java'}],['python',{name:'Python'}]]),childrenByParent:new Map([['se',[{id:'java'},{id:'python'}]]])};
const prompt=(id,scope,primary=null,sub=null)=>({id,scope,primary_category_id:primary,subcategory_id:sub,draft_name:id,published_version:1,draft_priority:10,published_priority:10});
test('tree shows nested scopes, drafts, archived overrides and inherited defaults',()=>{
  const generic=prompt('generic','GENERIC'), primary=prompt('default','PRIMARY','se'), java=prompt('javaPrompt','SUBTYPE','se','java');
  let tree=buildPromptTree([generic],categories);
  assert.match(tree[1].title,/Uses Generic/); assert.match(tree[1].children[0].title,/Uses Generic/);
  tree=buildPromptTree([generic,primary,{...java,draft_pending:true}],categories);
  assert.match(tree[1].children[1].children[0].title,/Published v1 \+ Draft/);
  assert.match(tree[1].children[2].title,/Uses category default/);
  tree=buildPromptTree([generic,primary,{...java,archived:true}],categories);
  assert.match(tree[1].children[1].title,/Uses category default/);
  assert.match(tree[1].children[1].children[0].title,/Archived/);
  assert.deepEqual(promptDraftValues(),{name:'',instructions:'',priority:0});
  assert.equal(parseRoute('#/tailoring-prompts').name,'tailoring-prompts');
});
test('unsaved navigation guard blocks route changes and cleans up on unmount',()=>{
  const cleanup=registerNavigationGuard(()=>false); assert.equal(confirmNavigation(),false);
  cleanup(); assert.equal(confirmNavigation(),true);
});
test('prompt service uses authenticated API and exposes publish conflicts',async t=>{
  const client={auth:{getSession:async()=>({data:{session:{access_token:'token'}}})}};
  const original=globalThis.fetch; t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,'https://example.invalid/api/v1/tailoring-prompts/prompt/publish');
    assert.equal(options.headers.Authorization,'Bearer token');
    assert.deepEqual(JSON.parse(options.body),{expectedRevision:2});
    return new Response(JSON.stringify({code:'PROMPT_STALE',message:'Reload the draft.'}),{status:409});
  };
  await assert.rejects(()=>promptRequest(client,'https://example.invalid','/prompt/publish','POST',{expectedRevision:2}),{code:'PROMPT_STALE',message:'Reload the draft.'});
});
