/** Shared Ant Design App notification defaults for transient feedback. */
export const APP_NOTIFICATION_CONFIG = Object.freeze({
  placement: "bottomRight",
  duration: 4.5,
  maxCount: 3,
});

export function notifyFromApp(notificationApi, type, message, description) {
  const api = notificationApi?.[type];
  if (typeof api !== "function") return;
  api({
    message,
    ...(description ? { description } : {}),
    placement: APP_NOTIFICATION_CONFIG.placement,
  });
}
