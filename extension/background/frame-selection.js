// Chooses the frame that holds the application form from chrome.scripting allFrames probe results
// ([{ frameId, result }]). Company careers pages often embed the ATS form (Greenhouse, iCIMS, …) in an
// iframe, so the top frame is not always the right target. Ties go to the top frame.
const MIN_RESUME_CONFIDENCE = 70;

function webOrigin(value) { return /^https?:\/\/[^/]+$/i.test(String(value || "")); }
function byScoreThenTop(score) { return (a, b) => score(b) - score(a) || (a.frameId === 0 ? -1 : b.frameId === 0 ? 1 : 0); }

export function selectResumeFrame(results = []) {
  const eligible = (Array.isArray(results) ? results : []).filter(({ result }) => webOrigin(result?.origin) && Number.isFinite(result?.confidence) && result.confidence >= MIN_RESUME_CONFIDENCE);
  return eligible.sort(byScoreThenTop(({ result }) => result.confidence))[0] || null;
}

export function selectAutofillFrame(results = []) {
  const detected = (Array.isArray(results) ? results : []).filter(({ result }) => result?.status === "DETECTED" && Array.isArray(result.fields) && webOrigin(result.origin));
  // Fillable fields dominate; unresolved questions only break ties between frames with equal fields.
  const score = ({ result }) => result.fields.length * 1000 + (Array.isArray(result.unresolved) ? Math.min(result.unresolved.length, 999) : 0);
  const best = detected.sort(byScoreThenTop(score))[0] || null;
  if (best && score(best) === 0) return detected.find(({ frameId }) => frameId === 0) || best;
  return best;
}
