import { useEffect, useRef, useState } from "react";

/**
 * Measure a host element so Ant Table scroll.y fills remaining space
 * (pagination stays visible below the host).
 * scroll.y is body-only, so table header height is subtracted.
 */
export function useTableBodyHeight(enabled = true, minHeight = 200) {
  const ref = useRef(null);
  const [height, setHeight] = useState(Math.max(minHeight, 360));
  useEffect(() => {
    if (!enabled) return undefined;
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const update = () => {
      const header =
        node.querySelector(".ant-table-header") ||
        node.querySelector(".ant-table-thead");
      const headerH = header
        ? Math.ceil(header.getBoundingClientRect().height)
        : 55;
      const next = Math.floor(node.clientHeight - headerH);
      if (next > 0) setHeight(Math.max(minHeight, next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, minHeight]);
  return [ref, height];
}
