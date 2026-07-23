import test from "node:test"; import assert from "node:assert/strict";
import { normalizeWhitespace, normalizeUrl } from "../extension/shared/normalization.js";
test("normalizes whitespace and blank lines",()=>assert.equal(normalizeWhitespace(" a   b \n\n\n c "),"a b\n\nc"));
test("removes fragments, tracking parameters, and trailing slash",()=>assert.equal(normalizeUrl("https://example.com/jobs/7/?utm_source=x&job=7#top"),"https://example.com/jobs/7?job=7"));
test("preserves identifiers and sorts stable query",()=>assert.equal(normalizeUrl("https://example.com/job?z=2&id=1&a=3"),"https://example.com/job?a=3&id=1&z=2"));
test("preserves site root slash",()=>assert.equal(normalizeUrl("https://example.com/"),"https://example.com/"));
test("rejects invalid and non-http URLs",()=>{assert.equal(normalizeUrl("not a url"),null);assert.equal(normalizeUrl("file:///x"),null)});
