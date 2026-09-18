# Resuming application creation

Starting **Create Applications** from selected Job Descriptions now creates a browser-local draft with its own URL. No database migration is required.

1. Select JDs, open **Create Applications**, and choose your resumes and matching method.
2. In AI-score mode, create the scoring command and run it in your terminal.
3. You can navigate to another dashboard page or refresh without losing the draft. Updated batch commands run in the background; the terminal can close, but keep the computer awake. See [Background workers](background-workers.md).
4. Use **Resume batch creation** in the header, or **Application Batches → In-progress creation drafts → Resume**.
5. The page restores your JD/resume selection, matching method, batch name, active tab, and manually deselected eligible pairs. It fetches current scores and eligibility from the API; completed, current evaluations are reused. Newly eligible pairs are selected unless you previously deselected them.
6. Create the selected Applications when ready. Successful creation removes the draft; the resulting batch remains in Application Batches.

## Evaluation progress

In AI-score mode, **Evaluation progress** shows a progress bar, finished/remaining totals, and counts for completed, processing, queued, eligible, not eligible, and failed pairs. **Not eligible** includes completed below-threshold scores and insufficient-data results; pending, unstarted/stale, and failed evaluations are not classified as negative results. Unstarted/stale pairs still count as remaining work. The existing preview refresh updates these counts every five seconds while work is queued or processing, without adding another polling request. Use **Refresh progress** for a manual update.

Progress covers all candidate pairs in the selected JDs and resumes, including reused current scores, regardless of checked rows or table filters. Duplicate and blocked pairs are excluded. A below-threshold score is a completed evaluation; failed/insufficient-data evaluations also count as finished. Failed evaluations keep their own counter, while insufficient-data results appear under **Not eligible**. The combinations table's **Evaluation status** column still shows each pair's detailed state and failure code when available.

Reopening a draft reloads current progress. Failed refreshes are visibly marked stale. Truncated previews show partial counts without an overall percentage. Server-reported queued/processing states do not prove that the background worker is alive; check `npm run workers:status` for local runner health. Category/subcategory mode has no AI evaluation progress.

## Estimated time

**Evaluation progress** and **Tailoring Batch details** show estimated time remaining and average time per JD/resume pair or resume. These are approximate processing estimates, not promised completion times.

- Tailoring uses successful per-item durations already returned by the batch API, including generation and PDF creation. Follow-up score comparisons are not included in those recorded durations and can extend the batch; the page labels this limitation.
- Evaluation learns from successful jobs whose starts/completions are observed on the page. Cached scores and jobs already running when the page opens do not count as fast completions. Until a usable sample is available, the page shows **Estimating…**. Reopening an evaluation draft or changing its selection starts this learning again.
- Estimates use up to 20 successful samples, observed parallel processing, and elapsed time for running items when known. They update with existing progress reads; there are no additional polling requests, worker changes, or database migrations.
- Paused, cancelled, stale, partially loaded, unqueued, or unexpectedly slow work shows an explanatory status instead of an unreliable countdown. Failed items are excluded from remaining work until retried. Queued work without observed processing waits for the runner before projecting a finish.

Drafts belong to the signed-in account and API deployment in this browser. They do not sync across devices or browsers. Browser-storage failures show a warning, and drafts then survive only in the current dashboard session. Clearing browser data removes local drafts, not server-side scores or Applications.

Runner tickets and commands, credentials, scores, and resume/JD content are not stored in drafts. If the terminal has stopped, use **Create / resume scoring command** to obtain another command for unfinished work. Merely reopening a draft never starts evaluation or creates Applications.

After an interrupted creation request, check Application Batches before retrying. The draft retains the retry key for an identical request, and server-side duplicate checks still apply. **Discard** removes only the local draft; it does not cancel terminal evaluation or delete scores/Applications.

Work started before this change has no saved draft. Reselect the same JDs and resumes to start one; existing current scores can still be reused.
