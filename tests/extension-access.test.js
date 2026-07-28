import test from "node:test";
import assert from "node:assert/strict";
import {canAccessMyApplications,canAccessResumeQueue,canReadBusiness,canWriteBusiness,extensionAccessMessage,normalizeExtensionAccess} from "../extension/access/capabilities.js";

test("extension permits writes only for Applying Manager and Admin",()=>{
  for(const role of ["APPLYING_MANAGER","ADMIN"])assert.equal(canWriteBusiness(normalizeExtensionAccess({status:"ACTIVE",roles:[role]})),true);
  for(const role of ["APPLIER","DEVELOPER","DEVELOPMENT_MANAGER"])assert.equal(canWriteBusiness(normalizeExtensionAccess({status:"ACTIVE",roles:[role]})),false);
});

test("extension permits Capture JD read access for every active role",()=>{
  for(const role of ["APPLIER","APPLYING_MANAGER","DEVELOPER","DEVELOPMENT_MANAGER","ADMIN"])assert.equal(canReadBusiness(normalizeExtensionAccess({status:"ACTIVE",roles:[role]})),true);
});

test("extension restricts Resumes and Tailoring Queue tabs to Admin",()=>{
  assert.equal(canAccessResumeQueue(normalizeExtensionAccess({status:"ACTIVE",roles:["ADMIN"]})),true);
  for(const role of ["APPLIER","APPLYING_MANAGER","DEVELOPER","DEVELOPMENT_MANAGER"])assert.equal(canAccessResumeQueue(normalizeExtensionAccess({status:"ACTIVE",roles:[role]})),false);
});

test("extension restricts the My Applications tab to Applier",()=>{
  assert.equal(canAccessMyApplications(normalizeExtensionAccess({status:"ACTIVE",roles:["APPLIER"]})),true);
  for(const role of ["APPLYING_MANAGER","DEVELOPER","DEVELOPMENT_MANAGER","ADMIN"])assert.equal(canAccessMyApplications(normalizeExtensionAccess({status:"ACTIVE",roles:[role]})),false);
});

test("extension presents pending, inactive, and read-only messages",()=>{
  assert.match(extensionAccessMessage(normalizeExtensionAccess({status:"ACTIVE",roles:[]})),/waiting/i);
  assert.match(extensionAccessMessage(normalizeExtensionAccess({status:"INACTIVE",roles:["ADMIN"]})),/inactive/i);
  assert.match(extensionAccessMessage(normalizeExtensionAccess({status:"ACTIVE",roles:["APPLIER"]})),/read-only/i);
});
