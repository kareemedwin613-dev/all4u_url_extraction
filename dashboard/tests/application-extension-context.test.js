import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dashboardBridgeTypes, handoffApplicationSession } from "../src/features/applications/extension-bridge.js";

test("dashboard Application list exposes both reviewed extension actions",async()=>{
  const source=await readFile(new URL("../src/features/applications/application-pages.jsx",import.meta.url),"utf8");
  for(const text of ["Load Resume","Autofill","createApplicationExtensionSession","handoffApplicationSession","EXTENSION_NOT_INSTALLED"])assert.match(source,new RegExp(text));
  assert.match(source,/updateApplicationExtensionSession/);
  assert.match(source,/REJECTED.*WITHDRAWN.*CLOSED/);
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
