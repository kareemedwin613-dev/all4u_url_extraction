import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  passwordResetRedirectUrl,
  requestPasswordReset,
  updatePassword,
} from "../src/services/auth-service.js";
import {
  validateNewPassword,
  validatePasswordResetRequest,
} from "../src/shared/validation.js";

test("password reset request validation requires an email", () => {
  assert.equal(validatePasswordResetRequest("user@example.com").valid, true);
  assert.equal(validatePasswordResetRequest("bad").valid, false);
});

test("new password validation requires length and confirmation", () => {
  assert.equal(
    validateNewPassword({ password: "secret12", confirmPassword: "secret12" }).valid,
    true,
  );
  assert.match(
    validateNewPassword({ password: "short", confirmPassword: "short" }).errors.password,
    /at least 8/i,
  );
  assert.equal(
    validateNewPassword({ password: "secret12", confirmPassword: "other" }).valid,
    false,
  );
});

test("password reset redirect uses the dashboard origin path", () => {
  assert.equal(
    passwordResetRedirectUrl({ origin: "http://127.0.0.1:4174", pathname: "/" }),
    "http://127.0.0.1:4174/",
  );
  assert.equal(
    passwordResetRedirectUrl({ origin: "https://app.example.com", pathname: "/dashboard/" }),
    "https://app.example.com/dashboard/",
  );
});

test("requestPasswordReset and updatePassword call Supabase Auth helpers", async () => {
  const calls = [];
  const client = {
    auth: {
      resetPasswordForEmail: async (email, options) => {
        calls.push(["reset", email, options]);
        return { data: {}, error: null };
      },
      updateUser: async (body) => {
        calls.push(["update", body]);
        return { data: { user: { id: "user-1" } }, error: null };
      },
    },
  };
  const result = await requestPasswordReset(client, "user@example.com", {
    origin: "http://127.0.0.1:4174",
    pathname: "/",
  });
  assert.match(result.message, /reset link/i);
  await updatePassword(client, "newpass12");
  assert.deepEqual(calls[0], [
    "reset",
    "user@example.com",
    { redirectTo: "http://127.0.0.1:4174/" },
  ]);
  assert.deepEqual(calls[1], ["update", { password: "newpass12" }]);
});

test("login UI exposes Forgot Password and Choose New Password recovery flow", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /Forgot Password\?/);
  assert.match(app, /Choose New Password/);
  assert.match(app, /requestPasswordReset/);
  assert.match(app, /updatePassword/);
  assert.match(app, /PASSWORD_RECOVERY/);
  assert.match(app, /passwordRecovery/);
  const clientSource = await readFile(
    new URL("../src/services/supabase-client.js", import.meta.url),
    "utf8",
  );
  assert.match(clientSource, /detectSessionInUrl:\s*true/);
  assert.match(clientSource, /flowType:\s*"pkce"/);
});
