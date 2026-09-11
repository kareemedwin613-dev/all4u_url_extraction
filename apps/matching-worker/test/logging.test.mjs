import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createStageLogger, matchingErrorFields } from "../src/logging.mjs";
import { createMatchingWorker } from "../src/worker.mjs";
import { runMatchingCommand } from "../src/cli.mjs";
import { SCORING_MODE } from "../src/direct-scoring.mjs";
import { EXTRACTOR_VERSION, RUBRIC_VERSION, WEIGHTS, MatchingError, modelOutputError,
  validateDocument, validateAssessment } from "../src/scoring.mjs";

const keys = Object.keys(WEIGHTS);
const privateText = "PRIVATE_SOURCE_MARKER";
const facts = () => ({ sufficient: true, summary: privateText,
  ...Object.fromEntries(keys.map(key => [key, []])),
  requiredSkills: [{ text: privateText, quote: "Built React interfaces" }] });
const assessment = () => ({ sufficient: true, summary: privateText, missingRequirements: [],
  components: Object.fromEntries(keys.map(key => [key, { rating: key === "requiredSkills" ? 80 : null, reason: privateText }])) });
const directScore = () => ({ sufficient: true, summary: privateText,
  ratings: Object.fromEntries(keys.map(key => [key, key === "requiredSkills" ? 80 : null])) });
const job = (id = "job", attempt = 1) => ({ id, attempt, jdDocumentId: "jd", resumeDocumentId: "resume",
  leaseToken: "PRIVATE_LEASE_MARKER", rubricVersion: RUBRIC_VERSION, extractorVersion: EXTRACTOR_VERSION,
  scoringMode: SCORING_MODE, jdSource: { description: `Build React interfaces ${privateText}` },
  resumeSource: { experience: [{ details: `Built React interfaces ${privateText}` }] } });

function harness({ generate, attempt = 1, failureReport = true, receipt = { status: "COMPLETED", score: 80 },
  jobs = [job("job", attempt)] } = {}) {
  const logs = [], calls = [], requests = [];
  const worker = createMatchingWorker({ model: "test-model", log: event => logs.push(event),
    provider: { generate: async request => {
      requests.push(request);
      return generate ? generate(request) : directScore();
    } },
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "claim_application_match") return jobs.shift() || null;
      if (name === "complete_application_match") return receipt;
      if (name === "fail_application_match") {
        if (failureReport instanceof Error) throw failureReport;
        return failureReport;
      }
      throw Error(`Unexpected test RPC ${name}`);
    } });
  return { worker, logs, calls, requests };
}

test("matches log the four direct scoring stages with timings and the persisted score", async () => {
  const h = harness();
  await h.worker.runOne();
  const stages = h.logs.filter(event => event.event === "matching.stage.started").map(event => event.stage);
  assert.deepEqual(stages, ["score.prepare", "score.generate", "score.validate", "score.save"]);
  assert.deepEqual(h.logs.filter(event => event.event === "matching.stage.completed").map(event => event.stage), stages);
  for (const entry of h.logs) {
    assert.equal(entry.id, "job"); assert.equal(entry.attempt, 1);
    assert.ok(Number.isFinite(Date.parse(entry.timestamp)));
    if (entry.durationMs !== undefined) assert.ok(entry.durationMs >= 0);
  }
  assert.equal(h.logs.at(-1).score, 80);
  assert.equal(h.logs.at(-1).status, "COMPLETED");
  assert.equal(h.worker.snapshot().modelCalls, 1);
  assert.equal(h.worker.snapshot().completedCount, 1);
  assert.equal(h.worker.snapshot().activeJobs, 0);
  assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_|Built React interfaces/);
});

test("direct scoring has no document RPCs or extraction calls", async () => {
  const h = harness();
  await h.worker.runOne();
  assert.deepEqual(h.calls.map(call => call.name), ["claim_application_match", "complete_application_match"]);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].name, "application_match");
  assert.deepEqual(h.requests[0].schema.required, ["sufficient", "ratings", "summary"]);
});

