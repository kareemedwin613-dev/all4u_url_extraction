import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=(path)=>readFile(new URL(path,import.meta.url),"utf8");

test("backend verifies Supabase JWTs and derives user-scoped RLS identity",async()=>{
  const [jwt,guard,supabase,service]=await Promise.all([read("../apps/api/src/auth/jwt-verifier.service.ts"),read("../apps/api/src/auth/auth.guard.ts"),read("../apps/api/src/supabase/supabase.service.ts"),read("../apps/api/src/extension-ingestion/job-description.service.ts")]);
  assert.match(jwt,/jwtVerify/);assert.match(jwt,/issuer/);assert.match(jwt,/audience/);assert.match(jwt,/payload\.sub/);
  assert.match(guard,/Bearer/);assert.match(supabase,/accessToken: async \(\) => token/);assert.match(supabase,/Authorization: `Bearer \$\{token\}`/);assert.match(service,/user_id: user\.id/);
  assert.doesNotMatch(`${supabase}${service}`,/createClient\([^)]*service/i);
});

test("backend foundation configures standard errors, request IDs, CORS, Swagger, throttling, and graceful shutdown",async()=>{
  const [main,module,controller,filter,middleware]=await Promise.all([read("../apps/api/src/main.ts"),read("../apps/api/src/app.module.ts"),read("../apps/api/src/extension-ingestion/job-description.controller.ts"),read("../apps/api/src/common/errors/api-exception.filter.ts"),read("../apps/api/src/common/middleware/request-id.middleware.ts")]);
  assert.match(main,/enableCors/);assert.match(main,/SwaggerModule/);assert.match(main,/enableShutdownHooks/);assert.match(main,/forbidNonWhitelisted: true/);
  assert.match(module,/ThrottlerGuard/);assert.match(controller,/@Throttle/);assert.match(filter,/requestId/);assert.match(middleware,/X-Request-ID/);
});

test("shared contracts and required API documentation exist",async()=>{
  const [contracts,architecture,auth,errors,ingestion,jobReads,applications]=await Promise.all([read("../packages/contracts/src/index.ts"),read("../docs/architecture/backend-api-v0.7.2.md"),read("../docs/api/authentication.md"),read("../docs/api/errors.md"),read("../docs/api/extension-ingestion.md"),read("../docs/api/job-descriptions.md"),read("../docs/api/applications.md")]);
  for(const name of ["ApiErrorResponse","AuthenticatedUser","CreateJobDescriptionRequest","HealthResponse","RequestMetadata","JobDescriptionListQuery","CategoryLookupItem","IndustryDomainLookupItem"])assert.match(contracts,new RegExp(name));
  for(const document of [architecture,auth,errors,ingestion,jobReads,applications])assert.ok(document.length>200);
});

test("dashboard mutations use the API while extension hot paths use caller-scoped RLS",async()=>{
  const [dashboardApplications,dashboardBulk,extensionApplications]=await Promise.all([read("../dashboard/src/features/applications/application-service.js"),read("../dashboard/src/features/bulk-applications/bulk-service.js"),read("../extension/services/application-service.js")]);
  const dashboardSource=`${dashboardApplications}${dashboardBulk}`;
  assert.match(dashboardSource,/\/api\/v1\/applications/);assert.match(dashboardSource,/\/api\/v1\/applications\/bulk-(?:preview|create)/);assert.match(dashboardSource,/\/api\/v1\/application-batches/);
  assert.doesNotMatch(dashboardSource,/\.rpc\(|\.from\(["']applications?["']\)|\.from\(["']application_screenshots["']\)|\.storage\.from/);
  assert.match(extensionApplications,/\.rpc\("list_my_applications_v20"/);
  assert.match(extensionApplications,/\.rpc\("update_application_status_v101"/);
  assert.match(extensionApplications,/\.from\("application_screenshots"\)/);
  assert.match(extensionApplications,/storage\.from\(bucket\)\.upload/);
});

test("all remaining business services use the backend; only Supabase Auth stays client-side",async()=>{
  const files=["../dashboard/src/services/access-service.js","../dashboard/src/services/admin-user-service.js","../dashboard/src/services/profile-service.js","../dashboard/src/services/business-overview-service.js","../extension/services/tailoring-job-service.js"],source=(await Promise.all(files.map(read))).join("\n");
  for(const route of ["/api/v1/admin","/api/v1/profile","/api/v1/business-overview","/api/v1/tailoring-jobs"])assert.match(source,new RegExp(route.replaceAll("/","\\/")));
  assert.doesNotMatch(source,/client\.(?:rpc|from)|client\.storage|\.storage\.from/);
});
