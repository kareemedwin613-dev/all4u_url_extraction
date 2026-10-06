import test from "node:test";
import assert from "node:assert/strict";
import { parseLegacyEducation } from "../scripts/education/legacy-education-parser.mjs";

const entries = (text) => parseLegacyEducation(text).map(({ entry }) => [entry.institution, entry.degree, entry.field_of_study, entry.start_date, entry.end_date]);

test("legacy education: school, degree, and dates on separate lines in either order", () => {
  assert.deepEqual(entries("Example State University\nBachelor's degree, Computer Science\n09/2012 – 05/2016"),
    [["Example State University", "Bachelor's degree", "Computer Science", { year: 2012, month: 9 }, { year: 2016, month: 5 }]]);
  assert.deepEqual(entries("Bachelor of Science in Computer Science\nSample Institute of Technology\n2015 – 2018"),
    [["Sample Institute of Technology", "Bachelor of Science", "Computer Science", { year: 2015 }, { year: 2018 }]]);
});

test("legacy education: single-line entries separated by ' , ' keep commas inside school names", () => {
  assert.deepEqual(entries("Bachelor's degree, Computer Science , University of Somewhere, Bay City 2010 – 2014"),
    [["University of Somewhere, Bay City", "Bachelor's degree", "Computer Science", { year: 2010 }, { year: 2014 }]]);
  assert.deepEqual(entries("2005 – 2010 Northern Example University , Bachelors, Computer Science"),
    [["Northern Example University", "Bachelors", "Computer Science", { year: 2005 }, { year: 2010 }]]);
});

test("legacy education: several schools, wrapped lines, and curly apostrophes", () => {
  assert.deepEqual(entries("Master of Science (MS), Computer Science\nExample College\n2021 – 2023\nBachelor ʼ s Degree, Economics, Business\nManagement - Finance\nExample College\n2011 – 2013"), [
    ["Example College", "Master of Science (MS)", "Computer Science", { year: 2021 }, { year: 2023 }],
    ["Example College", "Bachelor's Degree", "Economics, Business Management - Finance", { year: 2011 }, { year: 2013 }],
  ]);
  assert.deepEqual(entries("Example University\nBachelor of Science (BS) degree in Software Engineering\n2003 – 2007")[0].slice(1, 3), ["Bachelor of Science (BS)", "Software Engineering"]);
});

test("legacy education: anything uncertain is flagged for the reviewer, never guessed", () => {
  const [onlySchool] = parseLegacyEducation("The Example State College 2009 – 2010");
  assert.equal(onlySchool.entry.institution, "The Example State College");
  assert.match(onlySchool.warnings.join(" "), /No degree/);
  const [graduation] = parseLegacyEducation("Example University\nMaster's Degree, Computer Science\n08/2024");
  assert.deepEqual([graduation.entry.start_date, graduation.entry.end_date], [null, { year: 2024, month: 8 }]);
  assert.match(graduation.warnings.join(" "), /Only an end date/);
  const [noSchool] = parseLegacyEducation("Information Systems Management, Information Technology\n2010 – 2012");
  assert.equal(noSchool.entry.institution, "");
  assert.match(noSchool.warnings.join(" "), /No school name/);
});