test("validation failures include stage, field, type and actual retry disposition without raw output", async () => {
  for (const [attempt, report, scheduled] of [[1, true, false], [3, true, false], [1, false, false],
    [1, new MatchingError("MATCH_API_NETWORK_ERROR", true), false]]) {
    const h = harness({ attempt, failureReport: report, generate: () => {
      const r = directScore(); r.ratings.requiredSkills = privateText; return r;
    } });
    await h.worker.runOne();
    const failure = h.logs.at(-1);
    assert.equal(failure.event, "matching.failed");
    assert.equal(failure.stage, "score.validate");
    assert.equal(failure.reason, "INVALID_RATING_TYPE");
    assert.equal(failure.field, "components.requiredSkills.rating");
    assert.equal(failure.actualType, "string");
    assert.equal(failure.code, "INVALID_MODEL_OUTPUT");
    assert.equal(failure.failureRecorded, report === true);
    assert.equal(failure.retryScheduled, scheduled);
    assert.equal(failure.retryable, false);
    assert.equal(failure.retryAfterSeconds, scheduled ? 30 : undefined);
    assert.equal(h.calls.some(call => call.name === "complete_application_match"), false);
    assert.equal(h.calls.find(call => call.name === "fail_application_match").args.p_code, "INVALID_MODEL_OUTPUT");
    assert.equal(h.worker.snapshot().failedAttemptCount, 1);
    assert.equal(h.worker.snapshot().activeJobs, 0);
    assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_/);
    if (report instanceof Error) assert.ok(h.logs.some(event => event.stage === "failure.report" && event.event === "matching.stage.failed"));
  }
});

test("optional explanations never reject numeric scores or leak source text", async () => {
  const h = harness({ generate: () => ({ ...directScore(), summary: privateText.repeat(100), quote: privateText }) });
  await h.worker.runOne();
  assert.equal(h.logs.at(-1).event, "matching.completed");
  assert.equal(h.calls.at(-1).args.p_result.summary.length, 500);
  assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_/);
});

test("insufficient or stale results never log a made-up accepted score", async () => {
  const insufficient = harness({ jobs: [{ ...job(), resumeSource: { experience: [] } }],
    receipt: { status: "INSUFFICIENT_DATA", score: null } });
  await insufficient.worker.runOne();
  assert.equal(insufficient.logs.find(event => event.event === "matching.scoring.skipped").reason, "MISSING_SOURCE_CONTENT");
  assert.equal(insufficient.requests.length, 0);
  assert.equal(insufficient.logs.at(-1).score, undefined);
  assert.equal(insufficient.worker.snapshot().insufficientCount, 1);
  const stale = harness({ receipt: { status: "STALE" } });
  await stale.worker.runOne();
  assert.equal(stale.logs.at(-1).status, "STALE");
  assert.equal(stale.logs.at(-1).score, undefined);
  assert.equal(stale.worker.snapshot().staleCount, 1);
});

test("invalid model JSON is not retried even when recording its failure fails", async () => {
  const h = harness({ failureReport: new MatchingError("MATCH_API_NETWORK_ERROR", true), generate: () => {
    throw modelOutputError("MODEL_OUTPUT_NOT_JSON");
  } });
  await h.worker.runOne();
  assert.ok(h.logs.some(event => event.event === "matching.stage.failed" && event.stage === "failure.report" && event.code === "MATCH_API_NETWORK_ERROR"));
  assert.equal(h.logs.at(-1).stage, "score.generate");
  assert.equal(h.logs.at(-1).reason, "MODEL_OUTPUT_NOT_JSON");
  assert.equal(h.logs.at(-1).retryScheduled, false);
  assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_/);
});

test("heartbeats are correlated per stage and cleared after success or failure", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const logs = [], progress = createStageLogger(event => logs.push(event), { id: "job", attempt: 2 });
  let complete;
  const running = progress.run("score.generate", () => new Promise(resolve => { complete = resolve; }));
  t.mock.timers.tick(15_000);
  const heartbeat = logs.find(event => event.event === "matching.stage.progress");
  assert.equal(heartbeat.stage, "score.generate"); assert.equal(heartbeat.id, "job"); assert.equal(heartbeat.attempt, 2);
  complete({}); await running;
  const count = logs.length;
  t.mock.timers.tick(60_000);
  assert.equal(logs.length, count);
  await assert.rejects(progress.run("score.generate", () => { throw new Error(privateText); }));
  const failedCount = logs.length;
  t.mock.timers.tick(60_000);
  assert.equal(logs.length, failedCount);
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_/);
});

