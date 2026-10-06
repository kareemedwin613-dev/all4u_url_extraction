import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {access,writeFile} from "node:fs/promises";
import sharp from "sharp";
import {configuration,createApi,runReview} from "../apps/screenshot-review-worker/src/cli.mjs";
import {downloadScreenshot,prepareImages,tilesFor} from "../apps/screenshot-review-worker/src/images.mjs";
import {instructions,modelInput,PROMPT_VERSION} from "../apps/screenshot-review-worker/src/review.mjs";
import {createCodexProvider} from "../apps/matching-worker/src/codex-provider.mjs";
import {safeEvent,workerCommand,RUN_ID} from "../scripts/worker-supervisor.mjs";

test("runner configuration and metadata redact credentials and signed URLs",()=>{
  const ticket=`srb_${"a".repeat(43)}`;
  assert.equal(configuration(["--batch-ticket",ticket,"--api-base-url","https://example.com"]).ticket,ticket);
  assert.throws(()=>configuration(["--batch-ticket",ticket,"--api-base-url","https://name:pass@example.com"]));
  assert.throws(()=>configuration(["--batch-ticket","wrong","--api-base-url","https://example.com"]));
  assert.deepEqual(safeEvent({event:ticket,url:"https://private",prompt:"private"}),{});
  assert.ok(RUN_ID.test(`screenshot-review-${"a".repeat(24)}`));
  const launch=workerCommand(process.cwd(),"screenshot-review",[],ticket);
  assert.equal(launch.options.env.SCREENSHOT_REVIEW_BATCH_TICKET,ticket);assert.ok(!launch.args.includes(ticket));
  const input=modelInput({source:{candidate:{fullName:"Test"},screenshots:[{id:"shot",url:"private-url",path:"private-path",mimeType:"image/png"}]},guide:[],assumptions:{}},[]);
  assert.ok(!JSON.stringify(input).includes("private"));
  assert.match(instructions,/FORMAT_ONLY/);assert.match(instructions,/NEVER a candidate fact/);assert.match(instructions,/EVERY visible input/);
});
test("GoFullPage tiles overlap and cover the bottom without losing content",()=>{
  const tiles=tilesFor(1400,18000);assert.equal(tiles[0].top,0);
  for(let n=1;n<tiles.length;n++)assert.ok(tiles[n].top<tiles[n-1].top+tiles[n-1].height);
  assert.equal(tiles.at(-1).top+tiles.at(-1).height,18000);
  assert.throws(()=>tilesFor(10000,100000),/DIMENSIONS/);
});
test("downloads are bounded, private origin constrained and unsupported PDFs rejected",async()=>{
  const shot={id:"s",url:"https://example.supabase.co/storage/v1/object/sign/application-screenshots/a.png?token=private",mimeType:"image/png",bytes:12};
  let called=false;await assert.rejects(downloadScreenshot({...shot,url:"https://evil.test/a"},"https://example.supabase.co",()=>{called=true;}),/URL_INVALID/);assert.equal(called,false);
  await assert.rejects(downloadScreenshot({...shot,mimeType:"application/pdf"},"https://example.supabase.co"),/FORMAT_UNSUPPORTED/);
  await assert.rejects(downloadScreenshot(shot,"https://example.supabase.co",async()=>new Response("x",{headers:{"content-length":"99999999"}})),/TOO_LARGE/);
  const bytes=await downloadScreenshot(shot,"https://example.supabase.co",async(_url,options)=>{assert.equal(options.redirect,"error");return new Response("image");});assert.equal(bytes.toString(),"image");
});
test("real PNG tiling creates image files and cleans private temporary files",async()=>{
  const png=await sharp({create:{width:900,height:3200,channels:3,background:"white"}}).png().toBuffer();
  const shot={id:"s",url:"https://example.supabase.co/storage/v1/object/sign/application-screenshots/a.png",mimeType:"image/png",bytes:png.length};
  const images=await prepareImages({storageOrigin:"https://example.supabase.co",source:{screenshots:[shot]}},async()=>new Response(png));
  try{assert.equal(images.paths.length,3);assert.equal(images.manifest.at(-1).top+images.manifest.at(-1).height,3200);for(const path of images.paths)await access(path);}finally{await images.cleanup();}
  await assert.rejects(access(images.paths[0]));
});
test("Codex receives images as attachments, not URLs or tool instructions",async()=>{
  let invocation;
  const provider=createCodexProvider({model:"test-vision",execute:async options=>{
    if(options.args[0]==="login")return {stdout:"Logged in using ChatGPT",stderr:""};invocation=options;
    await writeFile(options.args[options.args.indexOf("-o")+1],JSON.stringify({ok:true}));return {stdout:"",stderr:""};
  }});
  assert.deepEqual(await provider.generate({schema:{type:"object"},instructions:"Review",input:{},images:["C:\\temp\\tile 1.png","C:\\temp\\tile 2.png"]}),{ok:true});
  assert.equal(invocation.args.filter(x=>x==="--image").length,2);assert.equal(invocation.args.at(-1),"-");
  assert.ok(invocation.args.includes("features.shell_tool=false"));assert.ok(invocation.args.includes("--ignore-user-config"));
});
test("worker saves results, clears images and reports failures without logging source text",async()=>{
  let calls=0,cleaned=0;const requests=[],events=[];
  const item={itemId:"00000000-0000-4000-8000-000000000001",leaseToken:"lease",model:"test-vision",promptVersion:PROMPT_VERSION,source:{candidate:{fullName:"Private Candidate"},screenshots:[]},guide:[]};
  const api=async(op,body)=>{requests.push([op,body]);if(op==="next")return calls++===0?item:{done:true};return {status:"CORRECT"};};
  const result=await runReview({api,signals:new EventEmitter(),emit:e=>events.push(e),wait:async()=>{},
    provider:()=>({check:async()=>{},generate:async()=>({fields:[],screenshots:[],complete:true})}),prepare:async()=>({paths:["image"],manifest:[],cleanup:async()=>{cleaned++;}})});
  assert.equal(result.status,"COMPLETED");assert.equal(cleaned,1);assert.ok(requests.some(([op])=>op==="submit"));assert.ok(!JSON.stringify(events).includes("Private Candidate"));
});
test("unsupported images fail just their item; authentication failures stop instead of mass-failing",async()=>{
  for(const code of ["SCREENSHOT_FORMAT_UNSUPPORTED","CODEX_CHATGPT_LOGIN_REQUIRED"]){let count=0;const requests=[];
    const run=runReview({signals:new EventEmitter(),wait:async()=>{},api:async(op,body)=>{requests.push(op);return op==="next"?(count++===0?{itemId:"item",leaseToken:"lease",model:"test",promptVersion:PROMPT_VERSION}:{done:true}):{status:"FAILED"};},provider:()=>({check:async()=>{if(code.startsWith("CODEX"))throw Object.assign(Error(),{code});}}),prepare:async()=>{throw Object.assign(Error(),{code});}});
    if(code.startsWith("CODEX")){await assert.rejects(run,e=>e.code===code);assert.ok(!requests.includes("fail"));}else{assert.equal((await run).status,"COMPLETED_WITH_FAILURES");assert.ok(requests.includes("fail"));}
  }
});
test("API retries transient errors only and keeps ticket out of errors",async()=>{
  let calls=0;
  const api=createApi({apiBaseUrl:"https://example.test",ticket:`srb_${"a".repeat(43)}`},async()=>{calls++;return new Response(JSON.stringify({code:"SCREENSHOT_REVIEW_TICKET_EXPIRED"}),{status:410});},async()=>{});
  await assert.rejects(api("next"),e=>e.code==="SCREENSHOT_REVIEW_TICKET_EXPIRED");assert.equal(calls,1);
});
