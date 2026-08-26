/** Shared Ant Design App notification/toast defaults for transient feedback. */
export const APP_NOTIFICATION_CONFIG = Object.freeze({
  placement: "bottomRight",
  duration: 4.5,
  maxCount: 3,
});

export const APP_MESSAGE_CONFIG = Object.freeze({
  duration: 3.5,
  maxCount: 3,
});

const TOAST_TYPES = new Set(["success", "error", "warning", "info", "loading"]);

/** Short auto-dismiss toast via Ant Design App message API. */
export function toastFromApp(messageApi, type, content) {
  if (!content) return;
  const key = TOAST_TYPES.has(type) ? type : "info";
  const api = messageApi?.[key];
  if (typeof api !== "function") return;
  api(content);
}

/** Richer corner notification (title + optional description). */
export function notifyFromApp(notificationApi, type, message, description) {
  const api = notificationApi?.[type];
  if (typeof api !== "function") return;
  api({
    message,
    ...(description ? { description } : {}),
    placement: APP_NOTIFICATION_CONFIG.placement,
  });
}
