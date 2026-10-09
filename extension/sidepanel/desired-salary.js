import { salaryExpectation, salaryMidpoint } from "../autofill/autofill-context.js";

// The salary to ask for on an application card, as Autofill fills it: the JD range's midpoint; when the JD lists no
// range, the Application Guide's standard salary. The profile Resume's own desired salary is kept: it is the fallback
// when the Guide has no standard, and is mentioned beside the standard when it differs. Formatted like Autofill's
// salary answers ("$150,000 per year"). amount is the plain number, for copying into a salary box.
const digits = (value) => {
  const amount = Number(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};
const money = (value, currency = "USD") => {
  const formatted = Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return String(currency || "USD").toUpperCase() === "USD" ? `$${formatted}` : `${String(currency).toUpperCase()} ${formatted}`;
};

export function desiredSalary(application = {}) {
  const job = { salaryMin: application.salary_min, salaryMax: application.salary_max, salaryCurrency: application.salary_currency, salaryPeriod: application.salary_period };
  const midpoint = salaryMidpoint(job);
  if (midpoint) {
    return { amount: midpoint, text: salaryExpectation(job, ""), source: "JD range midpoint",
      detail: Number(job.salaryMin) === Number(job.salaryMax) ? `JD salary ${money(job.salaryMin, job.salaryCurrency)}` : `JD range ${money(job.salaryMin, job.salaryCurrency)} – ${money(job.salaryMax, job.salaryCurrency)}` };
  }
  const standard = digits(application.standard_desired_salary), resume = digits(application.resume_desired_salary);
  if (standard) {
    const note = resume && resume !== standard ? ` The Resume's own desired salary is ${money(resume)}.` : "";
    return { amount: String(standard), text: salaryExpectation(null, standard), source: "Application Guide standard", detail: `The JD lists no salary range.${note}` };
  }
  if (resume) return { amount: String(resume), text: salaryExpectation(null, resume), source: "Resume", detail: "The JD lists no salary range." };
  return null;
}
