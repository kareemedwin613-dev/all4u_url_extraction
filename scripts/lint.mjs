import {readdir,readFile} from "node:fs/promises";
import {extname,join,relative,resolve} from "node:path";
import {transform} from "esbuild";

const root=resolve(".");
const roots=["dashboard/src","dashboard/tests","extension","scripts","tests"];
const files=[];
async function walk(path){for(const entry of await readdir(path,{withFileTypes:true})){if(entry.name==="dist"||entry.name==="node_modules")continue;const full=join(path,entry.name);if(entry.isDirectory())await walk(full);else if([".js",".jsx",".mjs"].includes(extname(entry.name)))files.push(full);}}
for(const path of roots)await walk(resolve(path));
for(const file of files){const source=await readFile(file,"utf8");await transform(source,{loader:extname(file)===".jsx"?"jsx":"js",jsx:"automatic",sourcefile:relative(root,file)});}
const credentialPattern=/(service[_-]?role|secret[_-]?key|database[_-]?password)\s*[:=]\s*["'][A-Za-z0-9._-]{12,}/i;
for(const path of ["dashboard/src","extension"]){const stack=[resolve(path)];while(stack.length){const current=stack.pop();for(const entry of await readdir(current,{withFileTypes:true})){const full=join(current,entry.name);if(entry.isDirectory())stack.push(full);else if(/\.(js|jsx|json|html)$/.test(entry.name)&&credentialPattern.test(await readFile(full,"utf8")))throw new Error("Potential privileged credential in "+relative(root,full));}}}
console.log("Linted "+files.length+" JavaScript/JSX modules and checked frontend credential patterns");
