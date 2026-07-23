# Dashboard manual acceptance testing

Use non-production test accounts. Do not record passwords here.

Test User A should own at least two JDs across two categories (one active, one archived) and two resumes (one active, one archived). Test User B should own at least one separate JD and resume.

- [ ] **A — Extension regression:** build/load `extension/dist`; confirm extraction and save still work without dashboard involvement.
- [ ] **B — Missing configuration:** start without `.env.local`; confirm a setup message appears and no undefined request is sent.
- [ ] **C — Valid sign in:** sign in, open overview, refresh, and confirm the session persists.
- [ ] **D — Invalid sign in:** use invalid credentials; confirm a friendly message and no protected UI.
- [ ] **E — Overview:** verify exact counts and five most recent JD/resume links.
- [ ] **F — JD list:** test company/title search, category/seniority/status filters, all sorts, page sizes, and Previous/Next; verify list responses exclude `description_text`.
- [ ] **G — JD detail:** verify full plain text, preserved lines, categories, skills, safe URL, and literal display of `<script>alert('test')</script>`.
- [ ] **H — Resume list:** test candidate/name search, category/seniority/status/type filters, sorts, and pagination; verify responses exclude `resume_text`.
- [ ] **I — Resume detail:** verify metadata, tags, file formatting, and full safe extracted text.
- [ ] **J — Private resume:** click Open Original Resume; confirm a short-lived URL is generated only then, opens a new tab, is not persisted, and the bucket remains private.
- [ ] **K — Missing object:** safely test a missing test object; confirm the page remains usable and shows a friendly error.
- [ ] **L — RLS isolation:** verify Users A/B see only their records and cross-owner detail IDs show not found/no access.
- [ ] **M — Sign out:** sign out, use Back, and enter a protected hash; confirm login is enforced and prior in-memory records do not display.
- [ ] **N — Empty account:** verify zero counts and helpful empty states without exceptions.
- [ ] **O — Production output:** serve `dashboard/dist`; verify login/navigation/refresh, local assets, and no CDN dependency.
