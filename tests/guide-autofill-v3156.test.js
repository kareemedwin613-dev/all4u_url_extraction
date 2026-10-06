import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { GenericHtmlAdapter, arbitrateAutofillCandidates } from "../extension/adapters/generic-html-adapter.js";
import { autofillValue, autofillValues, formatCandidateLocation, guideDefinitions, guideValue, salaryExpectation, screeningDefinitions, totalYearsOfExperience } from "../extension/autofill/autofill-context.js";
import { findBestOption, optionPolarity } from "../extension/autofill/option-matching.js";
import { scoreGuidePattern, sanitizeGuideEntries } from "../extension/autofill/guide-field-adapter.js";
import { formatDateForControl } from "../extension/autofill/personal-field-adapter.js";
import { skillSpecificExperience } from "../extension/autofill/screening-field-adapter.js";

const ids = Object.fromEntries(["attest", "travel", "functions", "military", "relocate", "sponsor", "languages", "gpa", "location", "salary", "pronouns", "gender", "veteran", "years", "start", "applied"]
  .map((name, index) => [name, `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`]));
const entry = (id, question, mode, value = "", source = null, patterns = [], sensitive = false) => ({ id, question, mode, value, source, patterns, sensitive, howToAnswer: `How to answer ${question}` });
const GUIDE = [
  entry(ids.attest, "I hereby state that the information given by me in this application is true in all respects.", "NEVER", "", null, ["i certify that", "true and complete"]),
  entry(ids.travel, "Are you open to occasional travel, including international travel, as needed for company events (e.g., summit, offsites)?", "FIXED", "No", null, ["occasional travel"]),
  entry(ids.functions, "Can you perform the essential functions for the position for which you are applying with or without a reasonable accommodation?", "FIXED", "Yes", null, ["essential functions"]),
  entry(ids.military, "Are you a current or previously serving member in the military or armed forces? If so, what capacity?", "FIXED", "No", null, ["military service"], true),
  entry(ids.relocate, "Are you willing to relocate?", "FIXED", "No", null, ["willing to relocate"]),
  entry(ids.sponsor, "Will you now or in the future require sponsorship for employment visa status?", "FIXED", "No", null, ["require sponsorship", "sponsorship"]),
  entry(ids.languages, "Languages", "FIXED", "English", null, ["languages spoken"]),
  entry(ids.gpa, "Overall Result (GPA)", "DERIVED", "3.8", "gpa", ["gpa"]),
  entry(ids.location, "What does “Location” mean in Personal Details?", "DERIVED", "", "candidate.currentLocation", ["location", "current location"]),
  entry(ids.salary, "What is your salary expectation?", "DERIVED", "150000", "salaryExpectation", ["desired salary", "salary expectations"]),
  entry(ids.pronouns, "Preferred pronouns?", "DERIVED", "", "pronouns", ["pronouns"], true),
  entry(ids.gender, "What is your gender?", "DERIVED", "", "gender", ["gender"], true),
  entry(ids.veteran, "Are you a protected Veteran?", "FIXED", "No", null, ["veteran status", "protected veteran"], true),
  entry(ids.years, "How many years of professional experience do you have?", "DERIVED", "", "totalYearsOfExperience", ["years of experience", "how many years of experience"]),
  entry(ids.start, "Available to Start", "DERIVED", "Two weeks after accepting an offer", "startAvailability", ["available start date", "earliest start date"]),
  entry(ids.applied, "Have you ever applied with [Company] or any affiliates?", "FIXED", "No", null, []),
];
const CONTEXT = {
  values: { "candidate.fullName": "Jane Doe", "candidate.firstName": "Jane", "candidate.city": "Miami", "candidate.state": "Florida", "candidate.country": "United States", "candidate.postalCode": "33126" },
  employment: [
    { company: "Acme", jobTitle: "Senior Engineer", location: "Remote", startDate: { year: 2022, month: 1 }, isCurrent: true, experienceDetails: "Built the payments API.\nLed a team of four." },
    { company: "Globex", jobTitle: "Engineer", location: "Austin, TX", startDate: { year: 2019, month: 6 }, endDate: { year: 2022, month: 1 } },
  ],
  education: [],
  gender: "FEMALE",
  job: { salaryMin: 120000, salaryMax: 130000, salaryCurrency: "USD", salaryPeriod: "YEAR" },
  applicationAnswers: [],
  guideEntries: GUIDE,
};

