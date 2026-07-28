import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import {clientSortColumns,serverSortColumns,serverSortFromTable} from "../src/shared/table-sorting.js";
import {JOB_SORTS,RESUME_SORTS} from "../src/shared/constants.js";

test("client table columns sort text, numbers, dates, and rendered values",()=>{
  const columns=clientSortColumns([
    {title:"Name",dataIndex:"name"},
    {title:"Count",dataIndex:"count"},
    {title:"Created",dataIndex:"created_at"},
    {title:"Rendered",sortValue:row=>React.createElement("span",null,row.label),render:(_,row)=>React.createElement("span",null,row.label)},
    {title:"",key:"action",render:()=>"View"},
  ]);
  assert.ok(columns[0].sorter({name:"Alpha"},{name:"Beta"})<0);
  assert.ok(columns[1].sorter({count:8},{count:3})>0);
  assert.ok(columns[2].sorter({created_at:"2026-01-01T00:00:00Z"},{created_at:"2025-01-01T00:00:00Z"})>0);
  assert.ok(columns[3].sorter({label:"Alpha"},{label:"Beta"})<0);
  assert.equal(columns[4].sorter,undefined);
});

test("server table columns expose controlled Ant sorting and normalize changes",()=>{
  const columns=serverSortColumns([{title:"Company",dataIndex:"company",sortKey:"company"}],"company_desc");
  assert.equal(columns[0].sorter,true);
  assert.equal(columns[0].sortOrder,"descend");
  assert.equal(serverSortFromTable({column:{sortKey:"company"},order:"ascend"},"created_desc"),"company_asc");
  assert.equal(serverSortFromTable({},"created_desc"),"created_desc");
});

test("paginated dashboard sort allowlists include both directions for displayed fields",()=>{
  const jobSorts=Object.keys(JOB_SORTS),resumeSorts=Object.keys(RESUME_SORTS);
  for(const key of ["company","title","category","subcategory","seniority","source","capturer","status","created"]){
    assert.ok(jobSorts.includes(`${key}_asc`));
    assert.ok(jobSorts.includes(`${key}_desc`));
  }
  for(const key of ["candidate","name","category","subcategory","seniority","status","mime","updated"]){
    assert.ok(resumeSorts.includes(`${key}_asc`));
    assert.ok(resumeSorts.includes(`${key}_desc`));
  }
});
