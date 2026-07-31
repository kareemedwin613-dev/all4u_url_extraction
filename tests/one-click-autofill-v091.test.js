import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

test("v0.9.1 fills every detected field immediately and presents results instead of an approval step",async()=>{
 const [app,view]=await Promise.all([
  readFile(new URL("../extension/sidepanel/App.jsx",import.meta.url),"utf8"),
  readFile(new URL("../extension/sidepanel/components/AutofillPreview.jsx",import.meta.url),"utf8"),
 ]);
 assert.match(app,/selectedAutofillFieldIds = autofillFields\.map/);
 assert.match(app,/MESSAGE_TYPES\.FILL_PERSONAL_AUTOFILL/);
 assert.match(view,/Autofill Results/);assert.match(view,/filled automatically/);assert.match(view,/Retry failed fields/);
 assert.doesNotMatch(view,/Review before filling|Fill selected fields|<Checkbox/);
});
