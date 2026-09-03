import { useEffect, useRef } from "react";

const FALLBACK_REFRESH_MS = 30_000;

export function useRealtimeRefresh({ client, table, filter, enabled, refresh }) {
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    let refreshing = false;
    const run = async () => {
      if (document.visibilityState === "hidden" || refreshing) return;
      refreshing = true;
      try { await refreshRef.current(); } finally { refreshing = false; }
    };
    const channel = typeof client?.channel === "function"
      ? client.channel(`refresh:${table}:${filter}:${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table, filter }, run)
        .subscribe()
      : null;
    const timer = setInterval(run, FALLBACK_REFRESH_MS);
    const onVisibility = () => { if (document.visibilityState === "visible") void run(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      if (channel) void client.removeChannel(channel).catch(() => {});
    };
  }, [client, table, filter, enabled]);
}
