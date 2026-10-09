import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the worker keeps one Application session per tab instead of a single active session", () => {
  const worker = read("../extension/background/service-worker.js");
  assert.match(worker, /SESSIONS_KEY="applicationSessions"/);
  assert.doesNotMatch(worker, /FRAME_KEY/);
  // Starting a job on a tab only replaces that tab's earlier session.
  assert.match(worker, /removeSessions\(item=>item\.targetTabId===session\.targetTabId\)/);
  assert.match(worker, /LIST_APPLICATION_SESSIONS/);
  assert.match(worker, /SET_APPLICATION_TAB_STATUS/);
});

test("each tab shows its own status: badge, title prefix, and an on-page notice", () => {
  const worker = read("../extension/background/service-worker.js");
  assert.match(worker, /chrome\.action\.setBadgeText\(\{tabId/);
  assert.match(worker, /function showTabStatus\(/);
  assert.match(worker, /attachShadow\(\{mode:"closed"\}\)/);
  // Tab status can only be set by the extension's own pages, never by a web page.
  assert.match(worker, /function setTabStatus\(payload,sender\)\{const internal=sender\?\.id===chrome\.runtime\.id&&!sender\?\.tab;if\(!internal\)return fail\("TAB_STATUS_DENIED"/);
});

test("the side panel runs jobs side by side and keeps status writes off the fill path", () => {
  const app = read("../extension/sidepanel/App.jsx");
  assert.match(app, /const \[jobs, setJobs\] = useState\(\(\) => new Map\(\)\)/);
  assert.match(app, /MESSAGE_TYPES\.LIST_APPLICATION_SESSIONS/);
  assert.match(app, /changes\.applicationSessions/);
  assert.match(app, /startedJobsRef\.current\.has\(item\.id\)/, "a session is started once");
  // Independent requests go out together.
  assert.match(app, /await Promise\.all\(\[\s*getApplicationAutofillContext/);
  assert.match(app, /recentApplicationExtensionContext\(sessionData\.applicationId\)/);
  // Status, recovery and telemetry are queued in order per session rather than awaited.
  assert.match(app, /writeQueuesRef\.current\.get\(id\) \|\| Promise\.resolve\(\)\)\.then\(task\)/);
  assert.doesNotMatch(app.slice(app.indexOf("const runJob"), app.indexOf("const syncJobs")), /await updateApplication(ExtensionSession|AutofillRecovery)|await recordApplicationAutofillTelemetry/);
  assert.doesNotMatch(app, /\.submit\(|requestSubmit\(/);
});

test("fields that need the tab in front wait for it and are retried once", () => {
  const app = read("../extension/sidepanel/App.jsx");
  assert.match(app, /async function waitingForTab\(/);
  assert.match(app, /if \(!tab \|\| tab\.active\) return \[\]/);
  assert.match(app, /job\.session\?\.targetTabId === currentTabId && job\.deferredFieldIds\?\.length && !job\.busy/);
  assert.match(app, /deferredFieldIds: \[\] \}\)/, "cleared before retrying so a failing retry is not repeated");
});

test("the jobs list never clicks anything on the job page", () => {
  const list = read("../extension/sidepanel/components/AutofillJobsList.jsx");
  assert.match(list, /Open tab/);
  assert.doesNotMatch(list, /\.click\(|\.submit\(|requestSubmit\(/);
});

test("a centered progress card shows each step without taking focus or blocking the page", () => {
  const worker = read("../extension/background/service-worker.js"), app = read("../extension/sidepanel/App.jsx");
  // Injected functions are serialized alone, so the card's code must live inside showTabStatus.
  const status = worker.slice(worker.indexOf("function showTabStatus("), worker.indexOf("async function setTabStatus("));
  assert.match(status, /\(function showTabProgress\(label,step,steps\)\{/);
  assert.match(status, /pointer-events:none/);
  assert.doesNotMatch(status.slice(0, status.indexOf("const marks=")), /<button|tabindex|\.focus\(/, "the card has nothing to focus or press");
  assert.match(status, /attachShadow\(\{mode:"closed"\}\)/);
  assert.match(status, /,120000\);return true;\}\)\(state==="WORKING"/, "the card removes itself without updates; any other state clears it");
  assert.match(worker, /args:\[state,heading,detail,Number\.isInteger\(payload\?\.step\)\?payload\.step:0,Number\.isInteger\(payload\?\.steps\)\?payload\.steps:0\]/);
  for (const label of ["Loading application", "Attaching resume", "Reading the form", "Filling fields"]) assert.match(app, new RegExp(`tabProgress\\(id, \\d, (steps|1), "${label}"\\)`));
  assert.match(app, /statusQueuesRef\.current\.get\(id\) \|\| Promise\.resolve\(\)\)\.then\(\(\) => chrome\.runtime\.sendMessage/, "status updates stay in order per tab");
  assert.match(app, /catch \(error\) \{ tabStatus\(id, "FAILED", "Autofill stopped"/, "a failed retry replaces the card");
});
