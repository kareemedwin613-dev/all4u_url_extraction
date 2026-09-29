import test from "node:test";
import assert from "node:assert/strict";
import {HealthController} from "../src/health/health.controller.js";
import {RENDERED_SKILL_LIMIT} from "../src/platform/tailored-resume-layout.js";
test("health exposes the real rendering limit and non-sensitive feature versions",()=>{
  const response=new HealthController({} as any).health();
  assert.equal(response.tailoring.renderedSkillLimit,RENDERED_SKILL_LIMIT);
  assert.equal(response.tailoring.renderedSkillLimit,80);
  assert.equal(response.tailoring.educationLayoutVersion,2);
  assert.equal(response.tailoring.keywordCoverageVersion,1);
});
