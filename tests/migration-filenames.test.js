import test from "node:test";
import assert from "node:assert/strict";
import {readdirSync} from "node:fs";

test("Supabase migration filenames have unique timestamp versions",()=>{
  const files=readdirSync(new URL("../supabase/migrations/",import.meta.url)).filter(name=>name.endsWith(".sql")).sort();
  assert.ok(files.length>0,"Expected SQL migration files");
  const versions=new Map();
  for(const file of files){
    const match=/^(\d+)_.+\.sql$/.exec(file);
    assert.ok(match,`Invalid migration filename: ${file}`);
    const version=match[1];
    assert.ok(!versions.has(version),`Duplicate migration version ${version}: ${versions.get(version)} and ${file}`);
    versions.set(version,file);
  }
});
