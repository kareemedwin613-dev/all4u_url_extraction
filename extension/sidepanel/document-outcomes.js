// "resume attached", "attach the cover letter yourself", … for the finish summary. A missing cover letter on the
// Application is noted without asking for attention; a file the page could not take needs the Applier.
export function documentParts({ resume, coverLetter } = {}) {
  const parts = [];
  let attention = false;
  for (const [label, outcome] of [["resume", resume], ["cover letter", coverLetter]]) {
    if (!outcome?.status) continue;
    if (outcome.status === "ATTACHED") parts.push(`${label} attached`);
    else if (outcome.code === "COVER_LETTER_NOT_FOUND") parts.push("no cover letter on file");
    else { parts.push(`attach the ${label} yourself`); attention = true; }
  }
  return { parts, attention };
}
