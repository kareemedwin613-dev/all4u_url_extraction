import test from "node:test";
import assert from "node:assert/strict";
import { extractProfessionalExperienceSection, parseLegacyEmployment } from "../src/candidates/legacy-employment-parser.js";

test("extracts and structures legacy employment without reparsing a PDF",()=>{
  const section=extractProfessionalExperienceSection(`Luke Lopez\nPROFESSIONAL EXPERIENCE\nAccenture  January 2020 - Present\nSenior Full Stack Engineer  Remote\n• Built cloud systems.\nBombora  January 2016 - December 2019\nFull Stack Engineer\n- Built data platforms.\nEDUCATION\nMIT`);
  const items=parseLegacyEmployment(section);
  assert.equal(items.length,2);
  assert.deepEqual([items[0].company,items[0].job_title,items[0].location,items[0].is_current],["Accenture","Senior Full Stack Engineer","Remote",true]);
  assert.equal(items[1].company,"Bombora");
  assert.match(items[1].experience_details,/Built data platforms/);
});

test("does not invent employment when dates and structured boundaries are absent",()=>{
  assert.equal(parseLegacyEmployment("General professional background with no structured positions.").length,0);
});
