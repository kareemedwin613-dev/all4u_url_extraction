# Manual acceptance testing

- **Fresh install:** build/load `extension/dist`; expect Supabase Settings first and no legacy backend settings.
- **Configuration/auth:** test a valid standard project, sign in with a Dashboard-created user, close/reopen, and verify session restoration. Wrong passwords must show a generic error.
- **Paylocity regression:** extract job `3794874`; expect TruDataRx, Data Engineer, the current URL/host, full description beginning ABOUT TRUDATARX, and Data Engineering suggestion. No stale prior-page values may appear.
- **JD and duplicate:** save once; recapture/save; expect the existing record plus an explicit update choice, never silent overwrite.
- **Resume parsers:** upload non-sensitive TXT, DOCX, and text PDF files; review extracted text; expect a private object and one metadata row. An image-only PDF must leave neither object nor row.
- **Matching:** use active same-category and other-category resumes. Expect only same-category candidates, deterministic explanations, threshold preselection, and explicit confirmation below threshold.
- **Queue:** create two pairs, then repeat. Expect two PENDING rows and Already queued results without resetting statuses. Archive a resume and verify it leaves new matching while existing queue records remain.
- **Privacy:** with a second user, attempt to read the first user's rows and Storage paths; expect denial.
- **Removal audit:** search the built extension for legacy runtime backend terms; expect none.

Record actual results separately. These tests require a deployed Supabase project and Chrome and are not implied by local unit-test success.
