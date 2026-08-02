import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { clearSidepanelView, loadSidepanelView, saveSidepanelView } from "../extension/sidepanel/ui-state.js";

function storage() {
  const values={};
  return {values,async get(key){return{[key]:values[key]};},async set(next){Object.assign(values,next);},async remove(key){delete values[key];}};
}

test("side panel restores only an authorized persisted view",async()=>{
  const area=storage();
  await saveSidepanelView("user-1","applications",area);
  assert.equal(await loadSidepanelView("user-1",["capture","applications","settings"],"capture",area),"applications");
  assert.equal(await loadSidepanelView("user-1",["capture","settings"],"capture",area),"capture");
  await clearSidepanelView("user-1",area);
  assert.equal(await loadSidepanelView("user-1",["capture","applications"],"capture",area),"capture");
});

test("side panel ignores non-persistable and anonymous views",async()=>{
  const area=storage();
  await saveSidepanelView("user-1","auth",area);
  await saveSidepanelView(null,"applications",area);
  assert.deepEqual(area.values,{});
});

test("Capture JD flushes the latest form and checkbox draft during unmount",async()=>{
  const source=await readFile(new URL("../extension/sidepanel/views/CaptureView.jsx",import.meta.url),"utf8");
  assert.match(source,/latestDraft\.current = draft/);
  assert.match(source,/if \(pending\) chrome\.storage\.local\.set\(\{ \[draftKey\]: pending \}\)/);
  assert.match(source,/formValues: allValues/);
  assert.match(source,/clearanceRequirements/);
});
