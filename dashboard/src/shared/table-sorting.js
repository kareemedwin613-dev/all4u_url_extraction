import React from "react";

function text(value){
  if(value==null)return "";
  if(["string","number","boolean"].includes(typeof value))return String(value);
  if(Array.isArray(value))return value.map(text).join(" ");
  if(React.isValidElement(value))return text(value.props?.children);
  return String(value);
}

function compare(left,right){
  const a=left instanceof Date?left.getTime():left,b=right instanceof Date?right.getTime():right;
  if(typeof a==="number"&&typeof b==="number")return a-b;
  const aDate=Date.parse(a),bDate=Date.parse(b);
  if(/\d{4}-\d{2}-\d{2}/.test(String(a))&&Number.isFinite(aDate)&&Number.isFinite(bDate))return aDate-bDate;
  return text(a).localeCompare(text(b),undefined,{numeric:true,sensitivity:"base"});
}

export function clientSortColumns(columns=[]){
  return columns.map(column=>{
    if(Array.isArray(column.children)&&column.children.length){
      return {...column,children:clientSortColumns(column.children)};
    }
    if(column.sorter||column.sortable===false||column.key==="action"||column.key==="actions")return column;
    const value=column.sortValue||(row=>column.dataIndex==null?"":row[column.dataIndex]);
    return {...column,sorter:(a,b)=>compare(value(a),value(b)),sortDirections:["ascend","descend"]};
  });
}

export function serverSortColumns(columns=[],currentSort=""){
  return columns.map(column=>{
    if(!column.sortKey)return column;
    const ascending=`${column.sortKey}_asc`,descending=`${column.sortKey}_desc`;
    return {...column,sorter:true,sortOrder:currentSort===ascending?"ascend":currentSort===descending?"descend":null,sortDirections:["ascend","descend"]};
  });
}

export function serverSortFromTable(sorter,defaultSort){
  const value=Array.isArray(sorter)?sorter[0]:sorter,key=value?.column?.sortKey;
  if(!key||!value.order)return defaultSort;
  return `${key}_${value.order==="ascend"?"asc":"desc"}`;
}

export function tableRowNumberColumn({ page = 1, pageSize = 25 } = {}) {
  return {
    title: "No",
    key: "no",
    width: 64,
    align: "center",
    className: "productivity-row-no-col",
    sortable: false,
    render: (_value, _row, index) => (page - 1) * pageSize + index + 1,
  };
}
