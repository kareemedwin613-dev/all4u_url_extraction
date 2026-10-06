import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dashboardBridgeTypes, handoffApplicationSession } from "../src/features/applications/extension-bridge.js";
import { applicationReviewHref } from "../src/features/applications/screenshot-review.js";

test("dashboard Application list leaves Resume loading and Autofill to the extension",async()=>{
  const source=await readFile(new URL("../src/features/applications/application-pages.jsx",import.meta.url),"utf8");
  assert.doesNotMatch(source,/Load Resume|Autofill|createApplicationExtensionSession|handoffApplicationSession|EXTENSION_NOT_INSTALLED/);
  assert.match(source,/href=\{applicationReviewHref\(record\.id, filters\)\}>\s*View\s*<\/Button>/);
  const id="f3a34ffd-d66a-49f7-815e-c7786857576b";
  assert.equal(applicationReviewHref(id),`#/applications/${id}`);
  const href=applicationReviewHref(id,{search:"72396",status:"APPLIED",page:2,pageSize:500});
  const [path,query]=href.split("?");
  assert.equal(path,`#/applications/${id}`);
  const params=new URLSearchParams(query);
  assert.equal(params.get("search"),"72396");assert.equal(params.get("status"),"APPLIED");
  assert.equal(params.get("page"),"2");assert.equal(params.get("pageSize"),"500");
  assert.equal(params.has("review"),false,"View opens details, not automatic screenshot review");
});

test("dashboard bridge resolves only the matching same-origin extension acknowledgement",async()=>{
  const listeners=new Set(),origin="https://dashboard.example.test",target={
    addEventListener:(_type,listener)=>listeners.add(listener),removeEventListener:(_type,listener)=>listeners.delete(listener),
    postMessage(message){queueMicrotask(()=>{for(const listener of listeners)listener({source:target,origin,data:{type:dashboardBridgeTypes.response,requestId:message.requestId,ok:true,data:{applicationId:message.payload.applicationId}}});});},
  };
  const result=await handoffApplicationSession({applicationId:"f3a34ffd-d66a-49f7-815e-c7786857576b"},{target,origin,timeoutMs:100});
  assert.equal(result.applicationId,"f3a34ffd-d66a-49f7-815e-c7786857576b");
  assert.equal(listeners.size,0);
});

test("dashboard bridge provides an extension-not-installed fallback",async()=>{
  const target={addEventListener(){},removeEventListener(){},postMessage(){}};
  await assert.rejects(handoffApplicationSession({},{target,origin:"https://dashboard.example.test",timeoutMs:5}),error=>error.code==="EXTENSION_NOT_INSTALLED");
});
