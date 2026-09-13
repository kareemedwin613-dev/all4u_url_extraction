# Application status updates and confirmation screenshots (extension)

Migration `202607260018_application_screenshots.sql` adds a private `application-screenshots` Storage bucket (5 MiB limit, PNG/JPG/WEBP/PDF only) and a new `application_screenshots` table, one row per uploaded file, supporting multiple screenshots per Application. Table access is read-only for `authenticated`; `attach_application_screenshot` and `remove_application_screenshot` are the only way to write rows, and both authorize the same actor set already used by `update_application_progress`: an Applying Manager, an Admin, or the Application's assigned, active Applier.

`update_application_progress` gains one new rule, for Appliers only: marking `application_status` `APPLIED` for the first time is blocked unless the Application already has an Application URL and at least one screenshot on file (`APPLICATION_APPLIED_REQUIRES_URL` / `APPLICATION_APPLIED_REQUIRES_SCREENSHOT`). Managers are exempt — the dashboard has no screenshot upload UI yet, so this only applies to the extension's Applier workflow. Everything else about the RPC (manager-only fields, protected-field gating, `applied_at` auto-set) is unchanged.

`list_applications_v07` additively returns `screenshot_count` per row so callers can show proof status without a second round trip; its signature, filters, and sort allowlist are unchanged, and the dashboard is unaffected.

Migration `202609121300_v3_81_application_screenshot_feedback.sql` adds `applications.screenshot_feedback` (≤2000 chars) plus `screenshot_feedback_by` / `screenshot_feedback_at`. Managers set or clear it through `set_application_screenshot_feedback_v381` / `PATCH /api/v1/applications/:id/screenshot-feedback`. The note covers the whole confirmation-screenshot set (not per file). Anyone who can open the Application can read it; Appliers also see it on My Applications (`list_my_applications_v20`) and in the extension Update Status modal. It is separate from shared Application `notes`.

Migration `202609121400_v3_82_application_list_screenshot_feedback.sql` returns `screenshot_feedback` / `screenshot_feedback_at` from `list_applications_v07` (and therefore `list_applications_v360`) so the Applications table can show a **Feedback** badge with a hover preview without opening the detail page. The extension My Applications cards use the same fields.

Migration `202609121500_v3_83_screenshot_feedback_filter.sql` adds `p_screenshot_feedback` (`HAS_FEEDBACK` / `NO_FEEDBACK`) to `list_applications_v07` / `list_applications_v360` / `list_my_applications_v20`. The dashboard Filters panel and extension My Applications filters expose it as **Screenshot feedback**.

The Chrome extension's "My Applications" tab (Applier-only) can now update Work Status, Application Status, and Application URL for its own assigned Applications, and attach/remove confirmation screenshots, from an "Update Status" action on each card. The list can also be filtered by resume name (client-side, over the already-fetched page).

Apply migrations in order, then rebuild the extension:

    npx supabase db push --dry-run --linked
    npx supabase db push --linked
    npm run build:extension

Never put a service-role key, secret key, or database password in browser or extension code.
