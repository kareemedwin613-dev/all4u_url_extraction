// Read-only preview refreshes only. Never retry scoring or creation mutations here.
export function startMatchPreviewPolling({ load, onSuccess, onError, shouldPoll, initialDelay = 0,
  schedule = setTimeout, cancel = clearTimeout }) {
  let stopped = false, timer, failures = 0;
  const run = async () => {
    if (stopped) return;
    let value;
    try { value = await load(); }
    catch (error) {
      if (stopped) return;
      const retryDelayMs = error?.retryable && failures < 3 ? 5000 * 2 ** failures++ : null;
      onError(error, retryDelayMs);
      if (!stopped && retryDelayMs !== null) timer = schedule(run, retryDelayMs);
      return;
    }
    if (stopped) return;
    failures = 0;
    onSuccess(value);
    if (!stopped && shouldPoll(value)) timer = schedule(run, 5000);
  };
  if (initialDelay > 0) timer = schedule(run, initialDelay);
  else void run();
  return () => { stopped = true; cancel(timer); };
}

export function previewFailureMessage(error, retryDelayMs) {
  return `${error?.message || "The matching preview could not be refreshed."} ${retryDelayMs == null
    ? "Refresh the preview to try again."
    : `Retrying in ${retryDelayMs / 1000} seconds.`}`;
}
