const VIEW_KEY_PREFIX = "sidepanel-current-view:";
export const PERSISTABLE_VIEWS = Object.freeze(["capture", "applications", "resumes", "queue", "settings"]);

const keyFor = (userId) => `${VIEW_KEY_PREFIX}${String(userId || "anonymous")}`;

export async function loadSidepanelView(userId, allowedViews, fallback, storageArea = chrome.storage.session) {
  const key = keyFor(userId), stored = await storageArea.get(key), value = stored?.[key];
  return Array.isArray(allowedViews) && allowedViews.includes(value) ? value : fallback;
}

export async function saveSidepanelView(userId, view, storageArea = chrome.storage.session) {
  if (!userId || !PERSISTABLE_VIEWS.includes(view)) return;
  await storageArea.set({ [keyFor(userId)]: view });
}

export async function clearSidepanelView(userId, storageArea = chrome.storage.session) {
  if (userId) await storageArea.remove(keyFor(userId));
}
