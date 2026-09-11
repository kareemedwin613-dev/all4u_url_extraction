import test from "node:test";
import assert from "node:assert/strict";
import { ASSESSMENT_SCHEMA, WEIGHTS, calculateScore, validateAssessment, validateDocument, assessmentPrompt, documentPrompt, insufficientAssessment } from "../src/scoring.mjs";
import { createOpenAIProvider } from "../src/openai-provider.mjs";

const result = rating => ({ sufficient: true, summary: "Supported match", missingRequirements: [],
  components: Object.fromEntries(Object.keys(WEIGHTS).map(key => [key, { rating, reason: "Source evidence" }])) });

test("all five score fields use a required integer-or-null schema and explicit numeric instructions", () => {
  const components = ASSESSMENT_SCHEMA.properties.components;
  assert.deepEqual(components.required, Object.keys(WEIGHTS));
  assert.equal(components.additionalProperties, false);
  for (const key of Object.keys(WEIGHTS)) {
    const component = components.properties[key], rating = component.properties.rating;
    assert.ok(component.required.includes("rating"));
    assert.equal(component.additionalProperties, false);
    assert.deepEqual(rating.type, ["integer", "null"]);
    assert.equal(rating.minimum, 0);
    assert.equal(rating.maximum, 100);
    assert.match(rating.description, /Unquoted JSON integer/);
  }
  assert.match(assessmentPrompt(), /"rating": 80, not "rating": "80"/);
  assert.match(assessmentPrompt(), /JSON null \(not "null" or "N\/A"\)/);
});

test("every score field accepts numeric integers and rejects strings, fractions, ranges and coercible values", () => {
  const jd = Object.fromEntries(Object.keys(WEIGHTS).map(key => [key, [{}]]));
  for (const key of Object.keys(WEIGHTS)) {
    for (const rating of [0, 1, 69, 70, 71, 80, 100]) {
      const r = result(70); r.components[key].rating = rating;
      assert.equal(validateAssessment(r, jd), r);
      assert.equal(typeof calculateScore(r), "number");
    }
    for (const rating of ["80", "80.0", "80%", "70-80", "eighty", "null", "N/A", "", " ", true, false, [], {}, undefined, null, 80.5, -1, 101]) {
      const r = result(70); r.components[key].rating = rating;
      assert.throws(() => validateAssessment(r, jd), error => error.code === "INVALID_MODEL_OUTPUT");
      assert.equal(r.components[key].rating, rating); // Never silently coerce or clamp model output.
    }
  }
});

test("numeric enforcement preserves genuine nulls for unrequested facets and insufficient assessments", () => {
  for (const key of Object.keys(WEIGHTS)) {
    const jd = Object.fromEntries(Object.keys(WEIGHTS).map(facet => [facet, facet === key ? [] : [{}]]));
    const r = result(80); r.components[key].rating = null;
    assert.equal(validateAssessment(r, jd), r);
    assert.equal(calculateScore(r), 80);
    r.components[key].rating = 0;
    assert.throws(() => validateAssessment(r, jd), error => error.code === "INVALID_MODEL_OUTPUT");
  }
  const r = insufficientAssessment("Missing original resume experience");
  assert.equal(validateAssessment(r), r);
  assert.equal(calculateScore(r), null);
});
test("weighted totals retain the 1–100 range and 69/70/71 boundary", () => {
  for (const rating of [69,70,71,100]) assert.equal(calculateScore(result(rating)), rating);
  assert.equal(calculateScore(result(0)), 1);
  assert.equal(calculateScore(insufficientAssessment("Missing JD")), null);
  const different = result(100); different.components.requiredSkills.rating = 0;
  assert.equal(calculateScore(different), 65);
});
test("only unrequested JD dimensions may be null; no invented neutral points", () => {
  const jd = Object.fromEntries(Object.keys(WEIGHTS).map(key => [key, [{}]]));
  const r = result(70); r.components.preferredSkills.rating = null;
  assert.throws(() => validateAssessment(r, jd));
  jd.preferredSkills = []; assert.equal(validateAssessment(r,jd),r); assert.equal(calculateScore(r),70);
  r.components.requiredSkills.rating = 101; assert.throws(() => calculateScore(r));
  r.components.requiredSkills.rating = "70"; assert.throws(() => calculateScore(r));
});
test("document facts must carry source quotes; resumes/JDs are data, not commands", () => {
  const r = { sufficient: true, summary: "React engineer", ...Object.fromEntries(Object.keys(WEIGHTS).map(key => [key, []])) };
  r.requiredSkills = [{ text: "React", quote: "Built React interfaces" }];
  assert.equal(validateDocument(r,{details:"Built React interfaces with TypeScript"}),r);
  r.requiredSkills[0].quote="Managed 50 people"; assert.throws(() => validateDocument(r,{details:"Built React interfaces"}));
  assert.match(documentPrompt("JD"),/untrusted data/);
  assert.match(assessmentPrompt(),/No category\/subcategory/);
  assert.match(assessmentPrompt(),/Positive historical outcomes never force/);
});
test("provider is opt-in and sends schema-bound, non-stored Responses requests", async () => {
  assert.throws(() => createOpenAIProvider({}),/MATCHING_NOT_CONFIGURED/);
  let sent;
  const provider = createOpenAIProvider({ apiKey: "test-key", model: "test-model", fetchImpl: async (url, options) => {
    sent={url,body:JSON.parse(options.body)};
    return new Response(JSON.stringify({status:"completed",output:[{type:"reasoning"},{type:"message",content:[{type:"output_text",text:JSON.stringify(result(70))}]}]}));
  }});
  assert.deepEqual(await provider.generate({name:"match",schema:ASSESSMENT_SCHEMA,instructions:assessmentPrompt(),input:{jd:"React"}}),result(70));
  assert.equal(sent.url,"https://api.openai.com/v1/responses"); assert.equal(sent.body.store,false);
  assert.equal(sent.body.text.format.strict,true); assert.equal(sent.body.model,"test-model");
  assert.deepEqual(sent.body.text.format.schema, ASSESSMENT_SCHEMA);
  assert.equal(sent.body.instructions, assessmentPrompt());
});
test("refusals, incomplete responses, rate limits and malformed JSON never become scores", async () => {
  for (const [body, expected] of [
    [{status:"completed",output:[{type:"message",content:[{type:"refusal",refusal:"No"}]}]},"MODEL_REFUSED"],
    [{status:"incomplete",output:[]},"MODEL_INCOMPLETE"],
    [{status:"completed",output:[{type:"message",content:[{type:"output_text",text:"not JSON"}]}]},"INVALID_MODEL_OUTPUT"],
  ]) {
    const provider=createOpenAIProvider({apiKey:"test",model:"test",fetchImpl:async()=>new Response(JSON.stringify(body))});
    await assert.rejects(()=>provider.generate({input:{}}),error=>error.code===expected);
  }
  const provider=createOpenAIProvider({apiKey:"test",model:"test",fetchImpl:async()=>new Response("",{status:429,headers:{"retry-after":"45"}})});
  await assert.rejects(()=>provider.generate({input:{}}),error=>error.code==="MODEL_RATE_LIMIT"&&error.retryable&&error.retryAfter===45);
});
