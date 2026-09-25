import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { downloadApplicationCoverLetter } from "../extension/services/application-service.js";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("the Application cover letter prefers the tailored letter, falls back to the base letter, and keeps Application access", async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated;
    create function application_actor_can_view(uuid) returns boolean language sql stable as $$ select $1::text = current_setting('test.viewer',true) $$;
    create table resumes(id uuid primary key,resume_type text,parent_resume_id uuid,status text,resume_number int,candidate_name text,candidate_email text,candidate_phone text,
      address_city text,address_state_region text,linkedin_url text,cover_letter_text text);
    create table applications(id uuid primary key,resume_id uuid,assigned_to uuid,application_number int);
    insert into resumes values
      ('${id(1)}','ORIGINAL',null,'ACTIVE',11,'Jordan Lee','j@example.com','555','Miami','FL',null,'Base letter.'),
      ('${id(2)}','TAILORED','${id(1)}','ACTIVE',12,'Jordan Lee','j@example.com','555','Miami','FL',null,'Tailored letter.'),
      ('${id(3)}','TAILORED','${id(1)}','ACTIVE',13,'Jordan Lee','j@example.com','555','Miami','FL',null,null),
      ('${id(4)}','ORIGINAL',null,'ACTIVE',14,'Sam Roe',null,null,null,null,null,null);
    insert into applications values('${id(21)}','${id(2)}','${id(9)}',1),('${id(22)}','${id(3)}','${id(9)}',2),('${id(23)}','${id(1)}','${id(9)}',3),('${id(24)}','${id(4)}','${id(9)}',4);
    select set_config('test.viewer','${id(9)}',false);
  `);
  await db.exec(read("../supabase/migrations/202609251500_v3_123_application_cover_letter_download.sql"));
  const letter = async n => (await db.query("select get_application_cover_letter_v123($1) result", [id(n)])).rows[0].result;
  assert.deepEqual([(await letter(21)).kind, (await letter(21)).text], ["TAILORED", "Tailored letter."]);
  assert.deepEqual([(await letter(22)).kind, (await letter(22)).text], ["BASE", "Base letter."]);
  assert.deepEqual([(await letter(23)).kind, (await letter(23)).text, (await letter(23)).applicationNumber], ["BASE", "Base letter.", 3]);
  await assert.rejects(() => letter(24), /APPLICATION_COVER_LETTER_NOT_FOUND/);
  await db.exec("select set_config('test.viewer','someone-else',false)");
  await assert.rejects(() => letter(21), /APPLICATION_RESUME_UNAVAILABLE/);
});

test("the extension downloads the rendered cover letter PDF under the generated filename", async t => {
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } }, error: null }) } };
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  let requested;
  globalThis.fetch = async (url, options) => {
    requested = { url: String(url), authorization: options.headers.Authorization };
    return new Response(JSON.stringify({ data: { kind: "TAILORED", filename: "Jordan Lee Cover Letter - App 7.pdf", mimeType: "application/pdf", contentBase64: "JVBERi0xLjQ=" } }), { status: 200 });
  };
  let downloadOptions;
  const result = await downloadApplicationCoverLetter(client, "https://api.example.com", id(21), async options => { downloadOptions = options; return 5; });
  assert.equal(requested.url, `https://api.example.com/api/v1/applications/${id(21)}/cover-letter`);
  assert.equal(requested.authorization, "Bearer jwt");
  assert.deepEqual(downloadOptions, { url: "data:application/pdf;base64,JVBERi0xLjQ=", filename: "Jordan Lee Cover Letter - App 7.pdf", saveAs: false, conflictAction: "uniquify" });
  assert.deepEqual(result, { kind: "TAILORED", downloadId: 5, downloadName: "Jordan Lee Cover Letter - App 7.pdf" });

  globalThis.fetch = async () => new Response(JSON.stringify({ data: { kind: "OTHER", mimeType: "application/pdf", contentBase64: "JVBERi0xLjQ=" } }), { status: 200 });
  await assert.rejects(() => downloadApplicationCoverLetter(client, "https://api.example.com", id(21), async () => 1), /metadata is invalid/);
});

test("each Application card offers Download Cover Letter beside Download Resume", () => {
  const card = read("../extension/sidepanel/components/ApplicationCard.jsx"), view = read("../extension/sidepanel/views/MyApplicationsView.jsx");
  assert.match(card, /Download Resume<\/Button>\s*\{onDownloadCoverLetter && <Button[\s\S]*?DOWNLOAD_COVER_LETTER[\s\S]*?>Download Cover Letter<\/Button>\}/);
  assert.match(view, /onDownloadCoverLetter=\{downloadCoverLetter\}/);
});
