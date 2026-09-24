import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

// Real editor/hooks/API client; visual widgets are replaced because linkedom has no layout engine.
const widgets=`import React from 'react';
const h=React.createElement,c=()=>globalThis.promptControls;
const Box=p=>h('div',null,p.title,p.message,p.description,p.extra,p.children);
export const Alert=Box,Card=Box,Col=Box,Row=Box,Space=Box,Spin=Box,Tag=Box;
export const Typography={Title:Box,Paragraph:Box,Text:Box};
export const Form=Object.assign(Box,{Item:Box});
export const App={useApp:()=>({modal:{confirm:p=>{c().confirm=p;}},message:{success:()=>{}}})};
export const Button=p=>{if(typeof p.children==='string')c().buttons.set(p.children,p);return h('button',{disabled:p.disabled,onClick:p.onClick},p.children);};
export const Input=Object.assign(p=>{c()[p.maxLength===120?'name':'application']=p;return null;},{TextArea:p=>{c().body=p;return null;},Search:p=>{c().search=p;return null;}});
export const InputNumber=p=>{c().priority=p;return null;};
export const Tree=p=>{c().tree=p;return null;};`;
const compiled=await build({stdin:{contents:'export {TailoringPromptsPage} from "./features/tailoring/prompts-page.jsx"; export {confirmNavigation} from "./shared/navigation-guard.js";',resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),loader:'jsx'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',define:{'import.meta.env':'{}'},plugins:[{name:'widgets',setup(b){b.onResolve({filter:/^react$/},args=>({path:args.path,external:true}));b.onResolve({filter:/^antd$/},()=>({path:'widgets',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:widgets,loader:'js'}));}}]});
const module={exports:{}};
new Function('require','module','exports',compiled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const {TailoringPromptsPage,confirmNavigation}=module.exports;

test('editor saves, publishes, restores, previews selection and creates a separate draft test',async t=>{
  const keys=['window','document','fetch','IS_REACT_ACT_ENVIRONMENT','promptControls'];
  const previous=Object.fromEntries(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const {window,document}=parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis,{window,document,IS_REACT_ACT_ENVIRONMENT:true,promptControls:{buttons:new Map()}});
  window.confirm=()=>false;
  const controls=globalThis.promptControls,calls=[];
  let detail={id:'11111111-1111-4111-8111-111111111111',scope:'GENERIC',primary_category_id:null,subcategory_id:null,draft_name:'Generic',draft_body:'Original instructions',draft_priority:0,revision:1,published_version:1,draft_pending:false,versions:[{version:1,name:'Generic',body:'Original instructions',priority:0,published_at:'2026-09-24T00:00:00Z'}],events:[]};
  globalThis.fetch=async(url,options)=>{
    const path=new URL(url).pathname.replace('/api/v1/tailoring-prompts',''),body=options.body?JSON.parse(options.body):undefined;
    calls.push({path,method:options.method,body});
    let data;
    if(!path)data=[detail];
    else if(path.endsWith('/draft')){assert.equal(body.expectedRevision,detail.revision);detail={...detail,draft_body:body.instructions,draft_name:body.name,revision:detail.revision+1,draft_pending:true};data=detail;}
    else if(path.endsWith('/publish')){detail={...detail,published_version:2,draft_pending:false,revision:detail.revision+1};data=detail;}
    else if(path.endsWith('/restore')){assert.equal(body.version,1);detail={...detail,draft_body:'Original instructions',published_version:3,revision:detail.revision+1};data=detail;}
    else if(path.endsWith('/tests'))data={run:{id:'test-id',status:'PENDING'},ticket:'tpt_'+'a'.repeat(64)};
    else if(path==='/preview')data={name:'Generic',version:3,priority:0,reason:'Generic fallback'};
    else data=detail;
    return new Response(JSON.stringify({data}),{status:200});
  };
  const client={auth:{getSession:async()=>({data:{session:{access_token:'test-only'}}})}},root=createRoot(document.getElementById('root'));
  t.after(async()=>{await act(()=>root.unmount());for(const[k,v]of Object.entries(previous)){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];}});
  const step=action=>act(async()=>{await action();await new Promise(resolve=>setImmediate(resolve));});
  const click=async label=>{const b=controls.buttons.get(label);assert.ok(b,label);assert.equal(Boolean(b.disabled),false,label);await step(()=>b.onClick());};
  await step(()=>root.render(React.createElement(TailoringPromptsPage,{client,apiBaseUrl:'https://example.invalid',categories:{primary:[]}})));
  await step(()=>controls.tree.onSelect([],{node:controls.tree.treeData[0].children[0]}));
  assert.equal(controls.body.value,'Original instructions');
  await step(()=>controls.body.onChange({target:{value:'Edited instructions'}}));
  assert.equal(confirmNavigation(),false,'unsaved route changes are guarded');
  assert.equal(controls.buttons.get('Publish').disabled,true);
  await click('Save draft'); assert.equal(confirmNavigation(),true);
  assert.equal(detail.published_version,1,'saving must not publish');
  await click('Publish'); await step(()=>controls.confirm.onOk());
  assert.equal(detail.published_version,2);
  await click('Restore as new version'); await step(()=>controls.confirm.onOk());
  assert.equal(controls.body.value,'Original instructions'); assert.equal(detail.published_version,3);
  await step(()=>controls.search.onChange({target:{value:'22222222-2222-4222-8222-222222222222'}}));
  await step(()=>controls.search.onSearch()); assert.match(document.body.textContent,/Generic fallback/);
  await step(()=>controls.application.onChange({target:{value:'33333333-3333-4333-8333-333333333333'}}));
  await click('Create one-item test command');
  assert.match(document.body.textContent,/run prompt:test -- --prompt-test-ticket/);
  assert.equal(calls.some(c=>c.path.includes('materializ')||c.path.includes('assign')),false);
});
