import test from "node:test";
import assert from "node:assert/strict";
import {listJobs} from "../src/services/job-read-service.js";

test("JD list sends search, category, seniority, and status filters to Supabase",async()=>{
  const calls=[];
  const response={data:[],error:null,count:0};
  const query={select(){return this;},or(value){calls.push(["or",value]);return this;},eq(column,value){calls.push(["eq",column,value]);return this;},order(column,options){calls.push(["order",column,options]);return this;},range(from,to){calls.push(["range",from,to]);return this;},then(resolve){return Promise.resolve(response).then(resolve);}};
  const categoryId="b4d63a80-e306-4a2f-afca-29cd4b3951e0";
  const result=await listJobs({from:table=>{assert.equal(table,"job_descriptions");return query;}},{search:"data",categoryId,seniority:"SENIOR",status:"ACTIVE",sort:"company_asc",page:1,pageSize:25});
  assert.deepEqual(calls.slice(0,4),[["or","company.ilike.%data%,job_title.ilike.%data%"],["eq","category_id",categoryId],["eq","seniority","SENIOR"],["eq","status","ACTIVE"]]);
  assert.deepEqual(calls.at(-2),["order","company",{ascending:true}]);
  assert.equal(result.total,0);
});
