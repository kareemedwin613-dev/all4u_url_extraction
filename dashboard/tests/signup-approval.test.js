import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateSignUp } from "../src/shared/validation.js";
import { parseUserQuery } from "../src/shared/query-state.js";
import { ACCESS_STATE_COPY } from "../src/access/access-state-copy.js";

test("sign-up validation requires full name, email, and strong password", () => {
  assert.equal(
    validateSignUp({
      email: "applier@example.com",
      password: "secret12",
      fullName: "Alex Applier",
      confirmPassword: "secret12",
    }).valid,
    true,
  );
  assert.equal(
    validateSignUp({
      email: "applier@example.com",
      password: "secret12",
      fullName: "",
      confirmPassword: "secret12",
    }).valid,
    false,
  );
  assert.match(
    validateSignUp({
      email: "applier@example.com",
      password: "short",
      fullName: "Alex",
      confirmPassword: "short",
    }).errors.password,
    /at least 8/i,
  );
  assert.equal(
    validateSignUp({
      email: "applier@example.com",
      password: "secret12",
      fullName: "Alex",
      confirmPassword: "other",
    }).valid,
    false,
  );
});

test("user query accepts Pending Approval role filter NONE", () => {
  assert.equal(parseUserQuery("roleCode=NONE").roleCode, "NONE");
  assert.equal(parseUserQuery("roleCode=APPLIER").roleCode, "APPLIER");
  assert.equal(parseUserQuery("roleCode=HACKER").roleCode, "");
});

test("pending access copy describes admin approval", () => {
  assert.match(ACCESS_STATE_COPY.PENDING_ACCESS.message, /administrator/i);
  assert.match(ACCESS_STATE_COPY.PENDING_ACCESS.message, /role/i);
});

test("login page exposes sign-up with required full name", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /signUp/);
  assert.match(app, /validateSignUp/);
  assert.match(app, /Full Name/);
  assert.match(app, /New member\? Sign Up/);
  assert.match(app, /Sign Up/);
});

test("auth service registers full_name metadata on sign-up", async () => {
  const source = await readFile(
    new URL("../src/services/auth-service.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /export async function signUp/);
  assert.match(source, /full_name/);
  assert.match(source, /signUp\(/);
});

test("admin users UI supports pending approval review", async () => {
  const page = await readFile(
    new URL("../src/pages/admin-pages.jsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /Pending Approvals/);
  assert.match(page, /Pending Approval/);
  assert.match(page, /Approve And Save Roles/);
  assert.match(page, /Reject/);
  assert.match(page, /USER_ROLE_PENDING/);
});

test("admin list users migration accepts NONE role filter", async () => {
  const sql = await readFile(
    new URL(
      "../../supabase/migrations/202608240069_v3_9_admin_list_pending_users.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(sql, /v_role_code = 'NONE'/);
  assert.match(sql, /cardinality\(users\.role_codes\)/);
});
