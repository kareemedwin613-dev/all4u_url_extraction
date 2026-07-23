import test from "node:test";
import assert from "node:assert/strict";
import {ACCESS_STATE_COPY} from "../src/access/access-state-copy.js";

test("access-state pages use required clear copy",()=>{
  assert.match(ACCESS_STATE_COPY.PENDING_ACCESS.message,/no platform role has been assigned/i);
  assert.match(ACCESS_STATE_COPY.ACCOUNT_INACTIVE.message,/platform account is inactive/i);
  assert.equal(ACCESS_STATE_COPY.ACCESS_DENIED.title,"Access Denied");
  assert.match(ACCESS_STATE_COPY.ACCESS_ERROR.message,/could not be loaded/i);
});
