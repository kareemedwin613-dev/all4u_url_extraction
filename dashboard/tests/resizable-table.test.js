import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { columnId, leafColumnIds, withResizableColumns } from "../src/shared/resizable-table-columns.js";

test("columns are identified by key, then dataIndex, then title", () => {
  assert.equal(columnId({ key: "status", dataIndex: "x" }, 0), "status");
  assert.equal(columnId({ dataIndex: ["job", "title"] }, 1), "job.title");
  assert.equal(columnId({ title: "Company" }, 2), "Company");
  assert.equal(columnId({ title: createElement("span", null, "Icon") }, 3), "column-3");
  assert.deepEqual(leafColumnIds([{ key: "a" }, { key: "group", children: [{ key: "b" }, { dataIndex: "c" }] }]), ["a", "group/b", "group/c"]);
});

test("saved widths override defaults and headers get the resize handle without losing their own props", () => {
  const resized = [];
  const columns = [
    { key: "company", title: "Company", width: 180, onHeaderCell: () => ({ className: "productivity-header-left" }) },
    { key: "title", title: "Job Title" },
    { key: "group", title: "Counts", children: [{ key: "applied", title: "Applied", width: 90 }] },
  ];
  const result = withResizableColumns(columns, { title: 320, "group/applied": 120 }, { onResizeWidth: (...args) => resized.push(args), onResetWidths: () => resized.push(["reset"]) });
  assert.equal(result[0].width, 180);
  assert.equal(result[1].width, 320);
  assert.equal(result[2].children[0].width, 120);
  assert.equal("onHeaderCell" in result[2], false);
  const header = result[0].onHeaderCell(result[0]);
  assert.equal(header.className, "productivity-header-left");
  assert.equal(header["data-column-id"], "company");
  assert.equal(header.resizable, true);
  header.onResizeWidth(240, true);
  result[2].children[0].onHeaderCell(result[2].children[0]).onResetWidths();
  assert.deepEqual(resized, [["company", 240, true], ["reset"]]);
  assert.equal(columns[1].width, undefined);
});

test("pinned table headers stay sticky when they have a resize handle", () => {
  const css = readFileSync(new URL("../src/styles/antd-dashboard.css", import.meta.url), "utf8");
  assert.match(css, /th:has\(>\.column-resize-handle\):not\(\.ant-table-cell-fix\)\{position:relative\}/);
  assert.doesNotMatch(css, /:not\(\.ant-table-cell-fix-left\)/);
});

test("every dashboard table uses the resizable wrapper instead of antd's Table", () => {
  for (const file of ["App.jsx", "components/ui.jsx", "features/applications/application-pages.jsx", "features/jd-review/jd-review-pages.jsx", "features/tailoring/tailoring-pages.jsx", "pages/admin-pages.jsx"]) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    const antd = source.match(/import\s*\{([^}]*)\}\s*from\s*"antd"/)[1];
    assert.doesNotMatch(antd, /\bTable\b/, `${file} still imports antd Table`);
    assert.match(source, /import \{ ResizableTable as (Ant)?Table \} from "[./]+(shared\/)?resizable-table\.jsx"/, file);
  }
});
