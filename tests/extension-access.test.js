import test from "node:test";
import assert from "node:assert/strict";
import {canReadBusiness,canWriteBusiness,extensionAccessMessage,normalizeExtensionAccess} from "../extension/access/capabilities.js";

test("extension permits writes only for Applying Manager and Admin",()=>{
  for(const role of ["APPLYING_MANAGER","ADMIN"])assert.equal(canWriteBusiness(normalizeExtensionAccess({status:"ACTIVE",roles:[role]})),true);
  for(const role of ["APPLIER","DEVELOPER","DEVELOPMENT_MANAGER"])assert.equal(canWriteBusiness(normalizeExtensionAccess({status:"ACTIVE",roles:[role]})),false);
  assert.equal(canReadBusiness(normalizeExtensionAccess({status:"ACTIVE",roles:["APPLIER"]})),true);
  assert.equal(canReadBusiness(normalizeExtensionAccess({status:"ACTIVE",roles:["DEVELOPER"]})),false);
});

test("extension presents pending, inactive, and read-only messages",()=>{
  assert.match(extensionAccessMessage(normalizeExtensionAccess({status:"ACTIVE",roles:[]})),/waiting/i);
  assert.match(extensionAccessMessage(normalizeExtensionAccess({status:"INACTIVE",roles:["ADMIN"]})),/inactive/i);
  assert.match(extensionAccessMessage(normalizeExtensionAccess({status:"ACTIVE",roles:["APPLIER"]})),/read-only/i);
});
