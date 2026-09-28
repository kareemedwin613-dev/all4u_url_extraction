# Reference resume templates — stage 1

Six unique reference PDFs were supplied (the first link was duplicated). They are implemented as new immutable layout keys; no private reference PDFs or candidate text are committed.

| Reference | Key | Layout |
| --- | --- | --- |
| Bradley | `ALEGREYA_CLASSIC_V1` | Centered serif header; ruled headings; single-column skills before experience |
| Derek | `AMIRI_COMPACT_V1` | Inline header; thin rules; four-column skills after education |
| William | `LORA_BANDS_V1` | Stacked header; gray bands; two-column skills before experience |
| Michael | `CRIMSON_BANDS_V1` | Inline header; gray bands; two-column skills after education |
| John | `TITILLIUM_BANNER_V1` | Blue banner; icon headings; three-column skills before experience |
| Eric | `TITILLIUM_EXPERIENCE_V1` | Blue banner; experience first; single-column skills before education |

## Behavior

- The existing content-generation and automatic approval/PDF pipeline is unchanged. Rendering does not call AI.
- Migration v3.128 changes the uniform random-selection pool to these six keys only. The twelve legacy keys and renderer remain available for existing records and recovery; no stored PDFs, applications, prompts, or previews are rewritten.
- The existing recovery template selector knows the six new keys through the API catalog. A new template-control dashboard is **not** part of this stage.
- The existing top-30 displayed skill limit and grouping logic are retained. Group names and technologies come from the approved content, not the sample candidates.
- Candidate identity, role metadata, dates, education, and certifications come from the source. Generated summary and role bullets come from the approved preview. No separate environment rows or page-number footer are added to these reference layouts.
- Professional Highlights is omitted because the current approved-preview contract has no dedicated highlights section. No content is invented or duplicated to fill it.
- Text remains selectable/searchable; icons and decorative bands are vector shapes, not screenshots. Column content is emitted left-column first for extraction. This is tested text extraction, not a guarantee for every ATS vendor.
- Each style has measured US Letter margins, font sizes, line spacing, and column widths. Page count and wrapping vary with the candidate's content; fonts are not shrunk to force a fixed number of pages. Blank footer-only pages are avoided, and headings/role headers are kept with initial content.
- The supplied fonts are static Latin Fontsource faces (OFL licenses included); full multilingual font fallback is not implemented. Icons are vector recreations, not original source assets. These are close design recreations, not a claim of pixel-identical reproduction.

## Preview and QA

From the repository root:

```sh
npm run templates:preview
```

This builds the API and generates **12 synthetic sample PDFs**, short and long for each layout, plus all-page PNG contact sheets and a page-count report under `artifacts/template-previews/`. It does not access Supabase, alter application records, or consume AI tokens. Output is git-ignored. Inspect these before production activation.

Relevant tests:

```sh
node --test tests/reference-resume-templates.test.js
cd apps/api
node --import tsx --test test/reference-resume-pdf.spec.ts test/tailored-resume-pdf-v19.spec.ts
```

Tests cover all layouts, font embedding, section order, preserved text, bounds, long words, multi-page documents, absence of empty trailing pages, legacy record preservation, random-selection keys, and manager-only template selection/locking.

## Deployment order

1. Review the generated sample PDFs.
2. Deploy the API code **with `apps/api/assets/resume-fonts`**. Vercel's `includeFiles` explicitly includes this directory. Keep it at the same relative location for other deployment targets.
3. Verify the API template catalog includes the six new keys.
4. Apply `202609281000_v3_128_reference_resume_templates.sql` to the intended Supabase project. This extends the existing key constraints and selector and replaces the random-selection function; no new tables or columns are introduced.
5. Run one new tailoring job and verify its selected key, PDF, and application attachment before starting a larger batch.

Do not activate the migration against an older API: it cannot render the new keys. Rolling back only the API after new-key jobs exist is also unsafe; retain new-key rendering support while changing the selection pool if rollback is needed.
