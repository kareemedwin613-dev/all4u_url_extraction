import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jobPageKey, offerOnPage, panelApplicationItems, pickerEntries, sameJobPage } from "../extension/shared/page-applications.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n, url, extra = {}) => ({ id: id(n), application_number: 10000 + n, company: "Temporal", job_title: "Senior Engineer", candidate_name: `Candidate ${n}`, status: "ASSIGNED", application_url: url, resume_name: "secret", ...extra });

test("a posting and its apply page are the same job; a company board is not", () => {
  assert.ok(sameJobPage("https://jobs.ashbyhq.com/temporal/5f1c/application", "https://jobs.ashbyhq.com/temporal/5f1c"));
  assert.ok(sameJobPage("https://apply.workable.com/anvilogic-inc/j/01708BAC81/apply/", "https://apply.workable.com/anvilogic-inc/j/01708BAC81/"));
  assert.ok(sameJobPage("https://job-boards.greenhouse.io/elite/jobs/5441560008?gh_src=abc", "https://job-boards.greenhouse.io/elite/jobs/5441560008"));
  assert.ok(sameJobPage("https://www.acme.com/careers?gh_jid=77", "https://acme.com/careers/?gh_jid=77&utm_source=x"));
  assert.ok(!sameJobPage("https://www.acme.com/careers?gh_jid=77", "https://acme.com/careers?gh_jid=78"));
  assert.ok(!sameJobPage("https://jobs.ashbyhq.com/temporal/aaaa", "https://jobs.ashbyhq.com/temporal/bbbb"));
  assert.ok(!sameJobPage("https://jobs.ashbyhq.com/temporal", "https://jobs.ashbyhq.com/temporal/5f1c"), "a board never matches its jobs");
  assert.ok(!sameJobPage("https://jobs.lever.co/acme/1", "https://jobs.ashbyhq.com/acme/1"));
  assert.equal(jobPageKey("javascript:alert(1)"), null);
});

test("the shared list keeps only what the picker shows", () => {
  const [item] = panelApplicationItems([row(1, "https://jobs.ashbyhq.com/temporal/5f1c")]);
  assert.deepEqual(Object.keys(item).sort(), ["candidate", "company", "id", "jobTitle", "number", "status", "urls"]);
  assert.equal(item.number, 10001);
  assert.equal(panelApplicationItems([{ id: "not-a-uuid" }]).length, 0);
  assert.deepEqual(panelApplicationItems([row(2, "javascript:alert(1)")])[0].urls, []);
});

test("every profile assigned the same job is offered first, then the rest of the panel's list", () => {
  const items = panelApplicationItems([row(1, "https://jobs.ashbyhq.com/temporal/5f1c"), row(2, "https://jobs.ashbyhq.com/temporal/5f1c"), row(3, "https://apply.workable.com/x/j/9/")]);
  const picker = pickerEntries("https://jobs.ashbyhq.com/temporal/5f1c/application", items);
  assert.deepEqual(picker.likely.map((entry) => entry.number), [10001, 10002]);
  assert.deepEqual(picker.others.map((entry) => entry.number), [10003]);
  assert.ok(!("urls" in picker.likely[0]), "job URLs are not sent to the page");
});

test("the button is offered on job sites and where the panel's Applications live, not everywhere", () => {
  const items = panelApplicationItems([row(1, "https://careers.acme.com/jobs/1")]);
  assert.ok(offerOnPage("https://boards.greenhouse.io/acme/jobs/1", []));
  assert.ok(offerOnPage("https://acme.wd5.myworkdayjobs.com/en-US/External/job/1", []));
  assert.ok(offerOnPage("https://careers.acme.com/jobs/2", items));
  assert.ok(!offerOnPage("https://mail.google.com/mail/u/0/", items));
  assert.ok(!offerOnPage("https://evilgreenhouse.io/x", []));
});

test("the button acts only on real clicks, stays out of the page's reach, and never submits", () => {
  const launcher = read("../extension/content/page-launcher.js");
  assert.match(launcher, /attachShadow\(\{ mode: "closed" \}\)/);
  for (const handler of launcher.match(/addEventListener\("(click|keydown)", \(event\) => \{[^\n]*/g)) assert.match(handler, /event\.isTrusted/, handler);
  assert.doesNotMatch(launcher, /type="submit"|<form|\.submit\(|requestSubmit\(|\.click\(\)/);
  assert.match(launcher, /if \(globalThis\.__resumeJdPageLauncher\) return;/, "injected once per page");
});

test("only the button's own top-frame script may list or start, and the panel starts it like a card", () => {
  const worker = read("../extension/background/service-worker.js"), app = read("../extension/sidepanel/App.jsx");
  const service = read("../extension/services/application-service.js"), view = read("../extension/sidepanel/views/MyApplicationsView.jsx");
  assert.match(worker, /function pageSender\(sender\)\{return sender\?\.id===chrome\.runtime\.id&&Number\.isInteger\(sender\?\.tab\?\.id\)&&sender\.frameId===0/);
  assert.match(worker, /APPLICATION_NOT_LISTED/, "a picked id must be in the panel's list");
  assert.match(worker, /port\.name!=="sidepanel"\|\|port\.sender\?\.id!==chrome\.runtime\.id\|\|port\.sender\?\.tab/, "only the side panel connects");
  assert.match(worker, /frameIds:\[0\]\},files:\["content\/page-launcher\.js"\]/);
  // A tab picked from the page is used as is, and only extension pages may pin one.
  assert.match(worker, /const pinned=internal&&Number\.isInteger\(payload\?\.targetTabId\)/);
  assert.match(app, /startApplicationExtensionAction\(client, backendBaseUrl, item\.id, "AUTOFILL", \{ targetTabId: tabId \}\)/);
  assert.match(app, /chrome\.storage\.session\.remove\(PANEL_APPLICATIONS_KEY\)/, "sign-out stops offering Applications");
  assert.match(view, /startApplicationExtensionAction\(client,backendBaseUrl,application\.id,action\)/);
  assert.match(view, /PANEL_APPLICATIONS_KEY\]: \{ updatedAt: Date\.now\(\), items: panelApplicationItems\(items\) \}/);
  assert.match(service, /PROFILE_REVIEW_REQUIRED/);
});
