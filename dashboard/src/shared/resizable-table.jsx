import React, { useCallback, useMemo, useRef, useState } from "react";
import { Table } from "antd";
import { leafColumnIds, withResizableColumns } from "./resizable-table-columns.js";
export { columnId, leafColumnIds, withResizableColumns } from "./resizable-table-columns.js";

// Drop-in replacement for Ant Design's Table with drag-to-resize columns.
// Drag a header's right edge to resize; double-click it to restore automatic widths.
// Widths are a per-viewer preference kept in this browser's localStorage, per table.
const STORAGE_PREFIX = "resume-jd:column-widths:";
export const MIN_COLUMN_WIDTH = 60;

function readWidths(key) {
  try { const value = JSON.parse(globalThis.localStorage?.getItem(STORAGE_PREFIX + key) || "{}"); return value && typeof value === "object" ? value : {}; } catch { return {}; }
}
function writeWidths(key, widths) {
  try {
    if (Object.keys(widths).length) globalThis.localStorage?.setItem(STORAGE_PREFIX + key, JSON.stringify(widths));
    else globalThis.localStorage?.removeItem(STORAGE_PREFIX + key);
  } catch { /* storage unavailable: widths last for this page view only */ }
}

function ResizableHeaderCell({ resizable, onResizeWidth, onResetWidths, children, ...rest }) {
  if (!resizable) return <th {...rest}>{children}</th>;
  function startDrag(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const th = event.currentTarget.parentElement, startX = event.clientX, startWidth = th.getBoundingClientRect().width;
    let frame = 0, latest = startWidth;
    const widthAt = (clientX) => Math.max(MIN_COLUMN_WIDTH, Math.round(startWidth + clientX - startX));
    const move = (moveEvent) => {
      latest = widthAt(moveEvent.clientX);
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; onResizeWidth(latest, false, th); });
    };
    const stop = (upEvent) => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", stop);
      document.body.classList.remove("column-resizing");
      if (frame) cancelAnimationFrame(frame);
      onResizeWidth(widthAt(upEvent.clientX), true, th);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", stop);
    document.body.classList.add("column-resizing");
  }
  return (
    <th {...rest}>
      {children}
      <span
        className="column-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize column"
        title="Drag to resize. Double-click to reset column widths."
        onMouseDown={startDrag}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => { event.stopPropagation(); onResetWidths(); }}
      />
    </th>
  );
}

export function ResizableTable({ columns, components, resizeKey, tableLayout, ...props }) {
  const route = typeof location === "undefined" ? "" : String(location.hash || "#/").split("?")[0];
  const storageKey = resizeKey || `${route}|${leafColumnIds(columns).join(",")}`;
  const [widths, setWidths] = useState(() => readWidths(storageKey)), keyRef = useRef(storageKey);
  if (keyRef.current !== storageKey) { keyRef.current = storageKey; setWidths(readWidths(storageKey)); }

  const onResizeWidth = useCallback((id, width, commit, th) => {
    setWidths((current) => {
      // First resize: pin every visible column at its current width, so the fixed layout keeps them.
      let next = current;
      if (!Object.keys(current).length && th) {
        next = {};
        for (const cell of th.closest("thead")?.querySelectorAll("th[data-column-id]") || []) next[cell.dataset.columnId] = Math.round(cell.getBoundingClientRect().width);
      }
      next = { ...next, [id]: width };
      if (commit) writeWidths(storageKey, next);
      return next;
    });
  }, [storageKey]);
  const onResetWidths = useCallback(() => { writeWidths(storageKey, {}); setWidths({}); }, [storageKey]);

  const resizableColumns = useMemo(() => withResizableColumns(columns, widths, { onResizeWidth, onResetWidths }), [columns, widths, onResizeWidth, onResetWidths]);
  const mergedComponents = useMemo(() => ({ ...components, header: { ...components?.header, cell: ResizableHeaderCell } }), [components]);
  const pinned = Object.keys(widths).length > 0;
  return <Table {...props} columns={resizableColumns} components={mergedComponents} tableLayout={pinned ? "fixed" : tableLayout} />;
}

ResizableTable.Summary = Table.Summary;
ResizableTable.Column = Table.Column;
ResizableTable.ColumnGroup = Table.ColumnGroup;
ResizableTable.SELECTION_COLUMN = Table.SELECTION_COLUMN;
ResizableTable.EXPAND_COLUMN = Table.EXPAND_COLUMN;
