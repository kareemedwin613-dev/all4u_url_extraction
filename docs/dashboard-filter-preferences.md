# Remembered dashboard filters

Applied filters are saved automatically in browser `localStorage`, scoped by signed-in user, API environment and page. No SQL migration, API endpoint or database request is required for filter persistence.

Covered pages: Overview reporting dates and chart/table searches, Job Descriptions, Resumes, Applications, Admin Users, Applier scorecard dates, Applier Workloads search, Tailored Resumes status, Application Batches and batch outcome filters. Bulk-creation preview filters and page size are saved separately from the existing workflow draft. Existing URL-based sorting and page sizes are retained as preferences. Applications and Overview table client-side sorting also retain their sort indicators; their existing sorting scope is unchanged (currently loaded rows, not a new server-side sort).

On a bare page link (including sidebar navigation), saved filters are restored before that page loads its data. The restored filters are reflected in the URL. Explicit URL queries take precedence as a whole: they are not merged with hidden saved filters. Browser Back/Forward retains its explicit URL state. Returning through the sidebar starts at page 1; a link or refresh with an explicit page number retains that page.

Reset/Clear filters uses `filters=default` where necessary to distinguish an intentional reset from a bare navigation link. Default values remove that page's saved preference. Individual filter controls clear just their own values, following the existing UI behavior. The Overview date Reset returns to Today. Search boxes that require Enter/Search remember applied searches, not unfinished typing.

Relative date presets store the preset, not calculated timestamps. This Week still means the current week on a later visit. Custom dates remain fixed. Invalid, oversized, old-version or unavailable storage falls back safely; disabled/full browser storage retains changes only during the current session.

Only allowlisted filter fields are saved. This feature never stores table row selections, action confirmations, tickets, session credentials, fetched records or pagination cursors. Existing bulk-creation drafts keep their separate behavior. Switching accounts remounts page state and isolates preferences.

Preferences do not sync across devices or browser profiles and are removed by clearing this site's browser storage. Deploy the dashboard to activate this feature; there are no backend changes for it.
