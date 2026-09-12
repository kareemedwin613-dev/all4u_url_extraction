import { useMemo, useSyncExternalStore } from "react";
import { createBulkDraftStore } from "./bulk-drafts.js";

export function useBulkDrafts(userId, apiBaseUrl) {
  const store = useMemo(() => createBulkDraftStore({ userId, apiBaseUrl }), [userId, apiBaseUrl]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { store, ...snapshot };
}
