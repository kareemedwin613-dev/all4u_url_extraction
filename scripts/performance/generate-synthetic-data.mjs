// Opt-in synthetic data generator for local/isolated staging load testing.
//
// SAFETY (read before running):
// - Never runs automatically; requires --confirm on the command line.
// - Never reads the app's own dashboard/.env.local or extension config, so it can never
//   accidentally target whatever Supabase project a developer has configured for real use.
//   It requires its own explicit env vars: SYNTH_SUPABASE_URL, SYNTH_SUPABASE_SERVICE_KEY.
// - SYNTH_SUPABASE_SERVICE_KEY must be a service-role key. That is intentional and safe HERE:
//   this is an offline developer tool run manually from a terminal, not frontend code shipped
//   to a browser or extension - the "never put a service-role key in frontend code" rule this
//   repo otherwise enforces does not apply to a local seeding script. Never commit this key,
//   never put it in a CLI flag (shell history), and only ever point it at an isolated staging
//   or local project - never production, never a shared free-tier project.
// - Requires an existing --actor-user-id (a real profile id already in the target project,
//   e.g. an Admin or Applying Manager) to attribute synthetic rows to, rather than fabricating
//   auth identities.
// - Prints the target project URL host before writing anything.
// - Tags every row it creates ("[SYNTH]" prefix on company/candidate name) so --cleanup can
//   find and remove them without touching real data.
// - Never uploads real resume files - synthetic resumes get fake storage metadata pointing at
//   objects that are never actually written to Storage.
//
// Usage:
//   SYNTH_SUPABASE_URL=https://xxxx.supabase.co SYNTH_SUPABASE_SERVICE_KEY=... \
//     node scripts/performance/generate-synthetic-data.mjs --confirm --actor-user-id=<uuid> --profile=small
//   node scripts/performance/generate-synthetic-data.mjs --confirm --actor-user-id=<uuid> --cleanup

import { createClient } from "@supabase/supabase-js";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? true];
  }),
);

const PROFILES = {
  small: { jobs: 10000, resumes: 2000, applications: 50000 },
  medium: { jobs: 100000, resumes: 10000, applications: 500000 },
  large: { jobs: 250000, resumes: 25000, applications: 1000000 },
};

const TAG = "[SYNTH]";
const BATCH_SIZE = 500;

function fail(message) {
  console.error(`Refusing to run: ${message}`);
  process.exit(1);
}

if (!args.confirm) fail("pass --confirm to acknowledge this will write data to the target project.");

const url = process.env.SYNTH_SUPABASE_URL;
const serviceKey = process.env.SYNTH_SUPABASE_SERVICE_KEY;
if (!url || !serviceKey) {
  fail(
    "set SYNTH_SUPABASE_URL and SYNTH_SUPABASE_SERVICE_KEY (a service-role key, isolated/staging project only). " +
      "This script deliberately never reads dashboard/.env.local or extension config.",
  );
}
if (!args.cleanup && !args["actor-user-id"]) {
  fail("pass --actor-user-id=<uuid> for an existing profile in the target project to attribute rows to.");
}

const host = new URL(url).host;
console.log(`Target project: ${host}`);
console.log(args.cleanup ? "Mode: cleanup (deleting previously tagged synthetic rows)" : `Mode: generate (${args.profile || "small"} profile)`);

const client = createClient(url, serviceKey, { auth: { persistSession: false } });

const COMPANIES = ["Globex", "Initech", "Umbrella", "Wonka", "Stark", "Wayne", "Hooli", "Pied Piper", "Soylent", "Massive Dynamic"];
const TITLES = ["Software Engineer", "Data Engineer", "Product Manager", "QA Engineer", "DevOps Engineer", "Business Analyst"];
const FIRST_NAMES = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Sam", "Drew", "Jamie", "Cameron"];
const LAST_NAMES = ["Rivera", "Chen", "Patel", "Kowalski", "Okafor", "Nguyen", "Silva", "Andersson", "Haddad", "Kim"];
const rand = (list) => list[Math.floor(Math.random() * list.length)];
const fakeSha256 = () => Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