test("two simultaneous jobs use one model call each with separately correlated progress", async () => {
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const h = harness({ jobs: [job("job-one"), job("job-two")], generate: async () => {
    entered(); await gate;
    return directScore();
  } });
  const first = h.worker.runOne(), second = h.worker.runOne();
  await ready;
  assert.equal(h.worker.snapshot().activeJobs, 2);
  release(); await Promise.all([first, second]);
  assert.equal(h.requests.length, 2);
  assert.equal(h.worker.snapshot().modelCalls, 2);
  assert.equal(h.worker.snapshot().completedCount, 2);
  assert.deepEqual(h.logs.filter(event => event.event === "matching.completed").map(event => event.id).sort(), ["job-one", "job-two"]);
});

test("a broken log sink cannot fail otherwise valid work", async () => {
  const progress = createStageLogger(() => { throw Error("Log sink failed"); });
  assert.equal(await progress.run("score.save", () => 80), 80);
});

test("diagnostic metadata only exposes allowlisted paths, types and numeric sizes", () => {
  const error = modelOutputError("INVALID_RATING_TYPE", "components.requiredSkills.rating", {
    expectedType: "integer_or_null", actualType: "string", raw: privateText, quote: privateText, stack: privateText,
    actualLength: 20, actualCount: privateText, limit: -1 });
  assert.deepEqual(matchingErrorFields(error), { code: "INVALID_MODEL_OUTPUT", reason: "INVALID_RATING_TYPE",
    field: "components.requiredSkills.rating", expectedType: "integer_or_null", actualType: "string", actualLength: 20 });
  error.diagnostics.field = privateText;
  error.diagnostics.actualType = privateText;
  assert.doesNotMatch(JSON.stringify(matchingErrorFields(error)), /PRIVATE_/);
  assert.deepEqual(matchingErrorFields(Object.assign(new Error(privateText), { code: privateText })), { code: "MATCH_WORKER_ERROR" });
});

test("validation diagnostics distinguish field, length, count, range and null-policy failures", () => {
  const source = { description: "Built React interfaces" };
  const cases = [
    [() => validateDocument({ ...facts(), sufficient: "true" }, source), "INVALID_FIELD_TYPE", "sufficient"],
    [() => validateDocument({ ...facts(), summary: "x".repeat(501) }, source), "TEXT_TOO_LONG", "summary"],
    [() => validateDocument({ ...facts(), requiredSkills: Array(26).fill(facts().requiredSkills[0]) }, source), "TOO_MANY_ITEMS", "requiredSkills"],
    [() => validateDocument({ ...facts(), ...Object.fromEntries(keys.map(key => [key, Array(13).fill(facts().requiredSkills[0])])) }, source), "TOO_MANY_FACTS", "$"],
    [() => validateDocument({ ...facts(), requiredSkills: [{ text: "React", quote: " " }] }, source), "EMPTY_SOURCE_QUOTE", "requiredSkills[0].quote"],
  ];
  for (const [run, reason, field] of cases) {
    assert.throws(run, error => error.code === "INVALID_MODEL_OUTPUT" && error.diagnostics.reason === reason && error.diagnostics.field === field);
  }
  for (const [rating, sufficient, reason] of [[101, true, "RATING_OUT_OF_RANGE"], [null, true, "JD_FACET_REQUIRES_RATING"], [80, false, "INSUFFICIENT_REQUIRES_NULL"]]) {
    const r = assessment(); r.sufficient = sufficient; r.components.requiredSkills.rating = rating;
    assert.throws(() => validateAssessment(r, facts()), error => error.diagnostics.reason === reason);
  }
});

