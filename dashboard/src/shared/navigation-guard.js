let guard = null;
export function registerNavigationGuard(callback) {
  guard = callback;
  return () => { if (guard === callback) guard = null; };
}
export function confirmNavigation() { return !guard || guard(); }
