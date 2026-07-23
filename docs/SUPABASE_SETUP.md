# Supabase setup

1. Create a standard Supabase project and record its `https://PROJECT_REF.supabase.co` URL and publishable/anon client key. Never use the secret or legacy service-role key in the extension.
2. Review every SQL file under `supabase/migrations/`. The migrations create application tables, validation triggers, RLS policies, grants, and private Storage buckets.
3. Install dependencies and authenticate the CLI:

   ```sh
   npm install
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

4. Apply `supabase/seed.sql` if your workflow does not apply seeds automatically. Verify the seven primary categories and their subcategories.
5. In Table Editor, verify RLS is enabled for `categories`, `job_descriptions`, `resumes`, `tailoring_jobs`, `profiles`, `roles`, and `user_roles`.
   The legacy `user_profiles` attribution table remains for compatibility. The authoritative v0.5 application status is in `profiles`; its `id` is the same UUID as the corresponding Supabase Auth user. Passwords and credentials remain exclusively in Supabase Auth.
6. In Storage, verify `original-resumes` and `tailored-resumes` are private and limited to 5 MiB with the documented MIME types.
7. In Authentication, create the first email/password user through the Dashboard. Public signup should remain disabled for a private MVP.
8. Run `npm run build`, load `extension/dist`, save the project URL and publishable key in Settings, test the connection, and sign in.

`npm run test:db` uses the local Supabase CLI database test environment. It requires the CLI, Docker, and a started/local database.
