const PASSIVE_SAME_USER_EVENTS = new Set(["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED"]);

export function authStateDecision(event, currentSession, nextSession) {
  const currentUserId = currentSession?.user?.id || null;
  const nextUserId = nextSession?.user?.id || null;
  if (!nextSession || event === "SIGNED_OUT") {
    return currentSession ? { apply: true, resetAccess: true } : { apply: false, resetAccess: false };
  }
  if (currentUserId && currentUserId === nextUserId && PASSIVE_SAME_USER_EVENTS.has(event)) {
    return { apply: false, resetAccess: false };
  }
  return { apply: true, resetAccess: true };
}