function page(html) {
  const { document, window } = parseHTML(`<!doctype html><html><body><form>${html}</form></body></html>`);
  // linkedom lacks <select>.value and the <option> text fallback; mirror Chrome's behavior.
  Object.defineProperty(window.HTMLOptionElement.prototype, "value", {
    configurable: true,
    get() { return this.getAttribute("value") ?? this.textContent.trim(); },
  });
  Object.defineProperty(window.HTMLSelectElement.prototype, "value", {
    configurable: true,
    get() { const options = [...this.options]; return (options.find((option) => option.hasAttribute("selected")) || options[0])?.value ?? ""; },
    set(next) { for (const option of this.options) if (option.value === next) option.setAttribute("selected", ""); else option.removeAttribute("selected"); },
  });
  Object.assign(globalThis, { Event: window.Event, HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement });
  return document;
}

async function autofill(document, context = CONTEXT) {
  const adapter = new GenericHtmlAdapter();
  const { fields, unresolved } = adapter.detectFields({ root: document, availableKeys: Object.keys(autofillValues(context)), applicationAnswers: screeningDefinitions(context), guideEntries: guideDefinitions(context) });
  const results = await adapter.fillFields({ root: document, fields: fields.map((field) => ({ ...field, value: autofillValue(context, field) })) });
  return { fields, unresolved, results, byId: (id) => document.getElementById(id) };
}

test("v3.156 fixes the reviewed mis-fills: declaration, travel, essential functions, and military questions", async () => {
  const document = page(`
    <div><label><input type="checkbox" id="attest" name="attest"> I hereby state that the information given by me in this application is true in all respects.</label></div>
    <div><label><input type="checkbox" id="certify" name="certify"> I certify that the information I have provided is current, true and complete.</label></div>
    <div><label for="travel">Are you open to occasional travel, including international travel, as needed for company events (e.g., summit, offsites)?</label><input id="travel" name="travel"></div>
    <div><label for="functions">Can you perform the essential functions for the position for which you are applying with or without a reasonable accommodation?</label><input id="functions" name="functions"></div>
    <div><label for="military">Are you a current or previously serving member in the military or armed forces? If so, what capacity?</label><input id="military" name="military"></div>
    <div><label for="state">State</label><select id="state" name="state"><option value="">Select</option><option value="FL">Florida</option></select></div>`);
  const { results, unresolved, byId } = await autofill(document);
  assert.equal(Boolean(byId("attest").checked), false, "the declaration is never ticked");
  assert.equal(Boolean(byId("certify").checked), false, "a 'current' declaration is not a current-job checkbox");
  assert.equal(byId("travel").value, "No");
  assert.equal(byId("functions").value, "Yes");
  assert.equal(byId("military").value, "No");
  assert.equal(byId("state").value, "FL");
  assert.ok(results.every((result) => result.status === "VERIFIED"), JSON.stringify(results));
  const declaration = unresolved.find((item) => item.guideEntryId === ids.attest);
  assert.equal(declaration?.reason, "REVIEW_REQUIRED");
});

test("v3.156 detects a plain Name field and fills every employment entry with its description", async () => {
  const document = page(`
    <div><label for="name">Name</label><input id="name" name="name"></div>
    <fieldset id="employment-0"><legend>Work Experience 1</legend>
      <label>Company<input id="c0" name="job_application[employments][0][company]"></label>
      <label>Title<input id="t0" name="job_application[employments][0][title]"></label>
      <label>Start date<input id="s0" type="month" name="job_application[employments][0][start]"></label>
      <label>Description<textarea id="d0" name="job_application[employments][0][description]"></textarea></label>
    </fieldset>
    <fieldset id="employment-1"><legend>Work Experience 2</legend>
      <label>Company<input id="c1" name="job_application[employments][1][company]"></label>
      <label>Title<input id="t1" name="job_application[employments][1][title]"></label>
      <label>Location<input id="l1" name="job_application[employments][1][location]"></label>
    </fieldset>`);
  const { byId, results } = await autofill(document);
  assert.equal(byId("name").value, "Jane Doe");
  assert.deepEqual([byId("c0").value, byId("t0").value, byId("c1").value, byId("t1").value], ["Acme", "Senior Engineer", "Globex", "Engineer"]);
  assert.equal(byId("s0").value, "2022-01", "month inputs receive YYYY-MM");
  assert.equal(byId("d0").value, "Built the payments API.\nLed a team of four.");
  assert.equal(byId("l1").value, "Austin, TX", "a job's Location is that job's location");
  assert.ok(results.every((result) => result.status === "VERIFIED"), JSON.stringify(results));
});

