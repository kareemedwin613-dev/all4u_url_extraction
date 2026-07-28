import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=path=>readFile(new URL(path,import.meta.url),"utf8");

test("v0.8.5 API exposes protected context and session endpoints",async()=>{
  const [controller,service,dto,contracts]=await Promise.all([read("../apps/api/src/applications/application.controller.ts"),read("../apps/api/src/applications/application.service.ts"),read("../apps/api/src/applications/application.dto.ts"),read("../packages/contracts/src/index.ts")]);
  for(const route of ['":id/extension-context"','":id/extension-sessions"','"extension-sessions"'])assert.match(controller,new RegExp(route));
  assert.match(controller,/RequireRoles\("APPLIER","APPLYING_MANAGER","ADMIN"\)/);
  assert.match(controller,/@Throttle/);
  for(const rpc of ["get_application_extension_context_v085","create_application_extension_session_v085","update_application_extension_session_v085"])assert.match(service,new RegExp(rpc));
  assert.match(dto,/LOAD_RESUME.*AUTOFILL/);
  for(const type of ["ApplicationExtensionContext","ApplicationExtensionSession","CreateApplicationExtensionSessionRequest"])assert.match(contracts,new RegExp(type));
});

test("Manifest V3 bridge uses a narrow dashboard content script and memory-safe session storage",async()=>{
  const [manifestText,background,bridge,app]=await Promise.all([read("../extension/manifest.json"),read("../extension/background/service-worker.js"),read("../extension/content/dashboard-bridge.js"),read("../extension/sidepanel/App.jsx")]),manifest=JSON.parse(manifestText);
  assert.equal(manifest.manifest_version,3);
  assert.deepEqual(manifest.content_scripts[0].matches,["https://all4u-url-extraction.vercel.app/*","http://localhost/*","http://127.0.0.1/*"]);
  assert.match(background,/chrome\.storage\.session/);
  assert.match(background,/targetTabId/);
  assert.match(background,/DASHBOARD_ORIGIN_DENIED/);
  assert.match(bridge,/event\.source !== window/);
  assert.match(app,/getApplicationExtensionContext/);
  assert.doesNotMatch(`${bridge}${app}`,/storage_path|storage_bucket|signedUrl|resume bytes.*storage/i);
  assert.doesNotMatch(background,/chrome\.storage\.session\.set\([^)]*(signedUrl|accessToken|bytes)/s);
});
