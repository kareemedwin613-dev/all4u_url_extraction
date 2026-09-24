# Evaluation archive

AI scoring is no longer an active application-creation step. Single and bulk
creation default to category/subcategory eligibility. Software Engineering requires
the JD subcategory when specified; other categories retain primary-only matching.
Active original resumes, approved/open JDs, duplicates, bans and assignment
permissions continue to be checked. This does not unblock jobs or restore cancelled
applications.

Existing scores and creation snapshots remain historical. Application details
offer a collapsed read-only history panel, without scoring actions or polling.
Saved SCORE drafts reopen as CATEGORY and discard their old submission retry key;
the new preview must be reviewed before creation. Prior batch records are unchanged.

Tailoring still generates/attaches PDFs but no longer queues or runs comparisons.
Matching source/tests remain in the repository for history. `matching:run` explains
the archive and does not start a worker. Status/log/stop commands still work.

## Rollout

1. Finish or stop existing evaluation workers using `npm run workers:stop -- <run-id>`.
   Closing the monitor alone does not stop the worker. Pause tailoring during rollout.
2. Review pending migrations with `npx supabase db push --dry-run`, then apply
   `202609221000_v3_103_archive_evaluation.sql` through the normal migration process.
3. Deploy the API and dashboard together, and update each local worker checkout.
4. Reload the dashboard and review category/subcategory eligibility before creating.
5. Resume tailoring. No evaluation command is required after the PDF is created.

The database refuses new evaluation requests and old runner calls; existing queued
assessments are retained, not processed or presented as completed. The API returns
EVALUATION_ARCHIVED for stale SCORE requests rather than silently changing their
meaning. No production migration, deployment or worker termination is performed
by editing these files.