test("v3.156 gives each control one owner and keeps Personal Details location separate from job location", async () => {
  const document = page(`
    <div><label for="loc">Location</label><input id="loc" name="location"></div>
    <div><label for="avail">Available start date</label><input id="avail" name="avail_start"></div>
    <div><label for="py">How many years of experience do you have with Python?</label><input id="py" name="py"></div>
    <div><label for="years">How many years of professional experience do you have?</label><input id="years" type="number" name="years"></div>`);
  const { fields, byId } = await autofill(document);
  const owners = new Map();
  for (const field of fields) owners.set(field.fieldId, field.key);
  assert.equal(new Set(fields.map((field) => field.fieldId)).size, fields.length);
  assert.equal(byId("loc").value, "Miami, FL, USA");
  assert.equal(byId("avail").value, "Two weeks after accepting an offer");
  assert.equal(byId("py").value, "", "a single-skill question is left for the next phase");
  assert.equal(byId("years").value, String(totalYearsOfExperience(CONTEXT.employment)));
});

test("v3.156 fills guide answers into radios, selects, and checkboxes using the page's own option wording", async () => {
  const document = page(`
    <fieldset><legend>Will you now or in the future require sponsorship?</legend>
      <label><input type="radio" name="sponsor" id="sy" value="1"> Yes</label><label><input type="radio" name="sponsor" id="sn" value="0"> No</label></fieldset>
    <div><label for="vet">Veteran status</label><select id="vet" name="vet"><option value="">Select</option><option value="a">I identify as one or more of the classifications of protected veteran</option><option value="b">I am not a protected veteran</option><option value="c">I don't wish to answer</option></select></div>
    <div><label for="gender">Gender</label><select id="gender" name="gender"><option value="">Select</option><option>Male</option><option>Female</option></select></div>
    <div><label for="pro">Pronouns</label><select id="pro" name="pro"><option value="">Select</option><option>He/Him</option><option>She/Her</option></select></div>
    <div><label for="salary">Desired salary</label><input id="salary" name="salary"></div>
    <div><label for="applied">Have you ever applied with Acme Corp or any affiliates?</label><input id="applied" name="applied"></div>`);
  const { byId } = await autofill(document);
  assert.equal(byId("sn").checked, true);
  assert.equal(Boolean(byId("sy").checked), false);
  assert.equal(byId("vet").value, "b");
  assert.equal(byId("gender").value, "Female");
  assert.equal(byId("pro").value, "She/Her");
  assert.equal(byId("salary").value, "$125,000 per year");
  assert.equal(byId("applied").value, "No", "[Company] matches the employer's name");
});

test("v3.156 leaves sensitive answers to a person when the Resume prohibits them (server sends NEVER)", async () => {
  const document = page(`<div><label for="gender">Gender</label><select id="gender" name="gender"><option value="">Select</option><option>Male</option><option>Female</option></select></div>`);
  const context = { ...CONTEXT, guideEntries: GUIDE.map((item) => item.sensitive ? { ...item, mode: "NEVER" } : item) };
  const { byId, unresolved } = await autofill(document, context);
  assert.equal(byId("gender").value, "");
  assert.equal(unresolved[0].guideEntryId, ids.gender);
});

test("v3.156 a page wrapper named after the job does not hide contact fields", async () => {
  const document = page(`<div class="job-position-application" id="experience-page">
    <div><label for="first">First name</label><input id="first" name="first_name"></div>
    <div><label for="city">City</label><input id="city" name="city"></div></div>`);
  const { byId } = await autofill(document);
  assert.equal(byId("first").value, "Jane");
  assert.equal(byId("city").value, "Miami");
});

test("v3.156 one-word guide wordings match only the whole question", () => {
  assert.equal(scoreGuidePattern("Languages", "Languages"), 99);
  assert.equal(scoreGuidePattern("Languages (optional)", "Languages"), 97);
  assert.equal(scoreGuidePattern("Programming languages", "Languages"), 0);
  assert.equal(scoreGuidePattern("Job location", "location"), 0);
  assert.ok(scoreGuidePattern("Will you require visa sponsorship to work in the US?", "require sponsorship") === 0);
  assert.equal(scoreGuidePattern("Will you require sponsorship now or later?", "require sponsorship"), 96);
  assert.equal(scoreGuidePattern("Have you ever applied with Globex Inc or any affiliates?", "Have you ever applied with [Company] or any affiliates?"), 99);
  assert.equal(sanitizeGuideEntries([{ id: "not-a-uuid", question: "Q", mode: "FIXED" }, { id: ids.gpa, question: "GPA", mode: "DERIVED", source: "unknown" }]).length, 0);
});

