import { MAX_BULK_COMBINATIONS, MAX_BULK_JDS, defaultEligibleSelection } from "./bulk-state.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validIds = (value, limit) => Array.isArray(value) && value.length <= limit && value.every(id => typeof id === "string" && uuid.test(id));
const timestamp = value => Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 8640000000000000 ? Number(value) : 0;
const storageWarning = "Browser storage is unavailable or full. Your draft is kept for this session only; do not refresh or close this tab.";

export const bulkDraftHref = id => `#/applications/bulk-create?draft=${encodeURIComponent(id)}`;

// Save identifiers and user choices only, never runner tickets, credentials, scores, or resume/JD text.
function cleanDraft(value) {
  if (!value || !uuid.test(value.id) || !validIds(value.jobDescriptionIds, MAX_BULK_JDS) || !value.jobDescriptionIds.length) return null;
  if (value.resumeIds !== null && !validIds(value.resumeIds, MAX_BULK_COMBINATIONS)) return null;
  const excludedPairKeys = Array.isArray(value.excludedPairKeys) ? [...new Set(value.excludedPairKeys)].filter(key => {
    const parts = typeof key === "string" ? key.split(":") : [];
    return parts.length === 2 && parts.every(id => uuid.test(id));
  }).slice(0, MAX_BULK_COMBINATIONS) : [];
  const draft = {
    id: value.id,
    createdAt: timestamp(value.createdAt),
    updatedAt: timestamp(value.updatedAt),
    jobDescriptionIds: [...new Set(value.jobDescriptionIds)],
    resumeIds: value.resumeIds === null ? null : [...new Set(value.resumeIds)],
    matchingMode: value.matchingMode === "CATEGORY" ? "CATEGORY" : "SCORE",
    batchName: typeof value.batchName === "string" ? value.batchName.slice(0, 120) : "",
    activeTab: value.activeTab === "create" ? "create" : "combinations",
    excludedPairKeys,
    creationAttempt: null,
  };
  // Keep the retry key bound to exactly the same request after a navigation or refresh.
  if (value.creationAttempt && uuid.test(value.creationAttempt.key)) {
    try {
      const request = JSON.parse(value.creationAttempt.fingerprint);
      if (Array.isArray(request.payload) && request.payload.length <= MAX_BULK_COMBINATIONS &&
          request.payload.every(pair => uuid.test(pair.job_description_id) && uuid.test(pair.resume_id)) &&
          typeof request.batchName === "string" && request.batchName.length <= 120 && ["SCORE", "CATEGORY"].includes(request.matchingMode)) {
        draft.creationAttempt = { key: value.creationAttempt.key, fingerprint: JSON.stringify({
          payload: request.payload.map(pair => ({ job_description_id: pair.job_description_id, resume_id: pair.resume_id })),
          batchName: request.batchName, matchingMode: request.matchingMode,
        }) };
      }
    } catch { /* Ignore malformed retry metadata. */ }
  }
  return draft;
}

export function restoreDraftResumeIds(savedIds, availableIds) {
  return savedIds === null ? availableIds : savedIds.filter(id => availableIds.includes(id));
}

export function selectDraftPairs(rows, excludedPairKeys) {
  return new Set([...defaultEligibleSelection({ combinations: rows })].filter(key => !excludedPairKeys.has(key)));
}

export function draftPairExclusions(rows, selected, previous) {
  const excluded = new Set(previous);
  for (const key of defaultEligibleSelection({ combinations: rows })) {
    if (selected.has(key)) excluded.delete(key);
    else excluded.add(key);
  }
  return excluded;
}

export function createBulkDraftStore({ userId, apiBaseUrl, storage = () => globalThis.localStorage, now = Date.now, newId = () => crypto.randomUUID(), events = globalThis }) {
  const namespace = userId ? `application-creation-draft:v1:${encodeURIComponent(String(apiBaseUrl || "").replace(/\/+$/, ""))}:${encodeURIComponent(userId)}:` : null;
  const listeners = new Set();
  let snapshot = { drafts: [], storageError: "" }, memoryOnly = false;

  function publish(drafts, storageError = snapshot.storageError) {
    const next = { drafts: [...drafts].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)), storageError };
    if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }
  function refresh() {
    if (!namespace || memoryOnly) return;
    try {
      const source = storage(), drafts = [];
      for (let index = 0; index < source.length; index++) {
        const key = source.key(index);
        if (!key?.startsWith(namespace)) continue;
        try {
          const draft = cleanDraft(JSON.parse(source.getItem(key)));
          if (draft && key === namespace + draft.id) drafts.push(draft);
        } catch { /* One damaged draft must not prevent opening the others. */ }
      }
      publish(drafts, "");
    } catch {
      memoryOnly = true;
      publish(snapshot.drafts, storageWarning);
    }
  }
  function write(draft) {
    try {
      if (!memoryOnly) storage().setItem(namespace + draft.id, JSON.stringify(draft));
    } catch { memoryOnly = true; }
    publish([...snapshot.drafts.filter(item => item.id !== draft.id), draft], memoryOnly ? storageWarning : "");
    return draft;
  }
  const onStorage = event => { if (event.key === null || event.key?.startsWith(namespace)) refresh(); };
  refresh();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (!listeners.size) events.addEventListener?.("storage", onStorage);
      listeners.add(listener);
      refresh();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) events.removeEventListener?.("storage", onStorage);
      };
    },
    create(jobDescriptionIds) {
      if (!namespace) return null;
      const draft = cleanDraft({ id: newId(), createdAt: now(), updatedAt: now(), jobDescriptionIds, resumeIds: null });
      if (!draft) return null;
      refresh();
      return write(draft);
    },
    update(id, changes) {
      refresh();
      const previous = snapshot.drafts.find(draft => draft.id === id);
      // Late preview/request callbacks must not resurrect discarded or completed drafts.
      if (!previous) return null;
      const next = cleanDraft({ ...previous, ...changes, id, jobDescriptionIds: previous.jobDescriptionIds, createdAt: previous.createdAt, updatedAt: now() });
      return next ? write(next) : null;
    },
    remove(id) {
      refresh();
      try { if (!memoryOnly && namespace) storage().removeItem(namespace + id); }
      catch { memoryOnly = true; }
      publish(snapshot.drafts.filter(draft => draft.id !== id), memoryOnly ? storageWarning : "");
    },
  };
}
