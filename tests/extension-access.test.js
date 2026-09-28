import test from "node:test";
import assert from "node:assert/strict";
import {canAccessMyApplications,canAccessResumeQueue,canCheckJobDuplicates,canCreateTailoring,canListOwnJobs,canReadBusiness,canReviewJobs,canWriteBusiness,extensionAccessMessage,normalizeExtensionAccess} from "../extension/access/capabilities.js";

test("extension permits writes only for Applying Manager and Admin",()=>{
  for(const role of ["APPLYING_MANAGER","ADMIN"])assert.equal(canWriteBusiness(normalizeExtensionAccess({status:"ACTIVE",roles:[role]})),true);
  for(const role of ["JD_FINDER","APPLIER","DEVELOPER","DEVELOPMENT_MANAGER"])assert.equal(canWriteBusiness(normalizeExtensionAccess({status:"ACTIVE",roles:[role]})),false);
});

test("duplicate checks remain available to finders without granting save access",()=>{
  for(const role of ["JD_FINDER","APPLYING_MANAGER","ADMIN"]){
    assert.equal(canCheckJobDuplicates(normalizeExtensionAccess({status:"ACTIVE",roles:[role]})),true);
    assert.equal(canCheckJobDuplicates(normalizeExtensionAccess({status:"INACTIVE",roles:[role]})),false);
    assert.equal(canWriteBusiness(normalizeExtensionAccess({status:"INACTIVE",roles:[role]})),false);
  }
  for(const role of ["APPLIER","DEVELOPER","DEVELOPMENT_MANAGER"])
    assert.equal(canCheckJobDuplicates(normalizeExtensionAccess({status:"ACTIVE",roles:[role]})),false);
  for(const role of ["ADMIN","APPLYING_MANAGER"])
    assert.equal(canWriteBusiness(normalizeExtensionAccess({status:"ACTIVE",roles:["JD_FINDER",role]})),true);
  assert.match(extensionAccessMessage(normalizeExtensionAccess({status:"ACTIVE",roles:["JD_FINDER"]})),/check JD duplicates/);
});

test("extension permits Capture JD read access for every active role",()=>{
  for(const role of ["APPLIER","APPLYING_MANAGER","DEVELOPER","DEVELOPMENT_MANAGER","JD_FINDER","ADMIN"])assert.equal(canReadBusiness(normalizeExtensionAccess({status:"ACTIVE",roles:[role]})),true);
});

test("extension restricts Resumes and Tailoring Queue tabs to Admin",()=>{
  assert.equal(canAccessResumeQueue(normalizeExtensionAccess({status:"ACTIVE",roles:["ADMIN"]})),true);
  for(const role of ["APPLIER","APPLYING_MANAGER","DEVELOPER","DEVELOPMENT_MANAGER","JD_FINDER"])assert.equal(canAccessResumeQueue(normalizeExtensionAccess({status:"ACTIVE",roles:[role]})),false);
});

test("extension restricts the My Applications tab to Applier",()=>{
  assert.equal(canAccessMyApplications(normalizeExtensionAccess({status:"ACTIVE",roles:["APPLIER"]})),true);
  for(const role of ["APPLYING_MANAGER","DEVELOPER","DEVELOPMENT_MANAGER","JD_FINDER","ADMIN"])assert.equal(canAccessMyApplications(normalizeExtensionAccess({status:"ACTIVE",roles:[role]})),false);
});

test("JD Finder has no Resume matching or tailoring authority",()=>{
  assert.equal(canCreateTailoring(normalizeExtensionAccess({status:"ACTIVE",roles:["JD_FINDER"]})),false);
  assert.equal(canCreateTailoring(normalizeExtensionAccess({status:"ACTIVE",roles:["APPLYING_MANAGER"]})),true);
  assert.equal(canCreateTailoring(normalizeExtensionAccess({status:"ACTIVE",roles:["ADMIN"]})),true);
});

test("only Applying Managers and Admins can open the JD review queue",()=>{
  for(const role of ["APPLYING_MANAGER","ADMIN"])assert.equal(canReviewJobs(normalizeExtensionAccess({status:"ACTIVE",roles:[role]})),true);
  for(const role of ["APPLIER","DEVELOPER","DEVELOPMENT_MANAGER","JD_FINDER"])assert.equal(canReviewJobs(normalizeExtensionAccess({status:"ACTIVE",roles:[role]})),false);
});

test("only JD Finders receive the personal JD list capability",()=>{
  assert.equal(canListOwnJobs(normalizeExtensionAccess({status:"ACTIVE",roles:["JD_FINDER"]})),true);
  for(const role of ["APPLIER","APPLYING_MANAGER","DEVELOPER","DEVELOPMENT_MANAGER","ADMIN"])assert.equal(canListOwnJobs(normalizeExtensionAccess({status:"ACTIVE",roles:[role]})),false);
});

test("extension presents pending, inactive, and read-only messages",()=>{
  assert.match(extensionAccessMessage(normalizeExtensionAccess({status:"ACTIVE",roles:[]})),/waiting/i);
  assert.match(extensionAccessMessage(normalizeExtensionAccess({status:"INACTIVE",roles:["ADMIN"]})),/inactive/i);
  assert.match(extensionAccessMessage(normalizeExtensionAccess({status:"ACTIVE",roles:["APPLIER"]})),/read-only/i);
});