test("v3.156 derives salary, years, location, pronouns, start date, and GPA as the guide specifies", () => {
  const now = new Date("2026-10-06T00:00:00Z");
  assert.equal(salaryExpectation({ salaryMin: 120000, salaryMax: 130000, salaryCurrency: "USD", salaryPeriod: "YEAR" }, "150000"), "$125,000 per year");
  assert.equal(salaryExpectation({ salaryMin: null, salaryMax: null }, "150000"), "$150,000 per year");
  assert.equal(salaryExpectation({ salaryMin: 50, salaryMax: 70, salaryCurrency: "USD", salaryPeriod: "HOUR" }, "150000"), "$60 per hour");
  assert.equal(salaryExpectation({ salaryMin: null, salaryMax: null }, "150000", "number"), "150000");
  // Overlapping roles count once: 2019-06 → 2026-10 is 7 years 4 months.
  assert.equal(totalYearsOfExperience(CONTEXT.employment, now), 7);
  assert.equal(formatCandidateLocation({ "candidate.city": "Miami", "candidate.state": "Florida", "candidate.country": "United States" }), "Miami, FL, USA");
  assert.equal(formatCandidateLocation({ "candidate.city": "Toronto", "candidate.state": "Ontario", "candidate.country": "Canada" }), "Toronto, Ontario, Canada");
  const field = (id, inputType = "text", controlType = "input") => ({ key: `guide.${id}`, inputType, controlType });
  assert.equal(guideValue(CONTEXT, field(ids.pronouns), now), "She/Her");
  assert.equal(guideValue({ ...CONTEXT, gender: null }, field(ids.gender), now), "", "no gender recorded means no answer");
  assert.equal(guideValue(CONTEXT, field(ids.start, "date"), now), "2026-10-20");
  assert.equal(guideValue(CONTEXT, field(ids.start), now), "Two weeks after accepting an offer");
  assert.equal(guideValue(CONTEXT, field(ids.gpa), now), "3.8 / 4.0");
  assert.equal(guideValue(CONTEXT, field(ids.gpa, "number"), now), "3.8");
  assert.equal(guideValue(CONTEXT, field(ids.attest), now), "");
});

test("v3.156 option matching handles country, state, polarity, and numeric ranges", () => {
  const options = (...texts) => texts.map((text) => ({ text }));
  const pick = (list, wanted) => findBestOption(list, wanted, (item) => [item.text])?.text || null;
  assert.equal(pick(options("Canada", "United States of America"), "United States"), "United States of America");
  assert.equal(pick(options("California", "Colorado"), "CA"), "California");
  assert.equal(pick(options("Oregon", "Other"), "or"), null, "ordinary two-letter words are not states");
  assert.equal(pick(options("Yes, I am authorized", "No, I am not authorized"), "Yes"), "Yes, I am authorized");
  assert.equal(pick(options("0-2 years", "3-5 years", "6-10 years", "10+ years"), "7"), "6-10 years");
  assert.equal(pick(options("Less than 1 year", "1-3 years"), "0"), "Less than 1 year");
  assert.equal(optionPolarity("I don't wish to answer"), "decline");
  assert.equal(formatDateForControl("2021-06", { type: "text", getAttribute: () => "" }), "06/2021");
  assert.equal(formatDateForControl("2021-06", { type: "date", getAttribute: () => "" }), "2021-06-01");
  assert.equal(formatDateForControl("2015", { type: "month", getAttribute: () => "" }), "2015-01");
  assert.equal(skillSpecificExperience("Years of Kubernetes experience"), true);
  assert.equal(skillSpecificExperience("Years of relevant experience"), false);
});

test("v3.156 arbitration prefers the guide on ties and never assigns a control twice", () => {
  const element = {}, other = {};
  const winners = arbitrateAutofillCandidates({
    personal: [{ element, key: "employment.0.startDate", confidence: 90 }],
    screening: [{ element, elements: [element], key: "screening.available_start_date", confidence: 92 }],
    guide: [{ element, elements: [element], key: `guide.${ids.start}`, confidence: 92 }, { element: other, elements: [other], key: `guide.${ids.start}`, confidence: 96 }],
  });
  assert.deepEqual(winners.map((winner) => [winner.kind, winner.elements[0] === element ? "first" : "second"]), [["guide", "second"], ["guide", "first"]]);
});

test("v3.156 extension sends guide definitions without answers and records only question wording", async () => {
  const [app, service, worker] = await Promise.all(["../extension/sidepanel/App.jsx", "../extension/services/application-service.js", "../extension/background/service-worker.js"].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.match(app, /guideEntries: guideDefinitions\(autofillContext\)/);
  assert.doesNotMatch(JSON.stringify(guideDefinitions(CONTEXT)), /English|150000|How to answer/);
  assert.match(service, /autofill-unresolved/);
  assert.match(service, /question:item\.question\.slice\(0,300\),controlType:item\.controlType,reason:item\.reason/);
  assert.match(worker, /GUIDE_FIELD_KEY/);
  assert.doesNotMatch(`${app}\n${worker}`, /requestSubmit\(|\.submit\(|submitButton\.click\(/i);
});
