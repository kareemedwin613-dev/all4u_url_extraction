import test from "node:test";
import assert from "node:assert/strict";
import { createPreparedCopy } from "../extension/services/prepared-copy.js";

test("clipboard retry starts synchronously and reuses prepared text", async () => {
  let loads = 0;
  let blocked = true;
  const writes = [];
  const copy = createPreparedCopy(async id => {
    loads++;
    return { text: `prompt ${id}`, resumeType: "TAILORED" };
  }, text => {
    writes.push(text);
    if (blocked) throw new Error("Document is not focused");
    return Promise.resolve();
  });
  assert.equal((await copy("a")).copied, false);
  blocked = false;
  const retry = copy("a");
  assert.deepEqual(writes, ["prompt a", "prompt a"]);
  assert.deepEqual(await retry, { copied: true, resumeType: "TAILORED" });
  assert.equal(loads, 1);
  await copy("a");
  assert.equal(loads, 2, "a successful copy releases cached text");
});

test("switching applications discards previous prepared text", async () => {
  const loads = [];
  const writes = [];
  const copy = createPreparedCopy(async id => {
    loads.push(id);
    if (id === "denied") throw new Error("Access denied");
    return { text: id, resumeType: "ORIGINAL" };
  }, async text => { writes.push(text); throw new Error("blocked"); });
  await copy("a");
  await copy("b");
  await assert.rejects(copy("denied"), /Access denied/);
  await copy("b");
  assert.deepEqual(loads, ["a", "b", "denied", "b"]);
  assert.deepEqual(writes, ["a", "b", "b"]);
});
