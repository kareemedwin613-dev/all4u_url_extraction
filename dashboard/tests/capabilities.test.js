import test from "node:test";
import assert from "node:assert/strict";
import {ALL_CAPABILITIES,CAPABILITIES,capabilitiesForRoles,normalizeRoleCodes} from "../src/access/capabilities.js";

test("each fixed role maps to the expected capabilities",()=>{
  assert.deepEqual([...capabilitiesForRoles(["APPLIER"])].sort(),[CAPABILITIES.APPLICATION_VIEW,CAPABILITIES.BUSINESS_DATA_READ,CAPABILITIES.JOB_DESCRIPTION_READ,CAPABILITIES.PROFILE_VIEW_SELF].sort());
  assert.deepEqual([...capabilitiesForRoles(["APPLYING_MANAGER"])].sort(),[CAPABILITIES.APPLICATION_BULK_MANAGE,CAPABILITIES.APPLICATION_MANAGE,CAPABILITIES.APPLICATION_VIEW,CAPABILITIES.BUSINESS_DATA_READ,CAPABILITIES.EXTENSION_BUSINESS_WRITE,CAPABILITIES.JOB_DESCRIPTION_READ,CAPABILITIES.PROFILE_VIEW_SELF,CAPABILITIES.USER_DIRECTORY_READ].sort());
  assert.deepEqual([...capabilitiesForRoles(["DEVELOPER"])],[CAPABILITIES.PROFILE_VIEW_SELF]);
  assert.deepEqual([...capabilitiesForRoles(["DEVELOPMENT_MANAGER"])],[CAPABILITIES.PROFILE_VIEW_SELF]);
  assert.deepEqual([...capabilitiesForRoles(["JD_FINDER"])].sort(),[CAPABILITIES.EXTENSION_BUSINESS_WRITE,CAPABILITIES.JOB_DESCRIPTION_EDIT_OWN,CAPABILITIES.JOB_DESCRIPTION_READ,CAPABILITIES.PROFILE_VIEW_SELF].sort());
  assert.deepEqual([...capabilitiesForRoles(["ADMIN"])].sort(),[...ALL_CAPABILITIES].sort());
});

test("multiple roles form a deduplicated union and unknown roles grant nothing",()=>{
  assert.deepEqual(normalizeRoleCodes([" applier ","APPLIER","developer"]),["APPLIER","DEVELOPER"]);
  assert.deepEqual([...capabilitiesForRoles(["UNKNOWN"])],[]);
  assert.deepEqual([...capabilitiesForRoles(["APPLIER","DEVELOPER"])].sort(),[CAPABILITIES.APPLICATION_VIEW,CAPABILITIES.BUSINESS_DATA_READ,CAPABILITIES.JOB_DESCRIPTION_READ,CAPABILITIES.PROFILE_VIEW_SELF].sort());
});

test("inactive accounts receive no operational capability",()=>assert.equal(capabilitiesForRoles(["ADMIN"],"INACTIVE").size,0));
