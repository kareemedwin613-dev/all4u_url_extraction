import {normalizeSearch} from "../shared/validation.js";
export function applySearch(query,search,columns){const value=normalizeSearch(search);return value?query.or(columns.map(column=>`${column}.ilike.%${value}%`).join(",")):query;}
export function applyFullTextSearch(query,search,column="search_vector"){const value=normalizeSearch(search);return value?query.textSearch(column,value,{type:"websearch",config:"english"}):query;}
export function applyFilters(query,filters,map){let q=query;for(const [key,column] of Object.entries(map))if(filters[key])q=q.eq(column,filters[key]);return q;}
export function applySort(query,sort,allowlist,defaultKey){const rule=allowlist[sort]||allowlist[defaultKey];return query.order(rule.column,{ascending:rule.ascending});}
