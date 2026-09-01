import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("user avatar services and UI are wired to protected API routes", async () => {
  const [service, avatar, editor, accessPage, controller, migration] = await Promise.all([
    read("../src/services/avatar-service.js"),
    read("../src/components/user-avatar.jsx"),
    read("../src/components/profile-avatar-editor.jsx"),
    read("../src/pages/access-pages.jsx"),
    read("../../apps/api/src/platform/platform.controller.ts"),
    read("../../supabase/migrations/202608280095_v3_35_user_avatars.sql"),
  ]);

  assert.match(service, /getUserAvatarUrl/);
  assert.match(service, /\/api\/v1\/users\/\$\{encodeURIComponent\(userId\)\}\/avatar\/url/);
  assert.match(service, /uploadMyAvatar/);
  assert.match(service, /\/api\/v1\/profile\/avatar/);
  assert.match(service, /uploadUserAvatar/);
  assert.match(service, /\/api\/v1\/admin\/users\/\$\{encodeURIComponent\(userId\)\}\/avatar/);
  assert.match(avatar, /getUserAvatarUrl/);
  assert.match(avatar, /personInitials/);
  assert.match(editor, /ProfileAvatarEditor/);
  assert.match(accessPage, /ProfileAvatarEditor/);
  assert.match(controller, /:id\/avatar\/url/);
  assert.match(controller, /"avatar"/);
  assert.match(controller, /users\/:id\/avatar/);
  assert.match(migration, /user-avatars/);
  assert.match(migration, /set_user_avatar_v35/);
  assert.match(migration, /hasAvatar/);
});

test("admin users table renders avatars from list metadata", async () => {
  const [page, migration] = await Promise.all([
    read("../src/pages/admin-pages.jsx"),
    read("../../supabase/migrations/202608280096_v3_36_admin_list_users_avatars.sql"),
  ]);
  assert.match(page, /UserAvatar/);
  assert.match(page, /has_avatar/);
  assert.match(page, /admin-user-name-cell/);
  assert.match(migration, /has_avatar/);
  assert.match(migration, /avatar_updated_at/);
});
