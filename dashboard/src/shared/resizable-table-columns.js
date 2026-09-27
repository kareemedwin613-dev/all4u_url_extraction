export function columnId(column, index) {
  if (column.key !== undefined && column.key !== null) return String(column.key);
  if (Array.isArray(column.dataIndex)) return column.dataIndex.join(".");
  if (column.dataIndex !== undefined && column.dataIndex !== null) return String(column.dataIndex);
  return typeof column.title === "string" ? column.title : `column-${index}`;
}

export function leafColumnIds(columns = [], prefix = "") {
  return columns.flatMap((column, index) => {
    const id = `${prefix}${columnId(column, index)}`;
    return Array.isArray(column.children) ? leafColumnIds(column.children, `${id}/`) : [id];
  });
}

// Pure: apply saved widths to leaf columns and attach the resize handle props to their headers,
// keeping any onHeaderCell the page already defines.
export function withResizableColumns(columns = [], widths = {}, handlers = {}, prefix = "") {
  return columns.map((column, index) => {
    const id = `${prefix}${columnId(column, index)}`;
    if (Array.isArray(column.children)) return { ...column, children: withResizableColumns(column.children, widths, handlers, `${id}/`) };
    const width = widths[id] ?? column.width;
    return {
      ...column,
      ...(width !== undefined ? { width } : {}),
      onHeaderCell: (col) => ({
        ...(column.onHeaderCell?.(col) || {}),
        "data-column-id": id,
        resizable: true,
        onResizeWidth: (next, commit) => handlers.onResizeWidth?.(id, next, commit),
        onResetWidths: () => handlers.onResetWidths?.(),
      }),
    };
  });
}
