import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { desiredSalary } from "../extension/sidepanel/desired-salary.js";

const sql = readFileSync(new URL("../supabase/migrations/202610091300_v3_168_application_card_desired_salary.sql", import.meta.url), "utf8");
const card = readFileSync(new URL("../extension/sidepanel/components/ApplicationCard.jsx", import.meta.url), "utf8");

test("the card asks for the JD range's midpoint first", () => {
  assert.deepEqual(desiredSalary({ salary_min: 140000, salary_max: 180000, salary_currency: "USD", salary_period: "YEAR", resume_desired_salary: "130000", standard_desired_salary: "150000" }),
    { amount: "160000", text: "$160,000 per year", source: "JD range midpoint", detail: "JD range $140,000 – $180,000" });
  assert.equal(desiredSalary({ salary_min: 60, salary_max: 70, salary_currency: "USD", salary_period: "HOUR" }).text, "$65 per hour");
});

test("without a JD range: the Application Guide standard, as Autofill fills it; the Resume figure is kept", () => {
  assert.deepEqual(desiredSalary({ salary_min: 150000, salary_max: null, resume_desired_salary: "13000", standard_desired_salary: "150000" }),
    { amount: "150000", text: "$150,000 per year", source: "Application Guide standard", detail: "The JD lists no salary range. The Resume's own desired salary is $13,000." });
  assert.equal(desiredSalary({ resume_desired_salary: "150000", standard_desired_salary: "150000" }).detail, "The JD lists no salary range.", "no note when they agree");
  assert.deepEqual(desiredSalary({ resume_desired_salary: "$130,000" }), { amount: "130000", text: "$130,000 per year", source: "Resume", detail: "The JD lists no salary range." }, "the Resume figure when the Guide has none");
  assert.equal(desiredSalary({}), null, "nothing known: no line on the card");
});

test("v3.168 adds the salary columns to the card list without changing anything else it returns", () => {
  for (const column of ["j.salary_min", "j.salary_max", "j.salary_currency", "j.salary_period", ") resume_desired_salary,", ") standard_desired_salary,"]) assert.ok(sql.includes(column), column);
  assert.match(sql, /x\.resume_id = profile_r\.id[\s\S]*?x\.review_status = 'VERIFIED'[\s\S]*?allowReviewedAnswers/, "the same verified answers Autofill may use");
  assert.match(sql, /a\.assigned_to = auth\.uid\(\)/, "still the Applier's own Applications");
  assert.match(card, /Desired salary: /);
  assert.match(card, /copyable=\{\{ text: salary\.amount/);
});

test("a JD with a single salary figure shows that figure", () => {
  assert.equal(desiredSalary({ salary_min: 220000, salary_max: 220000, salary_period: "YEAR" }).detail, "JD salary $220,000");
});
