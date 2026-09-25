# Tailored cover letters

Migration: `202609251000_v3_119_tailored_cover_letters.sql`.

## Base cover letter (per original Resume)

- `resumes.cover_letter_text` holds the base letter body: paragraphs only, no header,
  greeting, sign-off, or signature. Managers edit it in **Resume → Base cover letter**.
- Uploading a cover letter file extracts its text automatically (PDF, DOCX, TXT) and saves
  it. Scanned or image-only files cannot be read; paste their text instead.
- **Resumes → Extract missing cover letter text** backfills every original Resume that has
  an uploaded file but no text. It never overwrites existing text. Review the results:
  extraction drops everything before the greeting and from the sign-off onward.
- The base letter is tailoring evidence in the candidate's own words. Keep every claim
  true; the tailored letter may reuse anything it states.

## Tailored cover letter (per Application)

- New jobs snapshot input contract `1.4` with compiler `v4`: the model context includes
  `sourceResume.coverLetter`, and the output schema requires `coverLetter`, generated in the
  same model call as the Resume. Existing `1.3` snapshots keep producing no letter.
- The worker enforces 3 to 4 body paragraphs (2 to 5 accepted), at most 450 words, and no
  greeting, sign-off, or placeholders, with the same single repair attempt as the Resume rules.
- On materialization, the approved `coverLetter` is copied to the TAILORED Resume's
  `cover_letter_text`. **Resume → Tailored cover letter → Download PDF** renders it on demand
  with the name and contact details from that Resume, the date, "Dear Hiring Manager,",
  and "Sincerely," plus the name. No cover letter file is stored for tailored Resumes.
- The Chrome extension does not fill cover letters yet.

## Rollout order

1. Apply the migration before deploying the API: the Resume detail query reads the new column.
2. Deploy the API and dashboard, then update every worker (contract `1.4` / `v4`).
   Older workers stop with "Update the tailoring worker" on new jobs.
3. Run the backfill, spot-check a few base letters, then draft-test a prompt.

Cover letter guidance lives in the fixed compiler contract, not in the editable prompts:
most prompts are near the 20,000-character limit, and they share a core that lists only
three outputs and forbids first-person pronouns. The contract makes `coverLetter` a required
fourth output and exempts it from the summary/bullet style rules, so prompts need no edits.

## Status

The v4 compiler was reverted by `202609251200_v3_120_revert_cover_letter_compiler.sql` before any v4 job was created: new jobs compile with contract v3 / input 1.3 and produce no cover letter. The `cover_letter_text` column and `set_resume_cover_letter_text_v119` remain (inert, no data). To re-enable, add a migration that reapplies the v3.119 compiler, source input, and provenance trigger, after every worker runs this branch.
