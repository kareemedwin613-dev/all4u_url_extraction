import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const captureViewUrl = new URL("../extension/sidepanel/views/CaptureView.jsx", import.meta.url);
const appUrl = new URL("../extension/sidepanel/App.jsx", import.meta.url);

test("capture form drafts are user-scoped, restored, and removed only by explicit reset", async () => {
  const source = await readFile(captureViewUrl, "utf8");

  assert.match(source, /capture-current:\$\{userId \|\| "anonymous"\}/);
  assert.match(source, /chrome\.storage\.local\s*\.get\(draftKey\)/);
  assert.match(source, /form\.setFieldsValue\(\{ \.\.\.DEFAULT_VALUES, \.\.\.draft\.formValues \}\)/);
  assert.match(source, /formValues: values/);
  assert.match(source, /chrome\.storage\.local\.remove\(draftKey\)/);
  assert.match(source, /onClick=\{resetCaptureAndDiscardDraft\}/);
  assert.doesNotMatch(source, /capture-draft:\$\{activeUrl/);
});

test("visited extension tabs remain mounted while the authenticated user changes tabs", async () => {
  const source = await readFile(appUrl, "utf8");

  assert.match(source, /mountedViewsRef = useRef\(new Set\(\)\)/);
  assert.match(source, /mountedViewsRef\.current\.add\(currentView\)/);
  assert.match(source, /hidden=\{key !== currentView\}/);
  assert.match(source, /mountedViewsRef\.current\.clear\(\)/);
});