async function cleanup() {
  console.log("Deleting synthetic applications, resumes, and job descriptions...");
  const { data: jobs } = await client.from("job_descriptions").select("id").ilike("company", `${TAG}%`);
  const { data: resumes } = await client.from("resumes").select("id").ilike("candidate_name", `${TAG}%`);
  const jobIds = (jobs || []).map((row) => row.id);
  const resumeIds = (resumes || []).map((row) => row.id);
  if (jobIds.length) await client.from("applications").delete().in("job_description_id", jobIds);
  if (resumeIds.length) await client.from("applications").delete().in("resume_id", resumeIds);
  if (jobIds.length) await client.from("job_descriptions").delete().in("id", jobIds);
  if (resumeIds.length) await client.from("resumes").delete().in("id", resumeIds);
  console.log(`Removed ${jobIds.length} synthetic job descriptions and ${resumeIds.length} synthetic resumes (and any dependent applications).`);
}

async function insertBatches(table, rows, label) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const { error } = await client.from(table).insert(chunk);
    if (error) throw new Error(`${label} insert failed at row ${i}: ${error.message}`);
    process.stdout.write(`\r${label}: ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }
  console.log("");
}

async function generate() {
  const profile = PROFILES[args.profile || "small"];
  if (!profile) fail(`unknown --profile (use small, medium, or large).`);
  const actorId = args["actor-user-id"];
  const { data: category } = await client.from("categories").select("id").eq("active", true).limit(1).maybeSingle();
  if (!category) fail("no active category found in the target project - seed at least one category first.");

  const jobRows = Array.from({ length: profile.jobs }, () => ({
    user_id: actorId,
    company: `${TAG} ${rand(COMPANIES)} ${Math.floor(Math.random() * 100000)}`,
    job_title: rand(TITLES),
    category_id: category.id,
    description_text: `${TAG} synthetic job description. ${"Responsibilities and requirements text. ".repeat(20)}`,
    status: "ACTIVE",
  }));
  await insertBatches("job_descriptions", jobRows, "job_descriptions");

  const resumeRows = Array.from({ length: profile.resumes }, () => {
    const first = rand(FIRST_NAMES), last = rand(LAST_NAMES);
    return {
      user_id: actorId,
      candidate_name: `${TAG} ${first} ${last}`,
      resume_name: `${first} ${last} Resume`,
      primary_category_id: category.id,
      seniority: "MID",
      skills: ["javascript", "sql"],
      industries: [],
      resume_text: `${TAG} synthetic resume text. ${"Experience and education content. ".repeat(20)}`,
      storage_bucket: "original-resumes",
      storage_path: `${actorId}/synthetic-${crypto.randomUUID()}.pdf`,
      original_filename: "synthetic.pdf",
      mime_type: "application/pdf",
      file_size_bytes: 1024,
      file_sha256: fakeSha256(),
      status: "ACTIVE",
    };
  });
  await insertBatches("resumes", resumeRows, "resumes");

  const { data: jobIdsData } = await client.from("job_descriptions").select("id").ilike("company", `${TAG}%`);
  const { data: resumeIdsData } = await client.from("resumes").select("id").ilike("candidate_name", `${TAG}%`);
  const jobIds = (jobIdsData || []).map((row) => row.id);
  const resumeIds = (resumeIdsData || []).map((row) => row.id);
  const seenPairs = new Set();
  const applicationRows = [];
  while (applicationRows.length < profile.applications && applicationRows.length < jobIds.length * resumeIds.length) {
    const jobId = rand(jobIds), resumeId = rand(resumeIds), key = `${jobId}:${resumeId}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    applicationRows.push({
      job_description_id: jobId,
      resume_id: resumeId,
      work_status: "UNASSIGNED",
      created_by: actorId,
    });
  }
  await insertBatches("applications", applicationRows, "applications");

  console.log(`Done. Created ${jobRows.length} job descriptions, ${resumeRows.length} resumes, ${applicationRows.length} applications, all tagged "${TAG}".`);
  console.log("Run with --cleanup to remove them when you're finished.");
}

try {
  if (args.cleanup) await cleanup();
  else await generate();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
