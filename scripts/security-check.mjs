import{readFile}from"node:fs/promises";import{execFileSync}from"node:child_process";
const files=execFileSync("git",["ls-files","apps","dashboard","extension","packages","supabase"],{encoding:"utf8"}).split(/\r?\n/).filter(Boolean);
const forbidden=[[/\bsb_secret_[A-Za-z0-9_-]+/g,"Supabase secret key"],[/\bservice[_-]?role\s*[:=]\s*["'][^"']+/gi,"service-role credential"],[/\bsk-[A-Za-z0-9_-]{20,}/g,"AI/API secret"],[/\b(?:openai|codex)\s*\.\s*(?:chat|responses|exec)/gi,"AI execution path"]];
const failures=[];for(const file of files){if(/(?:package-lock|\.png$|\.pdf$)/.test(file))continue;const source=await readFile(file,"utf8").catch(()=>"");for(const[pattern,label]of forbidden)if(pattern.test(source))failures.push(`${file}: ${label}`);}
if(failures.length){console.error(failures.join("\n"));process.exit(1);}console.log(`Security scan passed for ${files.length} tracked source files; no privileged or AI execution pattern found.`);
