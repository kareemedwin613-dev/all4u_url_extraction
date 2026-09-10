import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read=(path)=>readFile(new URL(path,import.meta.url),"utf8");

test("dashboard routes and XLSX are loaded only when requested",async()=>{
  const[app,exporter,vite]=await Promise.all([
    read("../dashboard/src/App.jsx"),
    read("../dashboard/src/services/job-export-service.js"),
    read("../dashboard/vite.config.js"),
  ]);
  assert.match(app,/lazyNamed\(\s*\(\) => import\("\.\/features\/applications\/application-pages\.jsx"\)/);
  assert.match(app,/<Suspense fallback=/);
  assert.match(exporter,/await import\("xlsx"\)/);
  assert.doesNotMatch(exporter,/import\s+\*\s+as\s+XLSX\s+from\s+"xlsx"/);
  assert.doesNotMatch(vite,/["']ant-design["']\s*:/);
});

test("extension defers document parsers and captures JDs in one protected RPC",async()=>{
  const[view,service,build]=await Promise.all([
    read("../extension/sidepanel/views/ResumesView.jsx"),
    read("../extension/services/job-service.js"),
    read("../scripts/build.mjs"),
  ]);
  assert.match(view,/import\("\.\.\/\.\.\/services\/resume-parser\.js"\)/);
  assert.doesNotMatch(view,/^import.+resume-parser/m);
  assert.match(build,/splitting:true/);
  assert.match(service,/client\.rpc\("capture_job_description_v353"/);
  assert.doesNotMatch(service,/apiRequest|\/api\/v1\/extension\/job-descriptions/);
});

test("Application status is merged and renderers stay outside the API cold path",async()=>{
  const[applications,platform,materializer,templates]=await Promise.all([
    read("../apps/api/src/applications/application.service.ts"),
    read("../apps/api/src/platform/platform.service.ts"),
    read("../apps/api/src/platform/tailored-resume-materializer.ts"),
    read("../apps/api/src/platform/tailored-resume-templates.ts"),
  ]);
  assert.match(applications,/list_applications_v360/);
  assert.doesNotMatch(applications,/get_application_tailoring_statuses_v32/);
  assert.match(platform,/tailored-resume-templates\.js/);
  assert.doesNotMatch(platform,/tailored-resume\.renderer\.js/);
  assert.match(materializer,/await import\("\.\/tailored-resume-pdf\.renderer\.js"\)/);
  assert.doesNotMatch(templates,/from\s+["'](?:docx|pdfkit)["']/);
});

test("tailoring asks the model for the lean generation-only contract",async()=>{
  const[schema,prompt]=await Promise.all([
    read("../apps/tailoring-worker/schemas/tailoring-output.schema.json").then(JSON.parse),
    read("../apps/tailoring-worker/src/prompt.ts"),
  ]);
  assert.deepEqual(schema.required,["summary","professionalExperience","skills"]);
  assert.equal(schema.properties.skills.maxItems,24);
  assert.equal(schema.properties.skillGroups,undefined);
  assert.match(prompt,/tailoringModelContext/);
  assert.match(prompt,/at most 24 additional role-relevant technologies/i);
});