const runnerEnvironment = { MATCHING_BATCH_TICKET: `mrb_${"x".repeat(43)}`, MATCHING_API_BASE_URL: "http://localhost:3000",
  MATCHING_CONCURRENCY: "2", MATCHING_CODEX_REASONING_EFFORT: "none", OPENAI_API_KEY: "PRIVATE_API_KEY_MARKER" };
const claim = { modelId: "test-model", rubricVersion: RUBRIC_VERSION, extractorVersion: EXTRACTOR_VERSION, scoringMode: SCORING_MODE };
const fakeProvider = () => ({ settings: { reasoningEffort: "none", serviceTier: "default", timeoutMs: 60_000 }, check: async () => {} });

test("CLI rejects an old backend before provider startup or claiming any job", async () => {
  let providerCreated = false, jobClaimed = false;
  await assert.rejects(runMatchingCommand({ args: [], environment: runnerEnvironment, log: () => {},
    createProvider: () => { providerCreated = true; return fakeProvider(); },
    createApi: () => ({ claim: async () => ({ ...claim, scoringMode: undefined }), rpc: async () => { jobClaimed = true; } }) }),
  error => error.code === "DATABASE_MIGRATION_REQUIRED");
  assert.equal(providerCreated, false); assert.equal(jobClaimed, false);
});

test("CLI logs preflight, effective settings and completion without tickets or environment secrets", async () => {
  const logs = [], signals = new EventEmitter();
  await runMatchingCommand({ args: [], environment: runnerEnvironment, signals, log: event => logs.push(event),
    createProvider: fakeProvider, createApi: () => ({ claim: async () => claim, finished: true, receipt: { failedCount: 0 }, rpc: async () => null }) });
  const started = logs.find(event => event.event === "matching.started");
  assert.equal(started.concurrency, 2); assert.equal(started.reasoningEffort, "none"); assert.equal(started.modelTimeoutMs, 60_000);
  assert.equal(started.scoringMode, SCORING_MODE);
  assert.ok(logs.some(event => event.stage === "ticket.claim"));
  assert.ok(logs.some(event => event.stage === "provider.check"));
  assert.equal(logs.at(-1).event, "matching.finished");
  assert.equal(logs.at(-1).activeJobs, 0);
  assert.equal(signals.listenerCount("SIGINT"), 0); assert.equal(signals.listenerCount("SIGTERM"), 0);
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_|mrb_/);
});

test("CLI reports idle polling at bounded intervals and transient queue retry delays", async () => {
  const logs = [], waits = [];
  let elapsed = 0, next = 0;
  const api = { claim: async () => claim, finished: false, retryAfterSeconds: 5, rpc: async () => {
    if (next++ === 0) throw new MatchingError("MATCH_API_NETWORK_ERROR", true, 5);
    if (next > 6) api.finished = true;
    return null;
  } };
  await runMatchingCommand({ args: [], environment: { ...runnerEnvironment, MATCHING_CONCURRENCY: "1" },
    signals: new EventEmitter(), log: event => logs.push(event), createApi: () => api, createProvider: fakeProvider,
    now: () => elapsed, sleep: async ms => { waits.push(ms); elapsed += ms; } });
  assert.equal(logs.find(event => event.event === "matching.queue.retrying").retryAfterSeconds, 5);
  assert.equal(logs.filter(event => event.event === "matching.waiting").length, 2);
  assert.ok(waits.every(ms => ms === 5000));
  assert.equal(logs.at(-1).event, "matching.finished");
});

test("CLI once mode reports a pause, not a completed ticket, when only delayed work remains", async () => {
  const logs = [], signals = new EventEmitter();
  await runMatchingCommand({ args: ["--once"], environment: runnerEnvironment, signals, log: event => logs.push(event),
    createProvider: fakeProvider, createApi: () => ({ claim: async () => claim, finished: false, rpc: async () => null }),
    sleep: () => { throw Error("Once mode should not wait"); } });
  assert.equal(logs.at(-1).event, "matching.paused");
  assert.equal(logs.at(-1).reason, "ONCE_NO_READY_WORK");
  assert.equal(logs.some(event => event.event === "matching.finished"), false);
  assert.equal(signals.listenerCount("SIGINT"), 0);
});
