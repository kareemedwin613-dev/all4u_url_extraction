import test from "node:test";
import assert from "node:assert/strict";
import { bulkDraftHref, createBulkDraftStore, draftPairExclusions, restoreDraftResumeIds, selectDraftPairs } from "../src/features/bulk-applications/bulk-drafts.js";
import { pairKey } from "../src/features/bulk-applications/bulk-state.js";
import { canRunMatch } from "../src/features/application-matching/match-state.js";
import { parseRoute } from "../src/router.js";

const jd1 = "f3a34ffd-d66a-49f7-815e-c7786857576b", jd2 = "b4d63a80-e306-4a2f-afca-29cd4b3951e0";
const resume1 = "8660f115-ce73-41ff-889b-b6d07202a3e4", resume2 = "a21c0738-2905-4733-8a1d-d6e0dddb0122";
const pair = (jd, resume, details = {}) => ({ key: pairKey(jd, resume), jobDescriptionId: jd, resumeId: resume, eligible: true, ...details });
function memoryStorage() {
  const data = new Map();
  return { data, get length() { return data.size; }, key: index => [...data.keys()][index], getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
function fixture() {
  const storage = memoryStorage();
  let now = 1000;
  const store = (overrides = {}) => createBulkDraftStore({ userId: "account-a", apiBaseUrl: "https://api.example.test", storage: () => storage, now: () => ++now, ...overrides });
  return { storage, store };
}

test("navigation and browser reload restore each draft independently through its stable route", () => {
  const { store } = fixture(), first = store(), a = first.create([jd1, jd1]), b = first.create([jd2]);
  first.update(a.id, { resumeIds: [resume2], batchName: "Friday batch", matchingMode: "CATEGORY", activeTab: "create", excludedPairKeys: [pairKey(jd1, resume2)] });
  const reloaded = store(), route = parseRoute(bulkDraftHref(a.id));
  assert.equal(route.name, "application-bulk-create");
  assert.equal(new URLSearchParams(route.query).get("draft"), a.id);
  const saved = reloaded.getSnapshot().drafts.find(draft => draft.id === a.id);
  assert.deepEqual(saved.jobDescriptionIds, [jd1]);
  assert.deepEqual(saved.resumeIds, [resume2]);
  assert.equal(saved.batchName, "Friday batch");
  assert.equal(saved.matchingMode, "CATEGORY");
  assert.equal(saved.activeTab, "create");
  assert.deepEqual(saved.excludedPairKeys, [pairKey(jd1, resume2)]);
  assert.deepEqual(reloaded.getSnapshot().drafts.find(draft => draft.id === b.id).jobDescriptionIds, [jd2]);
});

test("drafts are isolated by account and API deployment, with trailing slashes normalized", () => {
  const { store } = fixture(), a = store();
  a.create([jd1]);
  for (const overrides of [{ userId: "account-b" }, { apiBaseUrl: "http://localhost:3000" }, { userId: undefined }]) {
    assert.equal(store(overrides).getSnapshot().drafts.length, 0);
  }
  assert.equal(store({ apiBaseUrl: "https://api.example.test/" }).getSnapshot().drafts.length, 1);
  assert.equal(store({ userId: undefined }).create([jd1]), null);
});

test("an intentionally empty resume selection stays empty; unavailable resumes are removed", () => {
  const { store } = fixture(), first = store(), draft = first.create([jd1]);
  assert.deepEqual(restoreDraftResumeIds(draft.resumeIds, [resume1, resume2]), [resume1, resume2]);
  first.update(draft.id, { resumeIds: [] });
  assert.deepEqual(restoreDraftResumeIds(store().getSnapshot().drafts[0].resumeIds, [resume1, resume2]), []);
  assert.deepEqual(restoreDraftResumeIds([resume1, resume2], [resume2]), [resume2]);
});

test("fresh scores select newly eligible pairs but preserve manual exclusions and duplicate checks", () => {
  const rows = [pair(jd1, resume1), pair(jd1, resume2), pair(jd2, resume1, { eligible: false, matchStatus: "PROCESSING" })];
  const excluded = draftPairExclusions(rows, new Set([rows[1].key]), new Set());
  assert.deepEqual([...excluded], [rows[0].key]);
  const fresh = [rows[0], { ...rows[1], eligible: false, existingApplicationId: "created-elsewhere" }, { ...rows[2], eligible: true, matchStatus: "COMPLETED" }];
  assert.deepEqual([...selectDraftPairs(fresh, excluded)], [rows[2].key]);
  assert.deepEqual(fresh.filter(canRunMatch), []);
  assert.deepEqual([...draftPairExclusions(rows, new Set([rows[0].key, rows[1].key]), excluded)], []);
  assert.deepEqual([...selectDraftPairs([pair(jd1, resume1, { existingApplicationId: "duplicate" })], new Set())], []);
});

test("credentials, commands, scores and document content are not persisted", () => {
  const { store, storage } = fixture(), first = store(), draft = first.create([jd1]);
  first.update(draft.id, { resumeIds: [resume1], matchingRunner: { ticket: "private-ticket" }, access_token: "private-token", preview: { score: 100 }, resumeText: "private-resume", jobText: "private-jd" });
  const raw = [...storage.data.values()].join("");
  assert.doesNotMatch(raw, /private-|matchingRunner|access_token|preview|resumeText|jobText/);
  assert.equal(first.getSnapshot().drafts.length, 1);
});

test("interrupted creation keeps the same retry key and fingerprint across reloads", () => {
  const { store } = fixture(), first = store(), draft = first.create([jd1]);
  const creationAttempt = { key: crypto.randomUUID(), fingerprint: JSON.stringify({ payload: [{ job_description_id: jd1, resume_id: resume1 }], batchName: "Retry batch", matchingMode: "SCORE" }) };
  first.update(draft.id, { creationAttempt });
  assert.deepEqual(store().getSnapshot().drafts[0].creationAttempt, creationAttempt);
  first.update(draft.id, { creationAttempt: { key: crypto.randomUUID(), fingerprint: "broken" } });
  assert.equal(store().getSnapshot().drafts[0].creationAttempt, null);
});

test("completion or discard removes only its draft and late callbacks cannot recreate it", () => {
  const { store } = fixture(), first = store(), a = first.create([jd1]), b = first.create([jd2]), otherTab = store();
  first.remove(a.id);
  assert.equal(otherTab.update(a.id, { batchName: "Late response" }), null);
  assert.deepEqual(store().getSnapshot().drafts.map(draft => draft.id), [b.id]);
  first.update(b.id, { batchName: "Still working" });
  assert.equal(store().getSnapshot().drafts[0].batchName, "Still working");
});

test("different tabs preserve unrelated drafts and subscribers see storage events", () => {
  const { store } = fixture(), events = new EventTarget(), first = store({ events }), second = store();
  let notifications = 0;
  const unsubscribe = first.subscribe(() => notifications++);
  const a = first.create([jd1]), b = second.create([jd2]);
  first.update(a.id, { batchName: "First tab" });
  second.update(b.id, { batchName: "Second tab" });
  const event = new Event("storage"); Object.defineProperty(event, "key", { value: null }); events.dispatchEvent(event);
  assert.equal(first.getSnapshot().drafts.length, 2);
  assert.equal(first.getSnapshot().drafts.find(draft => draft.id === b.id).batchName, "Second tab");
  assert.ok(notifications >= 3);
  unsubscribe();
});

test("blocked storage and quota exhaustion keep drafts in memory with a visible warning", () => {
  const { store, storage } = fixture();
  const blocked = store({ storage: () => { throw new Error("Disabled"); } });
  const draft = blocked.create([jd1]);
  blocked.update(draft.id, { batchName: "In memory" });
  assert.equal(blocked.getSnapshot().drafts[0].batchName, "In memory");
  assert.match(blocked.getSnapshot().storageError, /session only/);
  const quota = store();
  storage.setItem = () => { throw new Error("Quota"); };
  const unsaved = quota.create([jd2]);
  assert.equal(quota.getSnapshot().drafts[0].id, unsaved.id);
  assert.match(quota.getSnapshot().storageError, /do not refresh/);
});

test("malformed storage records do not break other drafts; selections obey existing limits", () => {
  const { store, storage } = fixture(), first = store(), good = first.create([jd1]);
  const prefix = [...storage.data.keys()][0].slice(0, -good.id.length);
  storage.setItem(prefix + crypto.randomUUID(), "{broken");
  storage.setItem(prefix + crypto.randomUUID(), JSON.stringify({ id: "bad", jobDescriptionIds: [jd1] }));
  assert.equal(store().getSnapshot().drafts.length, 1);
  assert.equal(first.create([]), null);
  assert.equal(first.create(["not-a-uuid"]), null);
  assert.equal(first.create(Array(1001).fill(jd1)), null);
  assert.equal(first.update(good.id, { resumeIds: ["bad"] }), null);
});
