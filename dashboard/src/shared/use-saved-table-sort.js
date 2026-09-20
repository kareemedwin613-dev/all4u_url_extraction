import { useSavedFilters } from "./use-filter-preferences.js";

const columnKey = column => String(column.key || column.dataIndex || "");
function sortableKeys(columns) {
  return columns.flatMap(column => column.children ? sortableKeys(column.children)
    : column.sorter && columnKey(column) ? [columnKey(column)] : []);
}

export function useSavedTableSort(panel, columns) {
  const keys = sortableKeys(columns);
  const parse = query => {
    const params = new URLSearchParams(query), field = params.get("field"), order = params.get("order");
    return keys.includes(field) && ["ascend", "descend"].includes(order) ? { field, order } : { field: "", order: "" };
  };
  const [sort, setSort] = useSavedFilters(panel, parse);
  const decorate = items => items.map(column => column.children ? { ...column, children: decorate(column.children) }
    : column.sorter ? { ...column, sortOrder: sort.field === columnKey(column) ? sort.order || null : null } : column);
  const onSort = sorter => {
    const next = Array.isArray(sorter) ? sorter[0] : sorter;
    setSort({ field: next?.columnKey || next?.field || "", order: next?.order || "" });
  };
  return { columns: decorate(columns), onSort, resetSort: () => setSort({ field: "", order: "" }) };
}
