# Structured Resume editor (v0.9.1)

Applying Managers and Admins can open a Resume and choose **Edit Structured Resume**. The editor updates the existing canonical Resume; it does not create a candidate or section table.

Editable sections are summary, skills, professional experience, education, and certifications. Employment, education, and certification records can be added, removed, edited, and reordered. **Save Structured Resume** sends one authenticated request to the NestJS API, which executes one user-scoped PostgreSQL function. The function rechecks the manager role and atomically replaces the structured arrays on `resumes.structured_content`.

## Database setup

Apply `supabase/migrations/202607310031_v0_9_1_structured_resume_editor.sql` after the earlier migrations:

```powershell
npx supabase db push
```

The migration preserves unrelated keys in `structured_content`, keeps legacy education text, enables no privileged client access, and grants the new function only to `authenticated`. Existing Resume RLS and the database-backed manager check remain in force.

No AI service is used. Dates and required fields must be reviewed by the user before saving.
