import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ResumeService } from "../src/resumes/resume.service.js";

const user = { id: "123e4567-e89b-42d3-a456-426614174000", token: "jwt", claims: {} };
const categoryId = "223e4567-e89b-42d3-a456-426614174000";
const resumeId = "323e4567-e89b-42d3-a456-426614174000";

test("resume list filters Primary Category with an inner join instead of a huge id.in list", async () => {
  const calls: any[] = [];
  const listQuery: any = {
    select(fields: string, options: any) {
      calls.push({ type: "select", fields, options });
      return this;
    },
    eq(column: string, value: any) {
      calls.push({ type: "eq", column, value });
      return this;
    },
    order() {
      return this;
    },
    range() {
      return this;
    },
    then(resolve: any, reject: any) {
      return Promise.resolve({
        data: [
          {
            id: resumeId,
            resume_number: 1,
            primary_category_id: categoryId,
            resume_tech_stacks: [{ primary_category_id: categoryId }],
          },
        ],
        error: null,
        count: 1,
      }).then(resolve, reject);
    },
  };
  const stackQuery: any = {
    select() {
      return this;
    },
    in() {
      return this;
    },
    order() {
      return this;
    },
    then(resolve: any, reject: any) {
      return Promise.resolve({
        data: [{ resume_id: resumeId, primary_category_id: categoryId, subcategory_id: null, sort_order: 0 }],
        error: null,
      }).then(resolve, reject);
    },
  };
  const client = {
    from(table: string) {
      calls.push({ type: "from", table });
      if (table === "resume_tech_stacks") return stackQuery;
      assert.equal(table, "resumes");
      return listQuery;
    },
  };
  const service = new ResumeService({
    forUser: (token: string) => {
      assert.equal(token, "jwt");
      return client;
    },
  } as any);

  const result = await service.list(user as any, {
    categoryId,
    status: "ACTIVE",
    page: 1,
    pageSize: 25,
    sort: "candidate_asc",
  });

  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, resumeId);
  assert.equal(result.items[0].resume_tech_stacks, undefined);
  assert.deepEqual(result.items[0].primary_category_ids, [categoryId]);
  assert.equal(
    calls.some((call) => call.type === "select" && String(call.fields).includes("resume_tech_stacks!inner")),
    true,
  );
  assert.equal(
    calls.some((call) => call.type === "eq" && call.column === "resume_tech_stacks.primary_category_id" && call.value === categoryId),
    true,
  );
  assert.equal(calls.some((call) => call.type === "from" && call.table === "resume_tech_stacks" && calls.indexOf(call) < 2), false);
});

test("resume list service keeps the category inner-join filter contract", async () => {
  const source = await readFile(new URL("../src/resumes/resume.service.ts", import.meta.url), "utf8");
  assert.match(source, /resume_tech_stacks!inner\(primary_category_id\)/);
  assert.match(source, /resume_tech_stacks\.primary_category_id/);
  assert.doesNotMatch(source, /stackIds/);
  assert.doesNotMatch(source, /\.in\("id",stackIds\)/);
});
